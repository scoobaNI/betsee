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

// Gateway reasons sometimes carry policy ids ("forbid-resource-above-session-tier"); those belong in
// the policy cell, not in the sentence the presenter reads aloud.
const POLICY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/**
 * The human reason for a decision: the analyzer's finding when AI analysis tightened it, else the
 * Gateway's sentence reasons, else the deciding control's catalogue explanation.
 */
export function humanReason(
  action: Pick<ActionSummary, 'ai_tightened' | 'analyzer' | 'reasons' | 'policy_ids' | 'control_ids'>,
  controlDescription: (id: string) => string | undefined,
): string {
  // D12 / contract v0.2: analyzer.finding (alias analysis.finding) and reasons[] as {policy_id, control_id, text}.
  const finding =
    (action.analyzer as { finding?: string }).finding ?? (action as { analysis?: { finding?: string } }).analysis?.finding;
  if (action.ai_tightened) {
    const found = finding || action.analyzer.rationale;
    if (found) return found;
  }
  const texts = (action.reasons as unknown[]).map((r) => (typeof r === 'string' ? r : ((r as { text?: string })?.text ?? '')));
  const sentences = texts.filter((r) => r && !action.policy_ids.includes(r) && !POLICY_ID.test(r.trim()));
  if (sentences.length) return sentences.join(' ');
  const [first] = action.control_ids;
  return (first && controlDescription(first)) || '';
}

/** Where the decision's reason text comes from; an analyzer finding always shows with its MockBadge. */
export function reasonFromAnalyzer(action: Pick<ActionSummary, 'ai_tightened' | 'analyzer'>): boolean {
  const finding =
    (action.analyzer as { finding?: string }).finding ?? (action as { analysis?: { finding?: string } }).analysis?.finding;
  return action.ai_tightened && Boolean(finding || action.analyzer.rationale);
}

/** "Denied because CTL-TIER-001 Resource tier ceiling: ..." (contract section 14, copy). */
export function becauseSentence(
  action: Pick<ActionSummary, 'decision' | 'approval_state' | 'control_ids' | 'reasons' | 'policy_ids' | 'ai_tightened' | 'analyzer'>,
  control: (id: string) => { name?: string; description?: string } | undefined,
): string {
  const reason = humanReason(action, (id) => control(id)?.description);
  if (action.decision === 'allow') return reason || 'Every deterministic control passed.';
  const resolution = resolutionOf(action);
  const verdict = resolution ? `${resolution[0]!.toUpperCase()}${resolution.slice(1)}` : decisionLabel[action.decision];
  const [first] = action.control_ids;
  if (!first) return `${verdict}: ${reason || 'see the deciding stage below.'}`;
  const name = control(first)?.name;
  return `${verdict} because ${first}${name ? ` ${name}` : ''}: ${reason || 'see the deciding stage below.'}`;
}
