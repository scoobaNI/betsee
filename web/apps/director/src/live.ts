import { subscribeToEvents, type ActionSummary, type StreamEvent } from '@betsee/api';
import { useRef, useSyncExternalStore } from 'react';
import { isObservation } from './domain/decision.ts';

/**
 * The latest moment something happened to an agent, a team or the whole organization, so a mark
 * can ping when it acts. Sequence numbers only grow; a component pings when the number it sees is
 * newer than the one it mounted with, never for history.
 */
export interface Pulse {
  seq: number;
  /** The action behind the pulse; absent for lifecycle changes. */
  action?: ActionSummary;
  kind: 'action' | 'message' | 'state';
}

const agents = new Map<string, Pulse>();
const teams = new Map<string, Pulse>();
let org: Pulse = { seq: 0, kind: 'action' };
let seq = 0;
const listeners = new Set<() => void>();
let subscribed = false;

function record(agentId: string, team: string | undefined, pulse: Omit<Pulse, 'seq'>) {
  seq++;
  const next = { ...pulse, seq };
  agents.set(agentId, next);
  if (team) teams.set(team, next);
  org = next;
  for (const listener of listeners) listener();
}

function onEvent(event: StreamEvent) {
  switch (event.type) {
    case 'action.decided':
    case 'action.updated':
      if (isObservation(event.data)) return;
      record(event.data.agent.id, event.data.agent.team, { kind: 'action', action: event.data });
      return;
    case 'message.mediated':
      record(event.data.sender.id, undefined, { kind: 'message' });
      return;
    case 'agent.state_changed':
      record(event.data.agent_id, undefined, { kind: 'state' });
      return;
  }
}

function subscribe(listener: () => void) {
  if (!subscribed) {
    subscribed = true;
    subscribeToEvents(onEvent);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const NONE: Pulse = { seq: 0, kind: 'action' };

function usePulseOf(read: () => Pulse): { pulse: Pulse; fresh: boolean } {
  const pulse = useSyncExternalStore(subscribe, read, read);
  const mounted = useRef(pulse.seq);
  return { pulse, fresh: pulse.seq > mounted.current };
}

export const useAgentPulse = (agentId: string | undefined) => usePulseOf(() => (agentId ? (agents.get(agentId) ?? NONE) : NONE));
export const useTeamPulse = (team: string) => usePulseOf(() => teams.get(team) ?? NONE);
export const useOrgPulse = () => usePulseOf(() => org);
