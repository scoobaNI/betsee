import { useAgents, useMe, type ActionSummary, type Agent } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ActivityList } from '../components/activity.tsx';
import { Icon, type IconName } from '../components/icon.tsx';
import { LiveLanes } from '../components/live-lanes.tsx';
import { Burst, Rise, Stagger, TONE_COLOR, trackPointer, useRises, WordReveal } from '../components/motion.tsx';
import { ReasonText } from '../components/reason.tsx';
import {
  AgentGlyph,
  AnimatedNumber,
  Card,
  EASE,
  ECOSYSTEM_URL,
  EmptyState,
  ErrorCard,
  OutcomeBar,
  OutcomePill,
  outcomeOf,
  Section,
  Skeleton,
  TextLink,
  type Tone,
} from '../components/ui.tsx';
import { isObservation } from '../domain/decision.ts';
import { groupByTeam, teamName } from '../domain/feed.ts';
import { formatCount, formatTime } from '../domain/format.ts';
import { useActions, useAttention, useKpis, useNow, type AttentionItem } from '../hooks.ts';
import { useTeamPulse } from '../live.ts';

const WINDOW_MS = 15 * 60_000;

const AURA = {
  calm: ['var(--color-ok)', 'var(--color-accent)', '#38bdf8'],
  attention: ['var(--color-wait)', 'var(--color-quar)', 'var(--color-ai)'],
};

/** Slow coloured light behind the headline: cool when all is well, warm when something needs a person. */
function Aura({ mood }: { mood: keyof typeof AURA }) {
  const [a, b, c] = AURA[mood];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-10 -top-28 -z-10 h-[460px] [mask-image:radial-gradient(ellipse_at_45%_35%,black_30%,transparent_70%)] sm:-inset-x-40">
      <AnimatePresence initial={false}>
        <motion.div key={mood} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.4 }}>
          <span className="aura-blob" style={{ left: '0%', top: '10%', width: 460, height: 300, background: a, opacity: 0.16 }} />
          <span className="aura-blob" style={{ left: '34%', top: '-6%', width: 520, height: 280, background: b, opacity: 0.12 }} />
          <span className="aura-blob" style={{ right: '0%', top: '18%', width: 380, height: 260, background: c, opacity: 0.12 }} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Hero() {
  const me = useMe();
  const agents = useAgents();
  const { kpis, loading } = useKpis();
  const attention = useAttention();
  const reduce = useReducedMotion();
  const organization = (me.data?.organization as { name?: string } | undefined)?.name ?? 'Your organization';
  const teams = useMemo(() => new Set((agents.data ?? []).map((a) => a.team)).size, [agents.data]);
  const n = attention.length;
  const sentence = n === 0 ? 'All agents are working within policy.' : `${n} ${n === 1 ? 'thing needs' : 'things need'} your attention.`;
  return (
    <header className="relative isolate mb-12">
      <Aura mood={n === 0 ? 'calm' : 'attention'} />
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[13px] font-medium text-ink-2 shadow-card backdrop-blur"
      >
        <Icon name="building" size={13} className="text-ink-3" />
        {organization}
      </motion.p>
      {loading ? (
        <Skeleton className="mt-4 h-10 w-[28rem] max-w-full rounded-xl" />
      ) : (
        <h1 className="mt-4 min-h-[1.15em] text-[30px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink sm:text-[40px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={sentence}
              className="block"
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, filter: 'blur(6px)', transition: { duration: 0.2 } }}
            >
              <WordReveal text={sentence} delay={0.05} emphasis={n ? { index: 0, className: 'text-wait-ink' } : undefined} />
            </motion.span>
          </AnimatePresence>
        </h1>
      )}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.35 }}
        className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-2"
      >
        {formatCount(kpis.agentsActive)} agents active across {teams} {teams === 1 ? 'team' : 'teams'}. Every action they take passes through the
        Gateway, which decides it, records it and explains it.
      </motion.p>
    </header>
  );
}

