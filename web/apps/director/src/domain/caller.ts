import type { Human } from '@betsee/api';

export type CallerKind = 'human' | 'unauthenticated' | 'gateway';

export interface Caller {
  kind: CallerKind;
  /** Stable key: the human's sub, or 'unknown' / 'system'. */
  id: string;
  name: string;
}

/**
 * Who initiated a request. Requests without an authenticated human or session (forged or foreign
 * sessions) carry no human or sub 'unknown'; the Gateway's own observer uses sub 'system'
 * (p-417). Neither is ever drawn as a human (components.md, GraphCanvas, p-420).
 */
export function callerOf(human: Human | undefined | null): Caller {
  if (!human || human.sub === 'unknown') return { kind: 'unauthenticated', id: 'unknown', name: 'Unauthenticated' };
  if (human.sub === 'system') return { kind: 'gateway', id: 'system', name: 'Gateway' };
  return { kind: 'human', id: human.sub, name: human.display_name };
}

export const callerLabel = (caller: Caller) => (caller.kind === 'human' ? caller.name : `${caller.name} (${caller.id})`);
