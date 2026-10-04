import { useAgentMessages, useAgents, useReleaseAgent, useUseCases, type ActionSummary, type Agent, type AgentSession, type UseCase } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ActivityList } from '../components/activity.tsx';
import { formatClock, Sparkline } from '../components/charts.tsx';
import { Icon, type IconName } from '../components/icon.tsx';
import { Burst, Rise, Stagger, Swap, TONE_COLOR, trackPointer, useRises } from '../components/motion.tsx';
import { ReasonText } from '../components/reason.tsx';
import {
  AgentGlyph,
  AnimatedNumber,
  Avatar,
  Breadcrumbs,
  Button,
  Card,
  Code,
  Disclosure,
  EASE,
  ECOSYSTEM_URL,
  EmptyState,
  ErrorCard,
  KeyValues,
  StatusBadge,
  outcomeOf,
  Section,
  Skeleton,
  StatePill,
  TextLink,
  TickStrip,
  TierText,
  toneClass,
  type Tone,
} from '../components/ui.tsx';
import { isObservation } from '../domain/decision.ts';
import { teamName } from '../domain/feed.ts';
import { formatAge, formatCents, formatCount, formatDateTime, formatTime } from '../domain/format.ts';
import { bucketize } from '../domain/series.ts';
import { useActions, useNow } from '../hooks.ts';
import { BUDGET_CURRENCY } from './agents.tsx';

/** Which human step a use case puts in front of a capability, in the words the presenter reads. */
function qualifiersFor(useCase: UseCase | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const capability of useCase?.approval_required ?? []) out[capability] = 'approval';
  for (const capability of useCase?.step_up_required ?? []) out[capability] = out[capability] ? 'approval + step-up' : 'step-up';
  if (useCase && useCase.approval_threshold_cents > 0) {
    for (const capability of Object.keys(out)) {
      if (capability.startsWith('payments.')) out[capability] = `above ${formatCents(useCase.approval_threshold_cents)} ${BUDGET_CURRENCY}: ${out[capability]}`;
    }
  }
  return out;
}

function Mark({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ok-soft text-ok-ink">
      <Icon name="check" size={13} />
    </span>
  ) : (
    <span className="inline-flex h-6 w-6 items-center justify-center text-ink-4">
      <Icon name="x" size={13} />
    </span>
  );
}

