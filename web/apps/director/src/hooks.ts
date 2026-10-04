import { useAgents, useApprovals, useSummary, useToolDrift, useTraces, type ActionSummary, type Agent } from '@betsee/api';
import { useEffect, useMemo, useState } from 'react';
import { isObservation, withApprovalState } from './domain/decision.ts';
import { computeKpis, type Kpis } from './domain/feed.ts';

/** Whether a CSS media query matches, kept current as the window changes. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Re-renders on an interval so time windows slide even when no event arrives. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** Feed actions, newest first, with the approval record's state applied over a stale trace state (FAIL-1). */
export function useActions() {
  const traces = useTraces();
  const approvals = useApprovals();
  const actions = useMemo(() => {
    const recordState = new Map((approvals.data ?? []).map((a) => [a.trace_id, a.state as string]));
    return (traces.data ?? []).map((a) => withApprovalState(a, recordState));
  }, [traces.data, approvals.data]);
  return { actions, query: traces };
}

/** Headline counts; the Gateway's summary is authoritative for the four it carries (FAIL-1). */
export function useKpis(): { kpis: Kpis; loading: boolean } {
  const agents = useAgents();
  const summary = useSummary();
  const { actions, query } = useActions();
  const now = useNow();
  const kpis = useMemo(() => {
    const local = computeKpis(agents.data ?? [], actions.filter((a) => !isObservation(a)), now);
    const s = summary.data;
    return s
      ? { ...local, agentsActive: s.agents_active, actions15m: s.actions_last_15m, denied15m: s.denied_last_15m, awaitingHuman: s.awaiting_human }
      : local;
  }, [agents.data, actions, summary.data, now]);
  return { kpis, loading: agents.isPending || query.isPending };
}

export type AttentionItem =
  | { kind: 'agent'; key: string; agent: Agent }
  | { kind: 'awaiting'; key: string; action: ActionSummary }
  | { kind: 'tool'; key: string; tool: string; connector: string };

/** Everything that wants a human now: agents taken offline, actions waiting for a person, blocked tools. */
export function useAttention(): AttentionItem[] {
  const agents = useAgents();
  const approvals = useApprovals();
  const drift = useToolDrift();
  return useMemo(() => {
    const items: AttentionItem[] = [];
    for (const agent of agents.data ?? []) if (agent.state !== 'active') items.push({ kind: 'agent', key: `agent:${agent.id}`, agent });
    for (const [key, change] of drift) {
      if (change.status === 'blocked') items.push({ kind: 'tool', key: `tool:${key}`, tool: change.tool, connector: change.connector_id });
    }
    // Pending approval records, the same source as the approvals inbox and the Gateway's count.
    for (const approval of approvals.data ?? []) {
      if (approval.state === 'pending') items.push({ kind: 'awaiting', key: `trace:${approval.trace_id}`, action: { ...approval.action, approval_state: 'pending' } });
    }
    return items;
  }, [agents.data, approvals.data, drift]);
}
