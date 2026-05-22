import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface SessionSummary {
  sessionId: string;
  mtime: number;
  preview: string;
  lineCount: number;
}

interface CodexSessionIndexLine {
  id?: string;
  thread_name?: string;
  updated_at?: string;
}

/** Return the most recent Codex sessions, newest first. */
export async function listRecentSessions(_cwd: string, limit = 5): Promise<SessionSummary[]> {
  const path = join(homedir(), '.codex', 'session_index.jsonl');
  try {
    await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const latest = new Map<string, SessionSummary>();
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream });
  let lineCount = 0;
  try {
    for await (const line of rl) {
      lineCount++;
      const parsed = parseIndexLine(line);
      if (!parsed?.id) continue;
      const mtime = parsed.updated_at ? Date.parse(parsed.updated_at) : 0;
      latest.set(parsed.id, {
        sessionId: parsed.id,
        mtime: Number.isFinite(mtime) ? mtime : 0,
        preview: parsed.thread_name?.trim() || '(未命名会话)',
        lineCount: 1,
      });
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return [...latest.values()]
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((s) => ({ ...s, lineCount }));
}

function parseIndexLine(line: string): CodexSessionIndexLine | null {
  try {
    const parsed = JSON.parse(line) as CodexSessionIndexLine;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Format a relative time like "3 小时前", "昨天", "3 天前". */
export function formatRelTime(mtime: number): string {
  const diffMs = Date.now() - mtime;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 30) return `${day} 天前`;
  const mo = Math.floor(day / 30);
  return `${mo} 个月前`;
}