/** Effective = delegated by the human AND permitted for the use case; the table shows why. */
function Capabilities({ session, useCase }: { session: AgentSession; useCase: UseCase | undefined }) {
  const permitted = useCase?.permitted ?? session.effective;
  const qualifiers = qualifiersFor(useCase);
  const all = [...new Set([...session.delegated, ...permitted, ...session.effective])].sort();
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <p className="text-[13px] text-ink-3">
          {session.effective.length} {session.effective.length === 1 ? 'capability' : 'capabilities'} in effect for {session.use_case.name}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {session.effective.map((capability) => (
            <span key={capability} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5">
              <span className="font-mono text-[13px] text-ink">{capability}</span>
              {qualifiers[capability] && <span className="rounded-md bg-wait-soft px-1.5 text-[11px] font-medium text-wait-ink">{qualifiers[capability]}</span>}
            </span>
          ))}
          {!session.effective.length && <span className="text-[14px] text-ink-3">No capability is both delegated and permitted, so every action is denied.</span>}
        </div>
      </Card>
      <Disclosure title="How this was derived" hint="Delegated by the human, intersected with what the use case permits" icon="layers">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th className="pb-3 font-medium">Capability</th>
              <th className="w-28 pb-3 text-center font-medium">Delegated</th>
              <th className="w-28 pb-3 text-center font-medium">Permitted</th>
              <th className="w-28 pb-3 text-center font-medium">Effective</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {all.map((capability) => (
              <tr key={capability}>
                <td className="py-2.5 font-mono text-[13px] text-ink">{capability}</td>
                <td className="text-center">
                  <Mark on={session.delegated.includes(capability)} />
                </td>
                <td className="text-center">
                  <Mark on={permitted.includes(capability)} />
                </td>
                <td className="text-center">
                  <Mark on={session.effective.includes(capability)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Disclosure>
    </div>
  );
}

function ReleaseBanner({ agentId, state, reason, at }: { agentId: string; state: 'quarantined' | 'suspended'; reason: string | null; at: string | null }) {
  const release = useReleaseAgent();
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="mb-12">
      <div className="flex flex-wrap items-start gap-5 rounded-2xl border border-quar/25 bg-quar-soft p-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-quar-ink shadow-card">
          <Icon name="power" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold text-quar-ink">
            {state === 'quarantined' ? 'Quarantined' : 'Suspended'}
            {at ? ` at ${formatTime(at)}` : ''}
          </p>
          {reason && (
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink">
              <ReasonText text={reason} />
            </p>
          )}
          <p className="mt-2 text-[13px] text-ink-2">Every action this agent attempts is denied until a security officer releases it.</p>
          {release.isError && <p className="mt-2 text-[13px] text-bad-ink">{release.error.message}</p>}
        </div>
        <Button variant="primary" icon="power" disabled={release.isPending} onClick={() => release.mutate(agentId)}>
          {release.isPending ? 'Releasing' : 'Release agent'}
        </Button>
      </div>
    </motion.div>
  );
}

const WINDOW_MS = 15 * 60_000;

/** Budget spent as a half dial; amber from 80 percent, red when spent. */
function BudgetGauge({ ratio }: { ratio: number }) {
  const reduce = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, ratio));
  const color = clamped >= 1 ? 'var(--color-bad)' : clamped >= 0.8 ? 'var(--color-wait)' : 'var(--color-accent)';
  const arc = 'M 10 62 A 52 52 0 0 1 114 62';
  return (
    <span className="relative block w-[124px]">
      <svg viewBox="0 0 124 70" width="124" height="70" aria-hidden="true">
        <path d={arc} fill="none" stroke="var(--color-sunken)" strokeWidth="10" strokeLinecap="round" />
        <motion.path
          d={arc}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: Math.max(0.004, clamped) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          style={{ transition: 'stroke 500ms' }}
        />
      </svg>
      <span className="absolute inset-x-0 bottom-0 text-center text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {Math.round(clamped * 100)}
        <span className="text-[13px] text-ink-3">%</span>
      </span>
    </span>
  );
}

function Tile({
  label,
  icon,
  tone,
  children,
  sub,
  value,
  chart,
}: {
  label: string;
  icon: IconName;
  tone: Tone;
  children: ReactNode;
  sub: ReactNode;
  value?: number;
  chart?: ReactNode;
}) {
  const rises = useRises(value ?? 0);
  return (
    <div onPointerMove={trackPointer} style={{ ['--spot' as string]: TONE_COLOR[tone] }} className="group spotlight flex h-full flex-col rounded-[24px] border border-line bg-surface p-7 shadow-card">
      {value !== undefined && <Burst trigger={rises || undefined} color={TONE_COLOR[tone]} radius="24px" strength={1.05} />}
      <p className="flex items-center gap-3 text-[14.5px] font-semibold text-ink-2">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-[12px] transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-4deg]"
          style={{ background: `color-mix(in srgb, ${TONE_COLOR[tone]} 13%, transparent)`, color: TONE_COLOR[tone] }}
        >
          <Icon name={icon} size={19} />
        </span>
        {label}
      </p>
      <div className="mt-5">{children}</div>
      <p className="mt-3 text-[13.5px] text-ink-3">{sub}</p>
      {chart && <div className="-mx-7 -mb-7 mt-auto pt-5">{chart}</div>}
    </div>
  );
}

