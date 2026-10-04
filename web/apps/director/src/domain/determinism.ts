import type { ActionSummary, Decision } from '@betsee/api';
import { isObservation, isStricter, outcomeTone } from './decision.ts';

export type Bucket = ReturnType<typeof outcomeTone>;

export interface DeterminismStats {
  /** Decided requests (observations excluded). */
  total: number;
  /** What the deterministic controls alone decided. */
  deterministic: Record<Decision, number>;
  /** What each request finally reads as, after AI analysis and any human. */
  final: Record<Bucket, number>;
  /** AI analysis actually ran (not skipped because a deterministic deny ended the pipeline). */
  analyzed: number;
  tightened: number;
  /**
   * Requests whose Gateway decision is less strict than the deterministic one, before any human.
   * The composition rule says this is always zero; the page shows it is, on this feed.
   */
  loosened: number;
  /** Approvals and step-ups a person resolved; the Gateway then rewrites the decision. */
  resolvedByPerson: number;
}

const zeroDecisions = (): Record<Decision, number> => ({ allow: 0, require_approval: 0, require_step_up: 0, deny: 0 });

export function determinismStats(actions: readonly ActionSummary[]): DeterminismStats {
  const stats: DeterminismStats = {
    total: 0,
    deterministic: zeroDecisions(),
    final: { allow: 0, approval: 0, stepup: 0, deny: 0 },
    analyzed: 0,
    tightened: 0,
    loosened: 0,
    resolvedByPerson: 0,
  };
  for (const a of actions) {
    if (isObservation(a)) continue;
    stats.total++;
    stats.deterministic[a.deterministic_decision]++;
    stats.final[outcomeTone(a)]++;
    if (a.analyzer.verdict !== 'skipped') stats.analyzed++;
    if (a.ai_tightened) stats.tightened++;
    const byPerson = a.approval_state !== 'none' && a.approval_state !== 'pending';
    if (byPerson) stats.resolvedByPerson++;
    else if (isStricter(a.deterministic_decision, a.decision)) stats.loosened++;
  }
  return stats;
}

export interface RepeatGroup {
  key: string;
  agent: string;
  capability: string;
  resource: string;
  /** Deterministic decisions in the order they happened, oldest first. */
  decisions: { decision: Decision; traceId: string; controls: string[] }[];
  consistent: boolean;
  /** Controls behind the decisions that differ from the most common one. */
  changedBy: string[];
}

/**
 * The same agent asking for the same capability on the same resource under the same use case more
 * than once. Deterministic controls must answer such repeats identically unless the state they
 * read changed (a tripped breaker, a spent budget, a quarantine); the deciding controls say which.
 */
export function repeatGroups(actions: readonly ActionSummary[]): RepeatGroup[] {
  const groups = new Map<string, RepeatGroup>();
  for (const a of [...actions].reverse()) {
    if (isObservation(a)) continue;
    const resource = `${a.resource.type}:${a.resource.id}`;
    const key = [a.agent.id, a.capability, resource, a.use_case?.id ?? '-'].join('|');
    const group = groups.get(key) ?? { key, agent: a.agent.id, capability: a.capability, resource: a.resource.id, decisions: [], consistent: true, changedBy: [] };
    group.decisions.push({ decision: a.deterministic_decision, traceId: a.trace_id, controls: a.control_ids });
    groups.set(key, group);
  }
  const repeats = [...groups.values()].filter((g) => g.decisions.length > 1);
  for (const group of repeats) {
    const counts = new Map<Decision, number>();
    for (const d of group.decisions) counts.set(d.decision, (counts.get(d.decision) ?? 0) + 1);
    const usual = [...counts].sort((x, y) => y[1] - x[1])[0]![0];
    group.consistent = counts.size === 1;
    group.changedBy = [...new Set(group.decisions.filter((d) => d.decision !== usual).flatMap((d) => d.controls))];
  }
  return repeats.sort((x, y) => Number(x.consistent) - Number(y.consistent) || y.decisions.length - x.decisions.length);
}
