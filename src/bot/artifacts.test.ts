import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunState } from '../card/run-state';
import {
  extractArtifactsFromState,
  extractArtifactsFromText,
  prepareImageArtifacts,
} from './artifacts';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

describe('bridge artifacts', () => {
  it('extracts bridge_artifact image tags and strips them from text', () => {
    const out = extractArtifactsFromText(
      '好了\n<bridge_artifact type="image" path="/tmp/a.png" caption="图 1" />',
    );

    expect(out.text).toBe('好了');
    expect(out.artifacts).toEqual([
      { type: 'image', path: '/tmp/a.png', caption: '图 1', source: 'tag' },
    ]);
  });

  it('extracts local markdown image links', () => {
    const out = extractArtifactsFromText('看这个：![demo](./demo.png)');

    expect(out.text).toBe('看这个：demo');
    expect(out.artifacts).toEqual([
      { type: 'image', path: './demo.png', caption: 'demo', source: 'markdown' },
    ]);
  });

  it('strips artifacts across text blocks in a run state', () => {
    const state: RunState = {
      blocks: [
        { kind: 'text', content: 'A <bridge_artifact type="image" path="./a.png" />', streaming: false },
      ],
      reasoning: { content: '', active: false },
      footer: null,
      terminal: 'done',
    };

    const out = extractArtifactsFromState(state);

    expect(out.state.blocks).toEqual([{ kind: 'text', content: 'A', streaming: false }]);
    expect(out.artifacts).toHaveLength(1);
  });

  it('prepares only real images under the run workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bridge-artifacts-'));
    const good = join(dir, 'good.png');
    const bad = join(dir, 'bad.png');
    await writeFile(good, PNG_1X1);
    await writeFile(bad, 'not an image');

    const prepared = await prepareImageArtifacts(
      [
        { type: 'image', path: good, source: 'tag' },
        { type: 'image', path: bad, source: 'tag' },
        { type: 'image', path: '/etc/passwd.png', source: 'tag' },
      ],
      { cwd: dir, runStartedAtMs: Date.now() - 1000 },
    );

    expect(prepared.map((a) => a.path)).toEqual([good]);
  });
});
