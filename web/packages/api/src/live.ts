import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { eventHub } from './events.ts';
import type { ActionSummary, Agent, AgentMessage, SecurityEvent, StreamEvent, ToolDescriptorChanged } from './types.ts';

const FEED_LIMIT = 500;
const REFRESH_EVERY_MS = 2_000;

// Events also go to these buffers, so a list fetch that was in flight when an event arrived still
// includes it once it resolves.
const actionBuffer = new Map<string, ActionSummary>();
const messageBuffer = new Map<string, AgentMessage>();
const securityBuffer = new Map<string, SecurityEvent>();

const remember = <T>(buffer: Map<string, T>, key: string, value: T) => {
  buffer.delete(key);
  buffer.set(key, value);
  if (buffer.size > FEED_LIMIT) buffer.delete(buffer.keys().next().value as string);
};

export const liveActions = () => [...actionBuffer.values()];
export const liveMessages = () => [...messageBuffer.values()];
export const liveSecurityEvents = () => [...securityBuffer.values()];

const newestFirst = (a: { occurred_at: string; id: string }, b: { occurred_at: string; id: string }) =>
  b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id);

/** Upserts by trace_id (a later action.updated replaces its row), newest first, capped. */
export function mergeActions(base: ActionSummary[], incoming: ActionSummary[]): ActionSummary[] {
  const byId = new Map(base.map((a) => [a.trace_id, a]));
  for (const action of incoming) byId.set(action.trace_id, action);
  return [...byId.values()]
    .sort((a, b) => newestFirst({ occurred_at: a.occurred_at, id: a.trace_id }, { occurred_at: b.occurred_at, id: b.trace_id }))
    .slice(0, FEED_LIMIT);
}

export function mergeMessages(base: AgentMessage[], incoming: AgentMessage[]): AgentMessage[] {
  const byId = new Map(base.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(newestFirst).slice(0, FEED_LIMIT);
}

export function mergeSecurityEvents(base: SecurityEvent[], incoming: SecurityEvent[]): SecurityEvent[] {
  const byId = new Map(base.map((e) => [e.id, e]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort(newestFirst).slice(0, FEED_LIMIT);
}

/** Tool pins reported blocked by tool.descriptor_changed, keyed by connector and tool name. */
const toolDrift = new Map<string, ToolDescriptorChanged>();
const driftListeners = new Set<() => void>();
let driftSnapshot: ReadonlyMap<string, ToolDescriptorChanged> = new Map();

export const toolKey = (connector: string, tool: string) => `${connector}/${tool}`;

function recordDrift(change: ToolDescriptorChanged) {
  const key = toolKey(change.connector_id, change.tool);
  if (change.status === 'blocked') toolDrift.set(key, change);
  else toolDrift.delete(key);
  driftSnapshot = new Map(toolDrift);
  for (const listener of driftListeners) listener();
}

export function useToolDrift(): ReadonlyMap<string, ToolDescriptorChanged> {
  return useSyncExternalStore(
    (listener) => {
      driftListeners.add(listener);
      return () => {
        driftListeners.delete(listener);
      };
    },
    () => driftSnapshot,
    () => driftSnapshot,
  );
}

/** Applies one stream event to the query cache. Exported for tests. */
export function applyEvent(queryClient: QueryClient, event: StreamEvent, refreshSoon: (key: string) => void) {
  switch (event.type) {
    case 'action.decided':
    case 'action.updated': {
      const action = event.data;
      remember(actionBuffer, action.trace_id, action);
      queryClient.setQueryData<ActionSummary[]>(['traces'], (old) => (old ? mergeActions(old, [action]) : old));
      if (event.type === 'action.updated') void queryClient.invalidateQueries({ queryKey: ['trace', action.trace_id] });
      refreshSoon('agents');
      refreshSoon('coverage');
      refreshSoon('summary');
      if (action.approval_state !== 'none') refreshSoon('approvals');
      break;
    }
    case 'agent.state_changed': {
      const { agent_id, state, reason, occurred_at } = event.data;
      queryClient.setQueryData<Agent[]>(['agents'], (old) =>
        old?.map((a) => (a.id === agent_id ? { ...a, state, state_reason: reason || null, state_changed_at: occurred_at } : a)),
      );
      refreshSoon('agents');
      break;
    }
    case 'message.mediated': {
      remember(messageBuffer, event.data.id, event.data);
      queryClient.setQueryData<AgentMessage[]>(['agent-messages'], (old) => (old ? mergeMessages(old, [event.data]) : old));
      break;
    }
    case 'tool.descriptor_changed':
      recordDrift(event.data);
      refreshSoon('connectors');
      break;
    case 'security.event': {
      remember(securityBuffer, event.data.id, event.data);
      queryClient.setQueryData<SecurityEvent[]>(['security-events'], (old) => (old ? mergeSecurityEvents(old, [event.data]) : old));
      break;
    }
    case 'session.started':
    case 'session.ended':
      refreshSoon('sessions');
      refreshSoon('agents');
      break;
  }
}

/**
 * Opens the event stream for the app's lifetime and keeps the query cache live. Aggregates
 * (budgets, coverage, approvals) refetch at most every two seconds while events flow.
 */
export function useLiveSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const due = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshSoon = (key: string) => {
      due.add(key);
      timer ??= setTimeout(() => {
        timer = undefined;
        for (const k of due) void queryClient.invalidateQueries({ queryKey: [k] });
        due.clear();
      }, REFRESH_EVERY_MS);
    };
    const unsubscribe = eventHub.subscribe((event) => applyEvent(queryClient, event, refreshSoon));
    eventHub.start();
    return () => {
      unsubscribe();
      eventHub.stop();
      clearTimeout(timer);
    };
  }, [queryClient]);
}

export function useStreamStatus() {
  return useSyncExternalStore(eventHub.subscribeStatus, eventHub.getStatus, eventHub.getStatus);
}

export function subscribeToEvents(listener: Parameters<typeof eventHub.subscribe>[0]) {
  return eventHub.subscribe(listener);
}
