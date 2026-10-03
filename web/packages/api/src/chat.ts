// Employee chat with the governed assistant. The routes are served by agent-host on the host
// (Caddy forwards /api/v1/chat/* on betsee.localhost); the stream is fetch-based SSE like the
// Gateway's. Event payloads are listed in contracts/events.md, "Employee chat stream".

import { useEffect, useMemo, useState } from 'react';
import { apiConfig, apiFetch, ApiRequestError, origin } from './client.ts';
import type { components } from './schema.ts';
import { openEventStream, type StreamStatus } from './stream.ts';

export type ChatSession = components['schemas']['ChatSession'];
export type ChatMessageResult = components['schemas']['ChatMessageResult'];
export type InputFinding = components['schemas']['InputFinding'];
type Decision = components['schemas']['Decision'];

export interface ChatEvent {
  id: number;
  type: string;
  at: string;
  [key: string]: unknown;
}

export interface ToolDecision {
  decision: Decision;
  reasons: string[];
  controlIds: string[];
  traceId: string | null;
  capability: string;
  resource: { id: string; type?: string; tier?: string };
  approvalState?: string;
  unreachable: boolean;
  waitingSeconds?: number;
}

export type ThreadItem =
  | { kind: 'user'; key: string; text: string; traceId: string | null; at: string }
  | {
      kind: 'blocked';
      key: string;
      text: string | null;
      reasons: string[];
      controlIds: string[];
      traceId: string | null;
      findings: InputFinding[];
      at: string;
    }
  | { kind: 'assistant'; key: string; text: string; at: string }
  | {
      kind: 'tool';
      key: string;
      tool: string;
      input: Record<string, unknown>;
      decision: ToolDecision | null;
      waiting: ToolDecision | null;
      timedOut: boolean;
      result: { isError: boolean; content: string } | null;
      at: string;
    }
  | { kind: 'error'; key: string; message: string; at: string };

export interface ChatThread {
  items: ThreadItem[];
  busy: boolean;
  model: string | null;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function toDecision(event: ChatEvent): ToolDecision {
  return {
    decision: (event.decision as Decision) ?? 'deny',
    reasons: strings(event.reasons),
    controlIds: strings(event.control_ids),
    traceId: typeof event.trace_id === 'string' ? event.trace_id : null,
    capability: String(event.capability ?? ''),
    resource: (event.resource as ToolDecision['resource']) ?? { id: '' },
    approvalState: typeof event.approval_state === 'string' ? event.approval_state : undefined,
    unreachable: event.unreachable === true,
    waitingSeconds: typeof event.waiting_seconds === 'number' ? event.waiting_seconds : undefined,
  };
}

/**
 * Folds the chat's event log into the thread the page renders. A tool's decision can arrive
 * before or after the model's tool_use line, so tool items are keyed by tool_use_id either way.
 * Blocked messages carry no text on the wire; `sent` maps message ids to what this browser typed.
 */
export function foldChat(events: ChatEvent[], sent: ReadonlyMap<string, string> = new Map()): ChatThread {
  const items: ThreadItem[] = [];
  const tools = new Map<string, Extract<ThreadItem, { kind: 'tool' }>>();
  let busy = false;
  let model: string | null = null;
  const tool = (event: ChatEvent) => {
    const id = String(event.tool_use_id ?? `event-${event.id}`);
    let item = tools.get(id);
    if (!item) {
      item = { kind: 'tool', key: id, tool: String(event.tool ?? ''), input: {}, decision: null, waiting: null, timedOut: false, result: null, at: event.at };
      tools.set(id, item);
      items.push(item);
    }
    if (!item.tool && event.tool) item.tool = String(event.tool);
    return item;
  };
  for (const event of events) {
    switch (event.type) {
      case 'user_message':
        busy = true;
        items.push({ kind: 'user', key: String(event.message_id), text: String(event.text ?? ''), traceId: (event.trace_id as string) ?? null, at: event.at });
        break;
      case 'input_blocked':
        items.push({
          kind: 'blocked',
          key: String(event.message_id),
          text: sent.get(String(event.message_id)) ?? null,
          reasons: strings(event.reasons),
          controlIds: strings(event.control_ids),
          traceId: (event.trace_id as string) ?? null,
          findings: Array.isArray(event.findings) ? (event.findings as InputFinding[]) : [],
          at: event.at,
        });
        break;
      case 'run_started':
        busy = true;
        model = typeof event.model === 'string' ? event.model : model;
        break;
      case 'assistant_text':
        items.push({ kind: 'assistant', key: `a-${event.id}`, text: String(event.text ?? ''), at: event.at });
        break;
      case 'tool_call': {
        const item = tool(event);
        item.input = (event.input as Record<string, unknown>) ?? {};
        break;
      }
      case 'decision': {
        const item = tool(event);
        const decision = toDecision(event);
        const pending = (decision.decision === 'require_approval' || decision.decision === 'require_step_up') && decision.approvalState === 'pending';
        if (pending) item.waiting = decision;
        else item.decision = decision;
        break;
      }
      case 'approval_timeout':
        tool(event).timedOut = true;
        break;
      case 'tool_result':
        tool(event).result = { isError: event.is_error === true, content: String(event.content ?? '') };
        break;
      case 'error':
        items.push({ kind: 'error', key: `e-${event.id}`, message: String(event.message ?? 'The agent run failed'), at: event.at });
        break;
      case 'idle':
        busy = false;
        break;
    }
  }
  return { items, busy, model };
}

async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  let response: Response;
  try {
    response = await apiFetch(`${origin()}/api/v1/chat${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    throw new ApiRequestError(0, undefined, cause instanceof Error ? `Chat service unreachable: ${cause.message}` : 'Chat service unreachable');
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const error = body as { error?: string; message?: string } | undefined;
    const message =
      response.status === 502 || response.status === 503
        ? 'The chat service (agent-host) is not running. Start it with scripts/agent-host.sh.'
        : error?.message;
    throw new ApiRequestError(response.status, error?.error && error.message ? { error: error.error, message: error.message, trace_id: '' } : undefined, message);
  }
  return { status: response.status, body: body as T };
}

export const chatApi = {
  sessions: () => request<{ items: ChatSession[] }>('/sessions').then((r) => r.body.items),
  start: () => request<ChatSession>('/sessions', { method: 'POST', body: '{}' }).then((r) => r.body),
  send: (chatId: string, text: string) =>
    request<ChatMessageResult>('/messages', { method: 'POST', body: JSON.stringify({ chat_id: chatId, text }) }).then((r) => r.body),
};

/** The live event log of one chat. */
export function useChatStream(chatId: string | null): { events: ChatEvent[]; status: StreamStatus } {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  useEffect(() => {
    setEvents([]);
    if (!chatId) return;
    const seen = new Set<number>();
    const handle = openEventStream({
      url: `${origin()}/api/v1/chat/stream/${encodeURIComponent(chatId)}`,
      getAccessToken: apiConfig().getAccessToken,
      fetch: apiConfig().fetch,
      onStatus: setStatus,
      onMessage: (message) => {
        let event: ChatEvent;
        try {
          event = JSON.parse(message.data) as ChatEvent;
        } catch {
          return;
        }
        if (seen.has(event.id)) return;
        seen.add(event.id);
        setEvents((current) => [...current, event]);
      },
    });
    return () => handle.close();
  }, [chatId]);
  return { events, status };
}

export function useChatThread(chatId: string | null, sent: ReadonlyMap<string, string>) {
  const { events, status } = useChatStream(chatId);
  const thread = useMemo(() => foldChat(events, sent), [events, sent]);
  return { ...thread, status, events };
}
