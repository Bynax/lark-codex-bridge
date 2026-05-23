import type { AppConfig, AgentId } from '../config/schema';
import { getAgentId } from '../config/schema';
import { ClaudeAdapter } from './claude/adapter';
import { CodexAdapter } from './codex/adapter';
import type { AgentAdapter, AgentRun, AgentRunOptions } from './types';

export function createAgentAdapter(id: AgentId): AgentAdapter {
  switch (id) {
    case 'claude':
      return new ClaudeAdapter();
    case 'codex':
    default:
      return new CodexAdapter();
  }
}

export function agentDisplayName(id: AgentId): string {
  return createAgentAdapter(id).displayName;
}

export function agentInstallHint(id: AgentId): string {
  if (id === 'claude') {
    return '请先安装并登录 Claude Code CLI：https://docs.anthropic.com/en/docs/claude-code/quickstart';
  }
  return '请先安装并登录 Codex CLI：npm install -g @openai/codex';
}

export class ConfiguredAgentAdapter implements AgentAdapter {
  constructor(private readonly getConfig: () => AppConfig) {}

  get id(): AgentId {
    return getAgentId(this.getConfig());
  }

  get displayName(): string {
    return agentDisplayName(this.id);
  }

  isAvailable(): Promise<boolean> {
    return createAgentAdapter(this.id).isAvailable();
  }

  run(opts: AgentRunOptions): AgentRun {
    return createAgentAdapter(this.id).run(opts);
  }
}
