import { useAgents, useApprovals, useSummary, useTraces } from '@betsee/api';
import { KpiTile } from '@betsee/ui';
import { useEffect, useMemo, useState } from 'react';
import { useMatch } from 'react-router';
import { AgentTile } from '../components/agent-tile.tsx';
import { EmptyState, ErrorCard, Skeleton } from '../components/states.tsx';
import { isObservation, withApprovalState } from '../domain/decision.ts';
import { computeKpis, groupByTeam, recentByAgent, teamName } from '../domain/feed.ts';
import { formatCount } from '../domain/format.ts';

/** Re-renders every 30 s so the 15-minute window slides even when no event arrives. */
function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

function StatStrip() {
  const agents = useAgents();
  const traces = useTraces();
  const approvals = useApprovals();
  const summary = useSummary();
  const now = useNow();
  const kpis = useMemo(() => {
    // Observations are not decisions, and the approval record beats a stale trace state.
    const recordState = new Map((approvals.data ?? []).map((a) => [a.trace_id, a.state as string]));
    const decided = (traces.data ?? []).filter((a) => !isObservation(a)).map((a) => withApprovalState(a, recordState));
    const local = computeKpis(agents.data ?? [], decided, now);
    // FAIL-1: the Gateway's summary is authoritative for the four counts it carries (same as Home).
    const s = summary.data;
    return s
      ? { ...local, agentsActive: s.agents_active, actions15m: s.actions_last_15m, denied15m: s.denied_last_15m, awaitingHuman: s.awaiting_human }
      : local;
  }, [agents.data, traces.data, approvals.data, summary.data, now]);
  if (agents.isPending || traces.isPending) {
    return (
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  const offLine = kpis.agentsQuarantined + kpis.agentsSuspended;
  return (
    <div className="grid grid-cols-5 gap-3">
      <KpiTile
        compact
        feature
        label="Agents active"
        value={formatCount(kpis.agentsActive)}
        detail={
          offLine
            ? [kpis.agentsQuarantined && `${kpis.agentsQuarantined} quarantined`, kpis.agentsSuspended && `${kpis.agentsSuspended} suspended`].filter(Boolean).join(', ')
            : 'None quarantined'
        }
      />
      <KpiTile compact label="Actions, 15 min" value={formatCount(kpis.actions15m)} detail="Each one a trace" />
      <KpiTile compact label="Denied, 15 min" value={formatCount(kpis.denied15m)} detail="Never executed" />
      <KpiTile compact label="Awaiting human" value={formatCount(kpis.awaitingHuman)} detail="Approval or step-up" />
      <KpiTile compact label="AI-tightened, 15 min" value={formatCount(kpis.tightened15m)} detail="Analyzer raised it" />
    </div>
  );
}

function Population() {
  const agents = useAgents();
  const traces = useTraces();
  const selected = useMatch('/agents/:agentId')?.params.agentId;
  const recent = useMemo(() => recentByAgent(traces.data ?? []), [traces.data]);
  const teams = useMemo(() => groupByTeam(agents.data ?? []), [agents.data]);

  if (agents.isPending) {
    return (
      <div className="flex flex-wrap gap-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-56 w-73" />
        ))}
      </div>
    );
  }
  if (agents.isError) return <ErrorCard title="Could not load agents" error={agents.error} onRetry={() => void agents.refetch()} />;
  if (teams.length === 0) {
    return (
      <div className="rounded-lg border border-line-subtle bg-surface-1">
        <EmptyState icon="streamline-flex:ai-chip-robot" title="No agents registered" body="Run scripts/bootstrap to register the demo agents." />
      </div>
    );
  }
  return (
    // Team groups flow side by side so the whole population fits without scrolling (contract 6).
    <div className="flex flex-wrap gap-x-5 gap-y-3">
      {teams.map(([team, list]) => (
        <section key={team} aria-label={`${team} agents`}>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[var(--bs-font-tracking-caps)] text-fg-tertiary">{teamName(team)}</h3>
          <div className="flex gap-5">
            {list.map((agent) => (
              <AgentTile key={agent.id} agent={agent} recent={recent.get(agent.id) ?? []} selected={selected === agent.id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function LivePage() {
  return (
    <div className="space-y-4">
      <h1 className="sr-only">See every agent</h1>
      <StatStrip />
      <Population />
    </div>
  );
}
