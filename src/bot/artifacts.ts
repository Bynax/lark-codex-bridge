import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, resolve, sep } from 'node:path';
import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import type { Block, RunState } from '../card/run-state';
import { log } from '../core/logger';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MTIME_SKEW_MS = 10_000;

const BRIDGE_ARTIFACT_RE =
  /<bridge_artifact\b([^>]*)\/>|<bridge_artifact\b([^>]*)>[\s\S]*?<\/bridge_artifact>/gi;
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\n]+)\)/g;

export interface ImageArtifact {
  type: 'image';
  path: string;
  caption?: string;
  source: 'tag' | 'markdown';
}

export interface FileArtifact {
  type: 'file';
  path: string;
  filename?: string;
  caption?: string;
  source: 'tag';
}

export type BridgeArtifact = ImageArtifact | FileArtifact;

export interface PreparedImageArtifact extends ImageArtifact {
  path: string;
  size: number;
}

export interface PreparedFileArtifact extends FileArtifact {
  path: string;
  filename: string;
  size: number;
}

export interface ArtifactExtraction {
  state: RunState;
  artifacts: BridgeArtifact[];
}

interface PrepareOptions {
  cwd: string;
  runStartedAtMs: number;
}

interface SendOptions {
  replyTo?: string;
  replyInThread?: boolean;
}

export function extractArtifactsFromState(state: RunState): ArtifactExtraction {
  const artifacts: BridgeArtifact[] = [];
  const blocks = state.blocks.map((block): Block => {
    if (block.kind !== 'text') return block;
    const extracted = extractArtifactsFromText(block.content);
    artifacts.push(...extracted.artifacts);
    return { ...block, content: extracted.text };
  });
  return { state: { ...state, blocks }, artifacts };
}

export function extractArtifactsFromText(text: string): { text: string; artifacts: BridgeArtifact[] } {
  const artifacts: BridgeArtifact[] = [];
  let changed = false;

  let next = text.replace(BRIDGE_ARTIFACT_RE, (match, attrsA: string, attrsB: string) => {
    const attrs = parseAttrs(attrsA || attrsB || '');
    if (!attrs.path) return match;
    if (attrs.type === 'image') {
      artifacts.push({
        type: 'image',
        path: attrs.path,
        caption: attrs.caption || undefined,
        source: 'tag',
      });
    } else if (attrs.type === 'file') {
      artifacts.push({
        type: 'file',
        path: attrs.path,
        filename: attrs.filename || attrs.name || undefined,
        caption: attrs.caption || undefined,
        source: 'tag',
      });
    } else {
      return match;
    }
    changed = true;
    return '';
  });

  next = next.replace(MARKDOWN_IMAGE_RE, (match, alt: string, target: string) => {
    const path = localImagePathFromMarkdownTarget(target);
    if (!path) return match;
    artifacts.push({
      type: 'image',
      path,
      caption: alt.trim() || undefined,
      source: 'markdown',
    });
    changed = true;
    return alt.trim();
  });

  return {
    text: changed ? cleanupArtifactText(next) : text,
    artifacts,
  };
}

