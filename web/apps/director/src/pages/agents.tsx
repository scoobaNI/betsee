import { useAgents, useSessions, type ActionSummary, type Agent } from '@betsee/api';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/icon.tsx';
import { Rise, Stagger } from '../components/motion.tsx';
import { assignAgents, OrgChart } from '../components/org-chart.tsx';
import { PersonSheet } from '../components/person-sheet.tsx';
import { chatsByPerson, principalIds } from '../domain/chats.ts';
import { ZoomCanvas } from '../components/zoom.tsx';
import { ReasonText } from '../components/reason.tsx';
import { ActionVerdict, AgentGlyph, Avatar, Bleed, Card, EASE, EmptyState, ErrorCard, Meter, PageHeader, Section, Segmented, Skeleton, StatePill, TickStrip } from '../components/ui.tsx';
import { groupByTeam, recentByAgent, teamName } from '../domain/feed.ts';
import { formatCents, formatTime } from '../domain/format.ts';
import { PEOPLE, personByName, reportsOf } from '../domain/people.ts';
import { isObservation } from '../domain/decision.ts';
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
      className={`group row-hover grid grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-4 rounded-xl px-4 py-4 transition-colors duration-500 lg:grid-cols-[40px_minmax(0,1.3fr)_minmax(0,1.2fr)_120px_140px_16px] ${
        offline ? 'bg-quar-soft/50' : ''
      }`}
    >
      <AgentGlyph state={agent.state} size={40} agentId={agent.id} />
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

type View = 'chart' | 'list';

const LEGEND: { swatch: ReactNode; label: string }[] = [
  {
    swatch: (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
        <Icon name="key" size={10} />
      </span>
    ),
    label: 'Signs in to Betsee',
  },
  { swatch: <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />, label: 'Request to an agent' },
  { swatch: <span className="h-2.5 w-2.5 rounded-full bg-ok shadow-[0_0_8px_var(--color-ok)]" />, label: 'Decision coming back' },
  { swatch: <span className="h-0 w-6 border-t-2 border-dashed border-line-strong" />, label: 'Idle agent, no session' },
  {
    swatch: (
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
        <Icon name="chat" size={11} />
      </span>
    ),
    label: 'Open chat, gone when it ends',
  },
];

/** The latest requests people made through their agents, newest first. */
function Conversations({ actions }: { actions: readonly ActionSummary[] }) {
  const rows = useMemo(() => actions.filter((a) => !isObservation(a) && personByName(a.human?.display_name)).slice(0, 8), [actions]);
  return (
    <Section title="Conversations" hint="People and their agents, live">
      <Card className="p-2">
        {rows.length ? (
          <ul className="divide-y divide-line/70">
            <AnimatePresence initial={false}>
              {rows.map((a) => (
                <motion.li
                  key={a.trace_id}
                  className="overflow-hidden"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                >
                  <Link to={`/traces/${encodeURIComponent(a.trace_id)}`} className="group row-hover flex items-center gap-4 rounded-2xl px-4 py-3.5">
                    <span className="font-mono text-[12px] text-ink-3 tabular-nums">{formatTime(a.occurred_at)}</span>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={a.human!.display_name} size={36} />
                      <span className="hidden text-[14.5px] font-semibold text-ink sm:inline">{a.human!.display_name}</span>
                    </span>
                    <span className="relative flex w-16 items-center text-ink-4">
                      <span className="h-px flex-1 bg-line-strong" />
                      <Icon name="arrow-right" size={14} />
                    </span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <AgentGlyph size={36} agentId={a.agent.id} />
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] font-semibold text-ink">{a.agent.id}</span>
                        <span className="block truncate font-mono text-[12px] text-ink-3">
                          {a.capability} on {a.resource.id}
                        </span>
                      </span>
                    </span>
                    <span className="ml-auto">
                      <ActionVerdict action={a} size="sm" />
                    </span>
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <EmptyState icon="chat" title="No conversation yet" body="When someone asks an agent to act, the request and its decision appear here." />
        )}
      </Card>
    </Section>
  );
}

/** The people org chart with its toolbar, the profile sheet and the live conversation log. */
function PeopleChart({ agents, actions }: { agents: Agent[]; actions: readonly ActionSummary[] }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get('person');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sessions = useSessions();
  const sessionList = useMemo(() => sessions.data ?? [], [sessions.data]);
  const assignments = useMemo(() => assignAgents(agents, sessionList), [agents, sessionList]);
  const principals = useMemo(() => principalIds(sessionList, actions, agents), [sessionList, actions, agents]);
  const chats = useMemo(() => chatsByPerson(sessionList), [sessionList]);
  const open = useCallback(
    (id: string | null) => {
      const out = new URLSearchParams(params);
      if (id) out.set('person', id);
      else out.delete('person');
      setParams(out, { replace: true });
    },
    [params, setParams],
  );
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const executives = PEOPLE.filter((p) => reportsOf(p.id).length && p.manager);
  return (
    <div className="space-y-14">
      <Bleed>
        <div className="dot-grid overflow-clip rounded-[30px] border border-line bg-surface/60 shadow-card">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line/70 bg-surface/70 px-6 py-4 backdrop-blur sm:px-8">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-medium text-ink-2">
              {LEGEND.map((item) => (
                <li key={item.label} className="flex items-center gap-2">
                  {item.swatch}
                  {item.label}
                </li>
              ))}
            </ul>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCollapsed(new Set())}
                className="press inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink-2 shadow-card transition-colors hover:text-ink"
              >
                <Icon name="fit" size={15} />
                Expand all
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(new Set(executives.map((p) => p.id)))}
                className="press inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink-2 shadow-card transition-colors hover:text-ink"
              >
                <Icon name="network" size={15} />
                Leadership only
              </button>
            </div>
          </div>
          <ZoomCanvas>
            <OrgChart assignments={assignments} principals={principals} actions={actions} selected={selected} onOpen={open} collapsed={collapsed} onToggle={toggle} />
          </ZoomCanvas>
        </div>
      </Bleed>
      <Conversations actions={actions} />
      <PersonSheet
        personId={selected}
        assignments={assignments}
        principals={principals}
        chats={chats}
        actions={actions}
        onOpen={open}
        onClose={() => open(null)}
      />
    </div>
  );
}

