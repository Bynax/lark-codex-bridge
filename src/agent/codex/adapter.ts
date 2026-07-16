import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { log } from '../../core/logger';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types';
import { translateEvent } from './stream-json';

export interface CodexAdapterOptions {
  binary?: string;
}

type CodexChild = ChildProcessByStdio<null, Readable, Readable>;

const BRIDGE_CONTEXT_PROMPT = `# lark-codex-bridge 运行约定

你正在 lark-codex-bridge 里运行：飞书/Lark 用户在聊天框里和本地 Codex CLI 对话。

每条用户消息顶部可能带有 <bridge_context>、<quoted_message> 或 <interactive_card> 块。
这些块是 bridge 注入的上下文，帮助你理解消息来源、引用对象和用户发来的飞书卡片结构。不要把这些 XML 标签照抄给用户。

如果用户点击 bridge 转发给你的卡片按钮，你会收到形如：

[card-click] {"choice":"a","id":"..."}

这表示用户在飞书里点了按钮。请把它当作同一会话里的后续输入继续处理。

如果你通过可用工具发送飞书 CardKit 卡片，并希望按钮点击回到当前会话，请在按钮 value 里加入 "__agent_cb": true 或 "__codex_cb": true。bridge 会去掉这个 marker，再把按钮 payload 作为 [card-click] 消息发回给你。

回复应面向飞书聊天场景：简洁、直接、默认用 Markdown。

如果你生成了用户需要查看的本地图片文件，请在回复末尾输出：
<bridge_artifact type="image" path="/absolute/path/to/image.png" caption="可选说明" />
bridge 会校验并把图片作为飞书原图消息发回；不要只给用户本地文件路径。`;

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';

  private readonly binary: string;

  constructor(opts: CodexAdapterOptions = {}) {
    this.binary = opts.binary ?? 'codex';
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.binary, ['--version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  }

  run(opts: AgentRunOptions): AgentRun {
    const prompt = `${BRIDGE_CONTEXT_PROMPT}\n\n---\n\n${opts.prompt}`;
    const args = opts.sessionId
      ? resumeArgs(opts, prompt)
      : execArgs(opts, prompt);

    const child = spawn(this.binary, args, {
      cwd: opts.cwd,
      env: { ...process.env, LARK_CODEX: '1', LARK_CODEX_AGENT: 'codex' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    log.info('agent', 'spawn', {
      agent: this.id,
      pid: child.pid ?? null,
      cwd: opts.cwd ?? process.cwd(),
      hasSession: Boolean(opts.sessionId),
      promptChars: opts.prompt.length,
      model: opts.model,
      images: opts.images?.length ?? 0,
    });

    const stderrChunks: Buffer[] = [];
    let stderrBuffer = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrBuffer += chunk.toString('utf8');
      let nl = stderrBuffer.indexOf('\n');
      while (nl !== -1) {
        const line = stderrBuffer.slice(0, nl);
        stderrBuffer = stderrBuffer.slice(nl + 1);
        if (line.trim() && !isBenignCodexStderr(line)) {
          log.warn('agent', 'stderr', { line: truncate(line, 500) });
        }
        nl = stderrBuffer.indexOf('\n');
      }
    });

    let runtimeError: Error | null = null;
    child.on('error', (err) => {
      runtimeError = err;
    });
    child.on('exit', (code, signal) => {
      log.info('agent', 'exit', { pid: child.pid ?? null, code, signal });
    });

    const stopGraceMs = opts.stopGraceMs ?? 5000;

    return {
      events: createEventStream(child, stderrChunks, () => runtimeError),
      async stop() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        log.info('agent', 'stop-sigterm', { pid: child.pid ?? null, graceMs: stopGraceMs });
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              log.warn('agent', 'stop-sigkill', {
                pid: child.pid ?? null,
                graceMs: stopGraceMs,
                reason: 'grace-period-expired',
              });
              child.kill('SIGKILL');
            }
            resolve();
          }, stopGraceMs);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      },
      waitForExit(timeoutMs: number): Promise<boolean> {
        if (child.exitCode !== null || child.signalCode !== null) {
          return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve) => {
          const onExit = (): void => {
            clearTimeout(timer);
            resolve(true);
          };
          const timer = setTimeout(() => {
            child.removeListener('exit', onExit);
            resolve(false);
          }, timeoutMs);
          child.once('exit', onExit);
        });
      },
    };
  }
}

function execArgs(opts: AgentRunOptions, prompt: string): string[] {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    ...(opts.cwd ? ['-C', opts.cwd] : []),
    ...imageArgs(opts.images),
    ...(opts.model ? ['-m', opts.model] : []),
    prompt,
  ];
}

function resumeArgs(opts: AgentRunOptions, prompt: string): string[] {
  return [
    'exec',
    'resume',
    '--json',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    ...imageArgs(opts.images),
    ...(opts.model ? ['-m', opts.model] : []),
    opts.sessionId!,
    prompt,
  ];
}

function imageArgs(images: string[] | undefined): string[] {
  return (images ?? []).flatMap((path) => ['-i', path]);
}

async function* createEventStream(
  child: CodexChild,
  stderrChunks: Buffer[],
  getError: () => Error | null,
): AsyncGenerator<AgentEvent> {
  if (!child.pid) {
    await new Promise((resolve) => setImmediate(resolve));
    const err = getError();
    yield {
      type: 'error',
      message: err ? `failed to spawn codex: ${err.message}` : 'spawn returned no pid',
    };
    return;
  }

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      yield* translateEvent(parsed);
    }
  } finally {
    rl.close();
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
    } else {
      child.once('exit', (code) => resolve(code));
    }
  });

  const runtimeError = getError();
  if (exitCode !== 0 && exitCode !== null) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    const detail = stderr ? `: ${truncate(stderr, 500)}` : '';
    yield { type: 'error', message: `codex exited with code ${exitCode}${detail}` };
  } else if (runtimeError) {
    yield { type: 'error', message: `codex runtime error: ${runtimeError.message}` };
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function isBenignCodexStderr(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === 'Reading additional input from stdin...' ||
    trimmed.includes('codex_core_skills::loader: ignoring interface.icon_') ||
    trimmed.includes('codex_core_plugins::manager: failed to warm featured plugin ids cache') ||
    trimmed === '>' ||
    trimmed === '/>' ||
    trimmed.startsWith('<') ||
    trimmed.startsWith('</') ||
    trimmed.startsWith('xmlns=') ||
    trimmed.startsWith('width=') ||
    trimmed.startsWith('height=') ||
    trimmed.startsWith('viewBox=') ||
    trimmed.startsWith('fill=') ||
    trimmed.startsWith('strokeWidth=') ||
    trimmed.startsWith('class=') ||
    trimmed.startsWith('d=') ||
    trimmed.includes('challenge-error-text') ||
    trimmed.includes('window._cf_chl_opt') ||
    trimmed.includes('document.createElement')
  );
}