export async function prepareImageArtifacts(
  artifacts: BridgeArtifact[],
  opts: PrepareOptions,
): Promise<PreparedImageArtifact[]> {
  const cwd = await realpath(opts.cwd);
  const tmp = await realpath(tmpdir()).catch(() => tmpdir());
  const seen = new Set<string>();
  const prepared: PreparedImageArtifact[] = [];

  for (const artifact of artifacts) {
    if (artifact.type !== 'image') continue;
    try {
      const path = await validateImageArtifact(artifact.path, {
        cwd,
        tmp,
        runStartedAtMs: opts.runStartedAtMs,
      });
      if (seen.has(path)) continue;
      seen.add(path);
      const size = (await stat(path)).size;
      prepared.push({ ...artifact, path, size });
    } catch (err) {
      log.warn('artifact', 'skip-image', {
        path: artifact.path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return prepared;
}

export async function prepareFileArtifacts(
  artifacts: BridgeArtifact[],
  opts: PrepareOptions,
): Promise<PreparedFileArtifact[]> {
  const cwd = await realpath(opts.cwd);
  const tmp = await realpath(tmpdir()).catch(() => tmpdir());
  const seen = new Set<string>();
  const prepared: PreparedFileArtifact[] = [];

  for (const artifact of artifacts) {
    if (artifact.type !== 'file') continue;
    try {
      const path = await validateFileArtifact(artifact.path, {
        cwd,
        tmp,
        runStartedAtMs: opts.runStartedAtMs,
      });
      if (seen.has(path)) continue;
      seen.add(path);
      const size = (await stat(path)).size;
      prepared.push({
        ...artifact,
        path,
        filename: cleanFileName(artifact.filename) || basename(path),
        size,
      });
    } catch (err) {
      log.warn('artifact', 'skip-file', {
        path: artifact.path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return prepared;
}

export async function sendImageArtifacts(
  channel: LarkChannel,
  chatId: string,
  artifacts: PreparedImageArtifact[],
  opts: SendOptions,
): Promise<void> {
  for (const artifact of artifacts) {
    try {
      await channel.send(chatId, { image: { source: artifact.path } }, opts);
      log.info('artifact', 'sent-image', {
        path: artifact.path,
        size: artifact.size,
        source: artifact.source,
      });
    } catch (err) {
      log.fail('artifact', err, { path: artifact.path });
      await channel
        .send(chatId, { markdown: `⚠️ 图片回传失败：\`${artifact.path}\`` }, opts)
        .catch(() => {});
    }
  }
}

export async function sendFileArtifacts(
  channel: LarkChannel,
  chatId: string,
  artifacts: PreparedFileArtifact[],
  opts: SendOptions,
): Promise<void> {
  for (const artifact of artifacts) {
    try {
      await channel.send(
        chatId,
        { file: { source: artifact.path, fileName: artifact.filename } },
        opts,
      );
      log.info('artifact', 'sent-file', {
        path: artifact.path,
        filename: artifact.filename,
        size: artifact.size,
      });
    } catch (err) {
      log.fail('artifact', err, { path: artifact.path });
      await channel
        .send(chatId, { markdown: `⚠️ 文件回传失败：\`${artifact.path}\`` }, opts)
        .catch(() => {});
    }
  }
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) {
    const key = match[1];
    if (!key) continue;
    attrs[key] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}

function localImagePathFromMarkdownTarget(raw: string): string | null {
  let target = raw.trim();
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  } else {
    const match = /^(\S+)(?:\s+["'][^"']*["'])?$/.exec(target);
    if (!match) return null;
    target = match[1] ?? '';
  }
  if (!isLikelyImagePath(target)) return null;
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function isLikelyImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
}

function isLikelyFilePath(path: string): boolean {
  return /\.(pdf|pptx?|docx?|xlsx?|csv|tsv|txt|md|json|zip)$/i.test(path);
}

function cleanFileName(value: string | undefined): string | undefined {
  const cleaned = basename((value ?? '').trim()).replace(/[\u0000-\u001f]/g, '');
  return cleaned || undefined;
}

function cleanupArtifactText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function validateImageArtifact(
  path: string,
  opts: { cwd: string; tmp: string; runStartedAtMs: number },
): Promise<string> {
  if (!path.trim()) throw new Error('empty path');
  if (!isLikelyImagePath(path)) throw new Error('unsupported image extension');

  const absolute = isAbsolute(path) ? path : resolve(opts.cwd, path);
  const before = await lstat(absolute);
  if (!before.isFile()) throw new Error('not a regular file');
  if (before.isSymbolicLink()) throw new Error('symbolic links are not allowed');
  if (before.size <= 0) throw new Error('empty file');
  if (before.size > MAX_IMAGE_BYTES) throw new Error('image is too large');
  if (before.mtimeMs < opts.runStartedAtMs - MTIME_SKEW_MS) {
    throw new Error('file was not created or updated by this run');
  }

  const resolved = await realpath(absolute);
  if (!isUnder(resolved, opts.cwd) && !isUnder(resolved, opts.tmp)) {
    throw new Error('path is outside the workspace and temp directory');
  }

  const header = await readFile(resolved).then((buf) => buf.subarray(0, 16));
  if (!hasImageMagic(header)) throw new Error('file is not a supported image');
  return resolved;
}

async function validateFileArtifact(
  path: string,
  opts: { cwd: string; tmp: string; runStartedAtMs: number },
): Promise<string> {
  if (!path.trim()) throw new Error('empty path');
  if (!isLikelyFilePath(path)) throw new Error('unsupported file extension');

  const absolute = isAbsolute(path) ? path : resolve(opts.cwd, path);
  const before = await lstat(absolute);
  if (!before.isFile()) throw new Error('not a regular file');
  if (before.isSymbolicLink()) throw new Error('symbolic links are not allowed');
  if (before.size <= 0) throw new Error('empty file');
  if (before.size > MAX_FILE_BYTES) throw new Error('file is too large');
  if (before.mtimeMs < opts.runStartedAtMs - MTIME_SKEW_MS) {
    throw new Error('file was not created or updated by this run');
  }

  const resolved = await realpath(absolute);
  if (!isUnder(resolved, opts.cwd) && !isUnder(resolved, opts.tmp)) {
    throw new Error('path is outside the workspace and temp directory');
  }
  return resolved;
}

function isUnder(path: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return path === root || path.startsWith(normalizedRoot);
}

function hasImageMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const png = buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const gif = buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a';
  const webp =
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP';
  return png || jpeg || gif || webp;
}
