import { apiConfig, origin } from './client.ts';
import { openEventStream, type EventStreamHandle, type StreamStatus } from './stream.ts';
import type { StreamEvent, StreamEventType } from './types.ts';

export type StreamListener = (event: StreamEvent, id: number) => void;

const KNOWN: ReadonlySet<string> = new Set<StreamEventType>([
  'action.decided',
  'action.updated',
  'agent.state_changed',
  'message.mediated',
  'session.started',
  'session.ended',
  'tool.descriptor_changed',
  'security.event',
]);

// v0 called message.mediated agent_message; a Gateway still on v0 keeps working.
const ALIASES: Record<string, StreamEventType> = { agent_message: 'message.mediated' };

// Delivery is at least once (contracts/events.md); ids remembered for deduplication.
const SEEN_LIMIT = 5_000;

export function createEventHub() {
  const listeners = new Set<StreamListener>();
  const statusListeners = new Set<() => void>();
  const seen = new Set<number>();
  let status: StreamStatus = 'connecting';
  let handle: EventStreamHandle | undefined;
  let users = 0;

  const setStatus = (next: StreamStatus) => {
    status = next;
    for (const listener of statusListeners) listener();
  };

  const remember = (id: number) => {
    seen.add(id);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as number);
  };

  return {
    /** Reference counted, so React StrictMode's mount-unmount-mount keeps one connection. */
    start() {
      users++;
      if (handle) return;
      const { fetch: fetchImpl, getAccessToken } = apiConfig();
      handle = openEventStream({
        url: `${origin()}/api/v1/events/stream`,
        fetch: fetchImpl ?? globalThis.fetch.bind(globalThis),
        getAccessToken,
        onStatus: setStatus,
        onMessage: (message) => {
          const id = Number(message.id);
          if (Number.isFinite(id) && message.id !== '') {
            if (seen.has(id)) return;
            remember(id);
          }
          const type = ALIASES[message.event] ?? message.event;
          if (!KNOWN.has(type)) return;
          let data: unknown;
          try {
            data = JSON.parse(message.data);
          } catch {
            console.error('event stream: unparseable data for', message.event, message.id);
            return;
          }
          const event = { type, data } as StreamEvent;
          for (const listener of listeners) listener(event, id);
        },
      });
    },
    stop() {
      users = Math.max(0, users - 1);
      if (users > 0 || !handle) return;
      handle.close();
      handle = undefined;
    },
    retry() {
      handle?.retry();
    },
    subscribe(listener: StreamListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeStatus(listener: () => void) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    getStatus: () => status,
  };
}

export type EventHub = ReturnType<typeof createEventHub>;

export const eventHub: EventHub = createEventHub();
