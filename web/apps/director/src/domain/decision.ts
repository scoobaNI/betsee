import type { ActionSummary, AnalyzerVerdict, Decision } from '@betsee/api';

// Composition order from the Gateway (p-31): deny > step-up > approval > allow.
const severity: Record<Decision, number> = {
  allow: 0,
  require_approval: 1,
  require_step_up: 2,
  deny: 3,
};

export const isStricter = (a: Decision, b: Decision) => severity[a] > severity[b];

export type Resolution = 'approved' | 'rejected' | 'verified' | 'failed' | null;

/** Maps the contract's approval_state onto the DecisionChip's resolution words. */
export function resolutionOf(action: Pick<ActionSummary, 'decision' | 'approval_state'>): Resolution {
  if (action.approval_state === 'approved') return action.decision === 'require_step_up' ? 'verified' : 'approved';
  if (action.approval_state === 'rejected') return action.decision === 'require_step_up' ? 'failed' : 'rejected';
  return null;
}

export const isAwaitingHuman = (action: Pick<ActionSummary, 'decision' | 'approval_state'>) =>
  (action.decision === 'require_approval' || action.decision === 'require_step_up') &&
  action.approval_state === 'pending';

/** The colour family an action finally reads as, for ticks, edges and evidence bars. */
export function outcomeTone(action: Pick<ActionSummary, 'decision' | 'approval_state'>): 'allow' | 'deny' | 'approval' | 'stepup' {
  const resolution = resolutionOf(action);
  if (resolution === 'approved' || resolution === 'verified') return 'allow';
  if (resolution === 'rejected' || resolution === 'failed') return 'deny';
  if (action.decision === 'require_approval') return 'approval';
  if (action.decision === 'require_step_up') return 'stepup';
  return action.decision;
}

export const decisionLabel: Record<Decision, string> = {
  allow: 'Allowed',
  deny: 'Denied',
  require_approval: 'Awaiting approval',
  require_step_up: 'Awaiting step-up',
};

export const analyzerVerdictLabel: Record<AnalyzerVerdict, string> = {
  clean: 'Clean',
  suspicious: 'Suspicious',
  malicious: 'Malicious',
  unavailable: 'Unavailable',
  skipped: 'Not run',
};

/** "Denied because CTL-TIER-001 Resource tier ceiling: ..." (contract section 14, copy). */
export function becauseSentence(
  action: Pick<ActionSummary, 'decision' | 'approval_state' | 'control_ids' | 'reasons'>,
  controlName: (id: string) => string | undefined,
): string {
  const reason = action.reasons.join(' ').trim();
  if (action.decision === 'allow') return reason || 'Every deterministic control passed.';
  const resolution = resolutionOf(action);
  const verdict = resolution ? `${resolution[0]!.toUpperCase()}${resolution.slice(1)}` : decisionLabel[action.decision];
  const [first] = action.control_ids;
  if (!first) return `${verdict}: ${reason || 'see the deciding stage below.'}`;
  const name = controlName(first);
  return `${verdict} because ${first}${name ? ` ${name}` : ''}: ${reason || 'see the deciding stage below.'}`;
}
