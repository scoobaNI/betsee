import { useAgents, type ActionSummary, type Agent } from '@betsee/api';
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/icon.tsx';
import { ReasonText } from '../components/reason.tsx';
import { AgentGlyph, Avatar, Card, EASE, EmptyState, ErrorCard, Meter, PageHeader, Section, Segmented, Skeleton, StatePill, TickStrip } from '../components/ui.tsx';
import { groupByTeam, recentByAgent, teamName } from '../domain/feed.ts';
import { formatCents, formatTime } from '../domain/format.ts';
import { useActions } from '../hooks.ts';

// Budgets arrive in cents; the demo use cases price in EUR (payment threshold 10,000.00 EUR).
export const BUDGET_CURRENCY = 'EUR';

function AgentRow({ agent, recent }: { agent: Agent; recent: ActionSummary[] }) {
  const session = agent.current_session;
  const offline = agent.state !== 'active';
  const ratio = agent.budget.limit > 0 ? agent.budget.used / agent.budget.limit : 0;
  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.id)}`}
      aria-label={`${agent.id}, ${agent.state}`}
      className={`group row-hover grid grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-4 rounded-xl px-4 py-4 lg:grid-cols-[40px_minmax(0,1.3fr)_minmax(0,1.2fr)_120px_140px_16px] ${
        offline ? 'bg-quar-soft/50' : ''
      }`}
    >
      <AgentGlyph state={agent.state} size={40} />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium text-ink">{agent.id}</span>
          {offline && <StatePill state={agent.state} />}
        </span>
        {offline ? (
          <span className="mt-0.5 block text-[13px] leading-relaxed text-quar-ink">
            {agent.state_changed_at && <span className="mr-1.5 font-mono text-[12px]">{formatTime(agent.state_changed_at)}</span>}
            {agent.state_reason ? <ReasonText text={agent.state_reason} linked={false} /> : 'Every action is denied until a security officer releases it.'}
          </span>
        ) : (
          <span className="mt-0.5 block truncate text-[13px] text-ink-3">
            {agent.provider} <span className="font-mono text-[12px]">{agent.model}</span>
          </span>
        )}
      </span>
      <span className="hidden min-w-0 items-center gap-2.5 lg:flex">
        {session ? (
          <>
            <Avatar name={session.human.display_name} size={26} />
            <span className="min-w-0">
              <span className="block truncate text-[14px] text-ink">{session.human.display_name}</span>
              <span className="block truncate text-[12px] text-ink-3">{session.use_case.name}</span>
            </span>
          </>
        ) : (
          <span className="text-[13px] text-ink-3">No active session</span>
        )}
      </span>
      <span className="hidden lg:block">
        <TickStrip actions={recent} />
      </span>
      <span className="hidden lg:block">
        <Meter ratio={ratio} label="Session budget" />
        <span className="mt-1.5 block text-[12px] text-ink-3 tabular-nums">
          {formatCents(agent.budget.used)} of {formatCents(agent.budget.limit)} {BUDGET_CURRENCY}
        </span>
      </span>
      <Icon name="chevron-right" size={16} className="text-ink-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

export function AgentsPage() {
  const agents = useAgents();
  const { actions } = useActions();
  const [params, setParams] = useSearchParams();
  const team = params.get('team') ?? 'all';
  const teams = useMemo(() => groupByTeam(agents.data ?? []), [agents.data]);
  const recent = useMemo(() => recentByAgent(actions), [actions]);
  const shown = team === 'all' ? teams : teams.filter(([t]) => t === team);
  const total = agents.data?.length ?? 0;
  const offline = (agents.data ?? []).filter((a) => a.state !== 'active').length;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Agents' }]}
        title="Agents"
        description={
          total
            ? `${total} agents across ${teams.length} teams${offline ? `, ${offline} taken offline` : ''}. Open one to see its session, what it may do, and everything it did.`
            : 'Every agent registered with the Gateway.'
        }
      />
      {teams.length > 1 && (
        <div className="mb-8">
          <Segmented
            label="Team"
            value={team}
            onChange={(value) => setParams(value === 'all' ? {} : { team: value }, { replace: true })}
            options={[{ value: 'all', label: 'All teams', count: total }, ...teams.map(([t, list]) => ({ value: t, label: teamName(t), count: list.length }))]}
          />
        </div>
      )}
      {agents.isPending && (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {agents.isError && <ErrorCard title="Could not load agents" error={agents.error} onRetry={() => void agents.refetch()} />}
      {agents.data && !teams.length && (
        <Card>
          <EmptyState icon="bot" title="No agents registered" body="Run scripts/bootstrap to register the demo agents." />
        </Card>
      )}
      <div className="space-y-12">
        {shown.map(([t, list]) => (
          <motion.div key={t} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
            <Section title={teamName(t)} hint={`${list.length} ${list.length === 1 ? 'agent' : 'agents'}`}>
              <Card className="p-2">
                <ul className="divide-y divide-line/70">
                  {list.map((agent) => (
                    <li key={agent.id}>
                      <AgentRow agent={agent} recent={recent.get(agent.id) ?? []} />
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
