import type { AgentEvent } from '../types';

interface CodexRawEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
    reasoning_output_tokens?: number;
  };
  message?: string;
  error?: unknown;
}

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  name?: string;
  tool_name?: string;
  arguments?: unknown;
  input?: unknown;
  output?: unknown;
  result?: unknown;
}

export function* translateEvent(raw: unknown): Generator<AgentEvent> {
  if (!raw || typeof raw !== 'object') return;
  const evt = raw as CodexRawEvent;

  if (evt.type === 'thread.started' && evt.thread_id) {
    yield { type: 'system', sessionId: evt.thread_id };
    return;
  }

  if (evt.type === 'item.started' && evt.item) {
    const tool = toolUseFromItem(evt.item);
    if (tool) yield tool;
    return;
  }

  if (evt.type === 'item.completed' && evt.item) {
    const item = evt.item;
    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text) {
      yield { type: 'text', delta: item.text };
      return;
    }

    const toolResult = toolResultFromItem(item);
    if (toolResult) yield toolResult;
    return;
  }

  if (evt.type === 'turn.completed') {
    if (evt.usage) {
      yield {
        type: 'usage',
        inputTokens: evt.usage.input_tokens,
        outputTokens: evt.usage.output_tokens,
      };
    }
    yield { type: 'done' };
    return;
  }

  if (evt.type === 'error') {
    yield { type: 'error', message: errorMessage(evt) };
  }
}

function toolUseFromItem(item: CodexItem): AgentEvent | null {
  const id = item.id;
  if (!id || item.type === 'agent_message') return null;

  if (item.type === 'command_execution') {
    return {
      type: 'tool_use',
      id,
      name: 'shell',
      input: { command: item.command ?? '' },
    };
  }

  if (item.type?.endsWith('tool_call') || item.type?.includes('tool')) {
    return {
      type: 'tool_use',
      id,
      name: item.tool_name ?? item.name ?? item.type,
      input: item.arguments ?? item.input ?? item,
    };
  }

  return null;
}

function toolResultFromItem(item: CodexItem): AgentEvent | null {
  const id = item.id;
  if (!id || item.type === 'agent_message') return null;

  if (item.type === 'command_execution') {
    const output = item.aggregated_output ?? '';
    const exit = item.exit_code;
    const suffix = typeof exit === 'number' ? `\n\n(exit code ${exit})` : '';
    return {
      type: 'tool_result',
      id,
      output: `${output}${suffix}`.trim(),
      isError: typeof exit === 'number' && exit !== 0,
    };
  }

  if (item.type?.endsWith('tool_call') || item.type?.includes('tool')) {
    return {
      type: 'tool_result',
      id,
      output: stringify(item.output ?? item.result ?? item.text ?? item),
      isError: item.status === 'failed' || item.status === 'error',
    };
  }

  return null;
}

function errorMessage(evt: CodexRawEvent): string {
  if (typeof evt.message === 'string') return evt.message;
  if (evt.error instanceof Error) return evt.error.message;
  if (evt.error !== undefined) return stringify(evt.error);
  return 'codex reported an unknown error';
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
