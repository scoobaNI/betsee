import type { Agent, ApprovalState, Decision } from '@betsee/api';
import { outcomeTone } from './decision.ts';

export interface EdgeLatest {
  trace_id: string;
  decision: Decision;
  approval_state: ApprovalState;
  ai_tightened: boolean;
  control_ids: string[];
  at: string;
}

export interface EdgeFacts {
  kind: 'session' | 'action' | 'message';
  latest: EdgeLatest | undefined;
  /** A message on this edge was stopped by the circuit breaker or by the quarantine it triggered. */
  breaker: boolean;
}

export interface EdgeStyle {
  stroke: string;
  dash: string | undefined;
  opacity: number;
}

const STROKE = {
  allow: 'var(--bs-color-accent-default)',
  deny: 'var(--bs-color-decision-deny-fg)',
  approval: 'var(--bs-color-decision-approval-fg)',
  stepup: 'var(--bs-color-decision-stepup-fg)',
  tightened: 'var(--bs-color-modifier-ai-tightened-fg)',
  quarantined: 'var(--bs-color-lifecycle-quarantined-fg)',
  neutral: 'var(--bs-color-border-strong)',
} as const;

const PENDING_DASH = '4 4';

// CTL-RUN-003 trips the breaker; CTL-ID-002 is the quarantine it leaves behind (demo/README.md, act 4).
export const stoppedByBreaker = (latest: EdgeLatest | undefined) =>
  Boolean(latest && latest.decision === 'deny' && (latest.control_ids.includes('CTL-RUN-003') || latest.control_ids.includes('CTL-ID-002')));

/** GraphCanvas edge rules (components.md): colour by latest decision, dashed while a human is pending. */
export function edgeStyle(edge: EdgeFacts, sourceState: Agent['state'] | undefined): EdgeStyle {
  // Sessions say who launched whom; they carry no decision of their own.
  if (edge.kind === 'session') return { stroke: STROKE.neutral, dash: undefined, opacity: 0.7 };
  if (edge.kind === 'message' && edge.breaker) return { stroke: STROKE.deny, dash: PENDING_DASH, opacity: 1 };
  if (edge.kind === 'message' && edge.latest?.decision === 'deny') return { stroke: STROKE.deny, dash: undefined, opacity: 1 };
  if (sourceState === 'quarantined') return { stroke: STROKE.quarantined, dash: PENDING_DASH, opacity: 0.9 };
  if (!edge.latest) return { stroke: STROKE.neutral, dash: undefined, opacity: 1 };
  const pending = edge.latest.approval_state === 'pending';
  if (edge.latest.ai_tightened) return { stroke: STROKE.tightened, dash: pending ? PENDING_DASH : undefined, opacity: 1 };
  const tone = outcomeTone(edge.latest);
  return { stroke: STROKE[tone], dash: pending ? PENDING_DASH : undefined, opacity: tone === 'allow' ? 0.55 : 1 };
}