/** Who the agent is, who launched it, and its last decisions as a strip that grows live. */
function AgentHero({ agent, decided }: { agent: Agent; decided: ActionSummary[] }) {
  const now = useNow(10_000);
  const session = agent.current_session;
  const last = decided[0];
  const strip = useMemo(() => decided.slice(0, 32).reverse(), [decided]);
  const tone: Tone = agent.state === 'quarantined' ? 'quar' : agent.state === 'suspended' ? 'muted' : 'accent';
  return (
    <Card className="relative overflow-hidden p-6 md:p-8">
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -top-28 -right-20 h-72 w-72 rounded-full blur-3xl"
        animate={{ background: TONE_COLOR[tone], opacity: agent.state === 'active' ? 0.12 : 0.22 }}
        transition={{ duration: 0.8 }}
      />
      <div className="relative flex flex-wrap items-start gap-5">
        <motion.span initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}>
          <AgentGlyph state={agent.state} size={56} agentId={agent.id} />
        </motion.span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">{agent.id}</h1>
            <StatePill state={agent.state} />
          </div>
          <p className="mt-1 text-[14px] text-ink-3">
            {teamName(agent.team)} team - {agent.provider} <span className="font-mono text-[13px]">{agent.model}</span>
          </p>
          {session && (
            <p className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-full border border-line bg-surface/80 py-1 pr-3.5 pl-1 text-[13px] text-ink-2 shadow-card">
              <Avatar name={session.human.display_name} size={24} />
              Launched by <span className="font-medium text-ink">{session.human.display_name}</span> for <span className="font-medium text-ink">{session.use_case.name}</span>
            </p>
          )}
        </div>
        <TextLink href={`${ECOSYSTEM_URL}/identity/agents/${encodeURIComponent(agent.id)}`}>Edit delegation</TextLink>
      </div>
      <div className="relative mt-7 rounded-xl border border-line/70 bg-sunken/50 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
          <span className="font-medium text-ink-2">Recent decisions</span>
          {last && (
            <Swap id={last.trace_id} className="ml-auto">
              <Link to={`/traces/${encodeURIComponent(last.trace_id)}`} className="inline-flex items-center gap-2 hover:text-ink">
                <span className={`h-1.5 w-1.5 rounded-full ${toneClass(outcomeOf(last).tone).dot}`} />
                <span className="font-mono text-[11px] text-ink-2">{last.capability}</span>
                <span>{outcomeOf(last).label.toLowerCase()}</span>
                <span>{formatAge(last.occurred_at, now)}</span>
              </Link>
            </Swap>
          )}
        </div>
        <TickStrip tall actions={strip} className="mt-3" />
      </div>
    </Card>
  );
}