/** Actions per minute over the last 15 minutes; denied ones stacked in red at the base. */
function MiniHistogram({ actions }: { actions: readonly ActionSummary[] }) {
  const now = useNow(15_000);
  const buckets = useMemo(() => {
    const out = Array.from({ length: 15 }, () => ({ total: 0, denied: 0 }));
    for (const a of actions) {
      const age = now - Date.parse(a.occurred_at);
      if (age < 0 || age >= WINDOW_MS) continue;
      const b = out[14 - Math.floor(age / 60_000)]!;
      b.total++;
      if (a.decision === 'deny') b.denied++;
    }
    return out;
  }, [actions, now]);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  return (
    <span aria-hidden="true" className="hidden h-8 items-end gap-[3px] sm:flex">
      {buckets.map((b, i) => (
        <motion.span
          key={i}
          className="flex w-[5px] flex-col-reverse overflow-hidden rounded-[2px]"
          initial={false}
          animate={{ height: b.total ? `${Math.max(12, (b.total / max) * 100)}%` : '2px' }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <span className="w-full shrink-0 bg-bad" style={{ height: b.total ? `${(b.denied / b.total) * 100}%` : 0 }} />
          <span className={`w-full flex-1 ${b.total ? 'bg-ink-4' : 'bg-line'}`} />
        </motion.span>
      ))}
    </span>
  );
}

function Stat({ to, href, label, value, sub, tone, extra, ring }: { to?: string; href?: string; label: string; value: number; sub: ReactNode; tone?: Tone; extra?: ReactNode; ring?: boolean }) {
  const rises = useRises(value);
  const body = (
    <>
      {ring && tone && <Burst trigger={rises || undefined} color={TONE_COLOR[tone]} radius="16px" strength={1.06} />}
      <span className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
        {tone && <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${tone === 'bad' ? 'bg-bad' : tone === 'wait' ? 'bg-wait' : tone === 'quar' ? 'bg-quar' : 'bg-ok'}`} />}
        {label}
        <Icon name={href ? 'external' : 'arrow-right'} size={13} className="ml-auto text-ink-4 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </span>
      <span className="mt-4 flex items-end justify-between gap-3">
        <span className="text-[34px] leading-none font-semibold tracking-[-0.03em] text-ink sm:text-[40px]">
          <AnimatedNumber value={value} />
        </span>
        {extra}
      </span>
      <span className="mt-3 block text-[13px] text-ink-3">{sub}</span>
    </>
  );
  const cls = 'group lift spotlight block h-full rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6';
  return href ? (
    <a href={href} onPointerMove={trackPointer} className={cls}>
      {body}
    </a>
  ) : (
    <Link to={to ?? '/'} onPointerMove={trackPointer} className={cls}>
      {body}
    </Link>
  );
}

function Stats() {
  const { kpis, loading } = useKpis();
  const { actions } = useActions();
  const decided = useMemo(() => actions.filter((a) => !isObservation(a)), [actions]);
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[148px]" />
        ))}
      </div>
    );
  }
  const offline = kpis.agentsQuarantined + kpis.agentsSuspended;
  return (
    <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4" step={0.06} delay={0.15}>
      <Rise>
        <Stat
          to="/agents"
          label="Agents active"
          value={kpis.agentsActive}
          tone={offline ? 'quar' : 'ok'}
          ring
          sub={
            offline
              ? [kpis.agentsQuarantined && `${kpis.agentsQuarantined} quarantined`, kpis.agentsSuspended && `${kpis.agentsSuspended} suspended`].filter(Boolean).join(', ')
              : 'None quarantined'
          }
        />
      </Rise>
      <Rise>
        <Stat
          to="/activity"
          label="Actions, last 15 min"
          value={kpis.actions15m}
          sub={kpis.tightened15m ? `${formatCount(kpis.tightened15m)} made stricter by AI analysis` : 'Each one a recorded trace'}
          extra={<MiniHistogram actions={decided} />}
        />
      </Rise>
      <Rise>
        <Stat to="/activity?show=denied" label="Denied, last 15 min" value={kpis.denied15m} tone={kpis.denied15m ? 'bad' : undefined} ring sub="Stopped before execution" />
      </Rise>
      <Rise>
        <Stat
          href={`${ECOSYSTEM_URL}/approvals`}
          label="Awaiting a human"
          value={kpis.awaitingHuman}
          tone={kpis.awaitingHuman ? 'wait' : undefined}
          ring
          sub={kpis.awaitingHuman ? 'Approval or step-up pending' : 'Nothing waiting'}
        />
      </Rise>
    </Stagger>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  let to: string;
  let icon: ReactNode;
  let title: ReactNode;
  let detail: ReactNode;
  let side: ReactNode = null;
  if (item.kind === 'agent') {
    const { agent } = item;
    to = `/agents/${encodeURIComponent(agent.id)}`;
    icon = <AgentGlyph state={agent.state} size={40} agentId={agent.id} />;
    title = (
      <>
        <span className="font-semibold">{agent.id}</span> was {agent.state === 'quarantined' ? 'quarantined' : 'suspended'}
      </>
    );
    detail = agent.state_reason ? <ReasonText text={agent.state_reason} linked={false} /> : 'Every action it attempts is denied until a security officer releases it.';
    side = agent.state_changed_at ? <span className="font-mono text-[12px] text-ink-3">{formatTime(agent.state_changed_at)}</span> : null;
  } else if (item.kind === 'awaiting') {
    const { action } = item;
    to = `/traces/${encodeURIComponent(action.trace_id)}`;
    icon = (
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${action.decision === 'require_step_up' ? 'bg-verify-soft text-verify-ink' : 'bg-wait-soft text-wait-ink'}`}>
        <Icon name={action.decision === 'require_step_up' ? 'lock' : 'hourglass'} size={18} />
      </span>
    );
    title = (
      <>
        <span className="font-semibold">{action.agent.id}</span> wants to run <span className="font-semibold">{action.capability}</span>
      </>
    );
    detail = `On ${action.resource.id}${action.human ? `, for ${action.human.display_name}` : ''}. Waiting since ${formatTime(action.occurred_at)}.`;
    side = <OutcomePill outcome={outcomeOf(action)} size="sm" />;
  } else {
    to = '/graph';
    icon = (
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-bad-soft text-bad-ink">
        <Icon name="shield-x" size={18} />
      </span>
    );
    title = (
      <>
        Tool <span className="font-semibold">{item.tool}</span> changed its description
      </>
    );
    detail = `The Gateway blocked it on ${item.connector} until an admin re-pins it.`;
  }
  return (
    <Link to={to} className="group row-hover flex items-center gap-4 rounded-xl px-4 py-4 transition-transform active:scale-[0.995]">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">{detail}</span>
      </span>
      {side && <span className="hidden shrink-0 sm:block">{side}</span>}
      <Icon name="chevron-right" size={18} className="text-ink-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

const ATTENTION_SHOWN = 4;

function Attention() {
  const items = useAttention();
  const { loading } = useKpis();
  const [all, setAll] = useState(false);
  if (loading) return null;
  if (!items.length) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, ease: EASE }}>
        <Card className="flex items-center gap-4 px-6 py-5">
          <motion.span
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.15 }}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-ok-soft text-ok-ink"
          >
            <Icon name="circle-check" size={18} />
          </motion.span>
          <span>
            <span className="block text-[15px] font-medium text-ink">Nothing needs you right now</span>
            <span className="block text-[13px] text-ink-3">No quarantined agent, no blocked tool, no action waiting for a person.</span>
          </span>
        </Card>
      </motion.div>
    );
  }
  const more = items.length - ATTENTION_SHOWN;
  return (
    <Section title="Needs attention" hint={`${items.length} open`}>
      <Card className="relative overflow-hidden p-2">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-wait via-quar to-bad opacity-70" />
        <ul className="divide-y divide-line/70">
          <AnimatePresence initial={false}>
            {(all ? items : items.slice(0, ATTENTION_SHOWN)).map((item) => (
              <motion.li
                key={item.key}
                className="overflow-hidden"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0, transition: { duration: 0.3, ease: EASE } }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                <AttentionRow item={item} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {more > 0 && (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="mt-1 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
          >
            {all ? 'Show fewer' : `Show ${more} more`}
            <Icon name={all ? 'chevron-up' : 'chevron-down'} size={14} />
          </button>
        )}
      </Card>
    </Section>
  );
}

function Teams() {
  const agents = useAgents();
  const { actions } = useActions();
  const now = useNow();
  const teams = useMemo(() => groupByTeam(agents.data ?? []), [agents.data]);
  const stats = useMemo(() => {
    const byTeam = new Map<string, { ok: number; bad: number; wait: number; total: number }>();
    for (const a of actions) {
      if (isObservation(a) || now - Date.parse(a.occurred_at) > WINDOW_MS) continue;
      const s = byTeam.get(a.agent.team) ?? { ok: 0, bad: 0, wait: 0, total: 0 };
      const tone = outcomeOf(a).tone;
      s.total++;
      if (tone === 'ok') s.ok++;
      else if (tone === 'bad') s.bad++;
      else s.wait++;
      byTeam.set(a.agent.team, s);
    }
    return byTeam;
  }, [actions, now]);

  if (agents.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }
  if (agents.isError) return <ErrorCard title="Could not load agents" error={agents.error} onRetry={() => void agents.refetch()} />;
  if (!teams.length) {
    return (
      <Card>
        <EmptyState icon="bot" title="No agents registered" body="Run scripts/bootstrap to register the demo agents." />
      </Card>
    );
  }
  return (
    <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" step={0.06}>
      {teams.map(([team, list]) => (
        <Rise key={team}>
          <TeamCard team={team} list={list} s={stats.get(team) ?? { ok: 0, bad: 0, wait: 0, total: 0 }} />
        </Rise>
      ))}
    </Stagger>
  );
}

function TeamCard({ team, list, s }: { team: string; list: Agent[]; s: { ok: number; bad: number; wait: number; total: number } }) {
  const { pulse } = useTeamPulse(team);
  const offline = list.filter((a) => a.state !== 'active');
  const tone = pulse.action ? outcomeOf(pulse.action).tone : 'accent';
  return (
    <Link
      to={`/agents?team=${encodeURIComponent(team)}`}
      onPointerMove={trackPointer}
      className="group lift spotlight flex h-full flex-col rounded-2xl border border-line bg-surface p-6 shadow-card"
    >
      <Burst trigger={pulse.seq} color={TONE_COLOR[tone]} radius="16px" strength={1.035} />
      <span className="flex items-center gap-2">
        <span className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{teamName(team)}</span>
        <Icon name="arrow-right" size={14} className="ml-auto text-ink-4 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </span>
      <span className="mt-1 text-[13px] text-ink-3">
        {list.length} {list.length === 1 ? 'agent' : 'agents'}
        {offline.length > 0 && <span className="text-quar-ink">, {offline.length} offline</span>}
      </span>
      <span className="mt-5 flex -space-x-1.5 transition-all duration-300 group-hover:space-x-1">
        {list.slice(0, 6).map((agent) => (
          <span key={agent.id} title={`${agent.id}: ${agent.state}`} className="rounded-xl ring-2 ring-surface transition-all duration-300">
            <AgentGlyph state={agent.state} size={30} agentId={agent.id} />
          </span>
        ))}
      </span>
      <span className="mt-auto pt-6">
        <OutcomeBar
          parts={[
            { tone: 'ok', value: s.ok, label: 'allowed' },
            { tone: 'wait', value: s.wait, label: 'waiting' },
            { tone: 'bad', value: s.bad, label: 'denied' },
          ]}
        />
        <span className="mt-2.5 block text-[12px] text-ink-3 tabular-nums">
          {s.total ? (
            <>
              <AnimatedNumber value={s.total} /> actions{s.bad > 0 && <span className="text-bad-ink">, {formatCount(s.bad)} denied</span>}
            </>
          ) : (
            'Quiet in the last 15 min'
          )}
        </span>
      </span>
    </Link>
  );
}

const LATEST = 6;

function Latest() {
  const { actions, query } = useActions();
  return (
    <Section title="Latest activity" hint="Live" action={<TextLink to="/activity">All activity</TextLink>}>
      <Card className="p-2">
        {query.isPending ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : query.isError && !query.data ? (
          <ErrorCard title="Could not load activity" error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <ActivityList actions={actions} limit={LATEST} empty={<EmptyState icon="activity" title="No agent has acted yet" body="Launch Act 1 from the demo controls, or start an agent." />} />
        )}
      </Card>
    </Section>
  );
}

function Explore() {
  const items: { to: string; icon: IconName; title: string; body: string }[] = [
    { to: '/agents', icon: 'network', title: 'Org chart', body: 'The organization, its teams and every agent, live.' },
    { to: '/graph', icon: 'map', title: 'Graph', body: 'Who launched which agent, and what each one touched.' },
    { to: '/coverage', icon: 'shield', title: 'Coverage', body: 'The OWASP agentic risks and the evidence from this run.' },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((item) => (
        <Link key={item.to} to={item.to} onPointerMove={trackPointer} className="group lift spotlight flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunken text-ink-2 transition-all duration-300 group-hover:rotate-[-6deg] group-hover:bg-accent-soft group-hover:text-accent-ink">
            <Icon name={item.icon} size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">{item.title}</span>
            <span className="block text-[13px] text-ink-3">{item.body}</span>
          </span>
          <Icon name="arrow-right" size={16} className="text-ink-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  );
}

export function OverviewPage() {
  return (
    <div>
      <Hero />
      <Stats />
      <Stagger className="mt-14 space-y-14" step={0.08} delay={0.35}>
        <Rise>
          <Attention />
        </Rise>
        <Rise>
          <LiveLanes />
        </Rise>
        <Rise>
          <Section title="Teams" hint="Last 15 minutes" action={<TextLink to="/agents">Org chart</TextLink>}>
            <Teams />
          </Section>
        </Rise>
        <Rise>
          <Latest />
        </Rise>
        <Rise>
          <Explore />
        </Rise>
      </Stagger>
    </div>
  );
}