export function AgentsPage() {
  const agents = useAgents();
  const { actions } = useActions();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'list' ? 'list' : 'chart';
  const teams = useMemo(() => groupByTeam(agents.data ?? []), [agents.data]);

  const setView = (next: View) => {
    const out = new URLSearchParams(params);
    if (next === 'list') out.set('view', 'list');
    else out.delete('view');
    setParams(out, { replace: true });
  };

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/' }, { label: view === 'chart' ? 'Org chart' : 'Agents' }]}
        title={view === 'chart' ? 'Org chart' : 'Agents'}
        actions={
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Org chart' },
              { value: 'list', label: 'List' },
            ]}
          />
        }
      />
      <AnimatePresence mode="wait" initial={false}>
        {view === 'chart' ? (
          <motion.div key="chart" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ duration: 0.25, ease: EASE }}>
            {agents.isPending && <Skeleton className="h-[520px]" />}
            {agents.isError && <ErrorCard title="Could not load agents" error={agents.error} onRetry={() => void agents.refetch()} />}
            {agents.data && !teams.length && (
              <Card>
                <EmptyState icon="bot" title="No agents registered" body="Run scripts/bootstrap to register the demo agents." />
              </Card>
            )}
            {agents.data && teams.length > 0 && <PeopleChart agents={agents.data} actions={actions} />}
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: EASE }}>
            <AgentList />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentList() {
  const agents = useAgents();
  const { actions } = useActions();
  const [params, setParams] = useSearchParams();
  const team = params.get('team') ?? 'all';
  const teams = useMemo(() => groupByTeam(agents.data ?? []), [agents.data]);
  const recent = useMemo(() => recentByAgent(actions), [actions]);
  const shown = team === 'all' ? teams : teams.filter(([t]) => t === team);
  const total = agents.data?.length ?? 0;
  const setTeam = (value: string) => {
    const out = new URLSearchParams(params);
    if (value === 'all') out.delete('team');
    else out.set('team', value);
    setParams(out, { replace: true });
  };

  return (
    <div>
      {teams.length > 1 && (
        <div className="mb-8">
          <Segmented
            label="Team"
            value={team}
            onChange={setTeam}
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
      <Stagger key={team} className="space-y-12" step={0.07}>
        {shown.map(([t, list]) => (
          <Rise key={t}>
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
          </Rise>
        ))}
      </Stagger>
    </div>
  );
}