export function AgentPage() {
  const { agentId = '' } = useParams();
  const agents = useAgents();
  const useCases = useUseCases();
  const messages = useAgentMessages();
  const { actions } = useActions();
  const agent = agents.data?.find((a) => a.id === agentId);
  const session = agent?.current_session ?? null;
  const useCase = useCases.data?.find((u) => u.id === session?.use_case.id);
  const mine = useMemo(() => actions.filter((a) => a.agent.id === agentId), [actions, agentId]);
  const traffic = useMemo(
    () => (messages.data ?? []).filter((m) => m.sender.id === agentId || m.receiver.id === agentId).slice(0, 6),
    [messages.data, agentId],
  );

  if (agents.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (agents.isError) return <ErrorCard title="Could not load the agent" error={agents.error} onRetry={() => void agents.refetch()} />;
  if (!agent) {
    return (
      <Card>
        <EmptyState icon="bot" title="Agent not found" body={`No agent ${agentId} is registered.`}>
          <TextLink to="/agents">All agents</TextLink>
        </EmptyState>
      </Card>
    );
  }

  const decided = mine.filter((a) => !isObservation(a));
  const recent = decided.filter((a) => Date.now() - Date.parse(a.occurred_at) <= WINDOW_MS);
  const denied = recent.filter((a) => a.decision === 'deny').length;
  const series = bucketize(decided, Date.now(), WINDOW_MS, 15);
  const budgetRatio = agent.budget.limit > 0 ? agent.budget.used / agent.budget.limit : 0;

  return (
    <div>
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: 'Overview', to: '/' },
            { label: 'Org chart', to: '/agents' },
            { label: teamName(agent.team), to: `/agents?view=list&team=${encodeURIComponent(agent.team)}` },
            { label: agent.id },
          ]}
        />
      </div>
      <div className="mb-6">
        <AgentHero agent={agent} decided={decided} />
      </div>

      <AnimatePresence>
        {agent.state !== 'active' && <ReleaseBanner agentId={agent.id} state={agent.state} reason={agent.state_reason} at={agent.state_changed_at} />}
      </AnimatePresence>

      <Stagger className="grid gap-5 sm:grid-cols-3" step={0.07} delay={0.1}>
        <Rise>
          <Tile
            label="Actions, last 15 min"
            icon="activity"
            tone="accent"
            value={recent.length}
            sub={`${formatCount(decided.length)} in the live feed`}
            chart={<Sparkline values={series.map((b) => b.total)} tone="accent" delay={0.3} readout={(i) => `${formatClock(series[i]!.start)}: ${series[i]!.total} actions`} />}
          >
            <p className="text-[48px] leading-none font-bold tracking-[-0.04em]">
              <AnimatedNumber value={recent.length} />
            </p>
          </Tile>
        </Rise>
        <Rise>
          <Tile
            label="Denied, last 15 min"
            icon="ban"
            tone="bad"
            value={denied}
            sub="Stopped before execution"
            chart={<Sparkline values={series.map((b) => b.deny)} tone="bad" delay={0.4} readout={(i) => `${formatClock(series[i]!.start)}: ${series[i]!.deny} denied`} />}
          >
            <p className="text-[48px] leading-none font-bold tracking-[-0.04em]">
              <AnimatedNumber value={denied} />
            </p>
          </Tile>
        </Rise>
        <Rise>
          <Tile
            label="Budget used"
            icon="gauge"
            tone={budgetRatio >= 1 ? 'bad' : budgetRatio >= 0.8 ? 'wait' : 'accent'}
            sub={
              <span className="tabular-nums">
                {formatCents(agent.budget.used)} of {formatCents(agent.budget.limit)} {BUDGET_CURRENCY}
              </span>
            }
          >
            <BudgetGauge ratio={budgetRatio} />
          </Tile>
        </Rise>
      </Stagger>

      <div className="mt-14 grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-10">
        <Section title="Current session">
          {session ? (
            <Card className="p-6">
              <div className="mb-6 flex items-center gap-3">
                <Avatar name={session.human.display_name} size={40} />
                <div>
                  <p className="text-[15px] font-semibold text-ink">{session.human.display_name}</p>
                  <p className="text-[13px] text-ink-3">launched this agent for {session.use_case.name}</p>
                </div>
              </div>
              <KeyValues
                rows={[
                  ['Use case', session.use_case.name],
                  ['Tier ceiling', <TierText key="tier" tier={session.tier_ceiling} />],
                  ['Budget', <span key="b" className="tabular-nums">{`${formatCents(session.budget.used)} of ${formatCents(session.budget.limit)} ${BUDGET_CURRENCY}`}</span>],
                  ['Started', formatDateTime(session.started_at)],
                  ['Expires', formatDateTime(session.expires_at)],
                  ['Credential', 'Its own Keycloak client, client credentials'],
                ]}
              />
            </Card>
          ) : (
            <Card>
              <EmptyState icon="user" title="No active session" body="No human has launched this agent right now." />
            </Card>
          )}
        </Section>
        <Section title="What it may do">
          {session ? (
            <Capabilities session={session} useCase={useCase} />
          ) : (
            <Card className="p-6 text-[14px] text-ink-3">Capabilities come from a session; without one the agent can do nothing.</Card>
          )}
        </Section>
      </div>

      <div className="mt-14 space-y-14">
        <Section title="Recent actions" hint={`${formatCount(mine.length)} in the feed`} action={mine.length > 8 ? <TextLink to={`/activity?agent=${encodeURIComponent(agent.id)}`}>All of them</TextLink> : undefined}>
          <Card className="p-2">
            <ActivityList actions={mine} limit={8} hideAgent empty={<EmptyState icon="activity" title="No actions yet" />} />
          </Card>
        </Section>
        {traffic.length > 0 && (
          <Section title="Messages with other agents" hint="Every message is mediated by the Gateway">
            <Card className="p-2">
              <ul className="divide-y divide-line/70">
                {traffic.map((m) => (
                  <li key={m.id}>
                    <Link to={`/traces/${encodeURIComponent(m.trace_id)}`} className="group row-hover flex items-center gap-3 rounded-xl px-4 py-3.5">
                      <span className="font-mono text-[12px] text-ink-3 tabular-nums">{formatTime(m.occurred_at)}</span>
                      <span className="text-[14px] font-medium text-ink">{m.sender.id}</span>
                      <Icon name="arrow-right" size={13} className="text-ink-4" />
                      <span className="text-[14px] font-medium text-ink">{m.receiver.id}</span>
                      <Code className="hidden md:inline-flex">{m.capability}</Code>
                      <span className="ml-auto">
                        <StatusBadge size="sm" outcome={outcomeOf({ decision: m.decision, approval_state: 'none', capability: m.capability, agent: m.sender })} />
                      </span>
                      <Icon name="chevron-right" size={16} className="text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        )}
      </div>
    </div>
  );
}
