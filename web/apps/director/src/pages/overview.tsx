import { useAgents, useApprovals, useMe, useSummary, type ActionSummary, type Agent } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ActivityList } from '../components/activity.tsx';
import { Donut, formatClock, LatencyChart, OUTCOME_SERIES, RankBars, Sparkline, StackedBars } from '../components/charts.tsx';
import { Icon, type IconName } from '../components/icon.tsx';
import { LiveLanes } from '../components/live-lanes.tsx';
import { Burst, Rise, Stagger, TONE_COLOR, trackPointer, useRises, WordReveal } from '../components/motion.tsx';
import { ReasonText } from '../components/reason.tsx';
import {
  ActionVerdict,
  AgentGlyph,
  AnimatedNumber,
  Card,
  EASE,
  ECOSYSTEM_URL,
  EmptyState,
  ErrorCard,
  OutcomeBar,
  outcomeOf,
  Section,
  Segmented,
  Skeleton,
  STATE_TONE,
  TextLink,
  toneClass,
  type Tone,
} from '../components/ui.tsx';
import { isObservation } from '../domain/decision.ts';
import { determinismStats } from '../domain/determinism.ts';
import { groupByTeam, teamName } from '../domain/feed.ts';
import { formatAge, formatCents, formatCount, formatTime } from '../domain/format.ts';
import { formatDuration } from '../domain/pipeline.ts';
import { bucketize, pendingSeries, percentile, rankBy } from '../domain/series.ts';
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
  const { loading } = useKpis();
  const attention = useAttention();
  const reduce = useReducedMotion();
  const organization = (me.data?.organization as { name?: string } | undefined)?.name ?? 'Your organization';
  const n = attention.length;
  const sentence = n === 0 ? 'All agents are working within policy.' : `${n} ${n === 1 ? 'thing needs' : 'things need'} your attention.`;
  return (
    <header className="relative isolate mb-16">
      <Aura mood={n === 0 ? 'calm' : 'attention'} />
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-[14px] font-semibold text-ink-2 shadow-card backdrop-blur"
      >
        <Icon name="building" size={15} className="text-ink-3" />
        {organization}
      </motion.p>
      {loading ? (
        <Skeleton className="mt-4 h-10 w-[28rem] max-w-full rounded-xl" />
      ) : (
        <h1 className="mt-5 min-h-[1.1em] text-[36px] leading-[1.08] font-bold tracking-[-0.035em] text-ink sm:text-[54px]">
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
    </header>
  );
}

const MINUTE = 60_000;
const BUCKETS = 15;

/** The same window one step back, for "compared with the 15 minutes before". */
function useWindows() {
  const { actions } = useActions();
  const approvals = useApprovals();
  const tick = useNow(15_000);
  return useMemo(() => {
    // The clock ticks every 15 s; an action that arrived since then must still land in the window.
    const now = Math.max(tick, Date.now());
    const current = bucketize(actions, now, WINDOW_MS, BUCKETS);
    // The 15 minutes just before the first bar, on the same minute edges.
    const before = bucketize(actions, current[0]!.start - 1, WINDOW_MS, BUCKETS);
    const previous = { total: before.reduce((sum, b) => sum + b.total, 0), deny: before.reduce((sum, b) => sum + b.deny, 0) };
    const pending = pendingSeries(approvals.data ?? [], now, WINDOW_MS, BUCKETS);
    const oldest = (approvals.data ?? []).filter((a) => a.state === 'pending').map((a) => Date.parse(a.created_at)).sort()[0];
    return { current, previous, pending, oldest, now };
  }, [actions, approvals.data, tick]);
}

const minuteLabel = (start: number) => formatClock(start);

function Delta({ now, before, tone, unit }: { now: number; before: number; tone: Tone; unit: string }) {
  if (!before && !now) return <span className="text-[13px] font-medium text-ink-3">Quiet so far</span>;
  if (!before) return <span className="text-[13px] font-medium text-ink-3">First {unit} of the run</span>;
  const diff = now - before;
  // A percentage of a handful is noise; below ten the plain difference says more.
  const change = before >= 10 ? `${Math.abs(Math.round((diff / before) * 100))}%` : String(Math.abs(diff));
  const up = diff > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] font-bold tabular-nums ${diff === 0 ? 'bg-sunken text-ink-3' : ''}`}
      style={diff ? { background: `color-mix(in srgb, ${TONE_COLOR[tone]} 12%, transparent)`, color: TONE_COLOR[tone] } : undefined}
      title={`${before} in the 15 minutes before`}
    >
      {diff !== 0 && <Icon name={up ? 'arrow-up' : 'arrow-down'} size={13} />}
      {diff === 0 ? 'No change' : change}
      <span className="font-medium text-ink-3">vs prev.</span>
    </span>
  );
}

function StatShell({
  to,
  href,
  icon,
  tone,
  label,
  value,
  ring,
  side,
  foot,
  chart,
}: {
  to?: string;
  href?: string;
  icon: IconName;
  tone: Tone;
  label: string;
  value: number;
  ring?: boolean;
  side?: ReactNode;
  foot: ReactNode;
  chart: ReactNode;
}) {
  const rises = useRises(value);
  const body = (
    <>
      {ring && <Burst trigger={rises || undefined} color={TONE_COLOR[tone]} radius="24px" strength={1.05} />}
      <span className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-[12px] transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-4deg]"
          style={{ background: `color-mix(in srgb, ${TONE_COLOR[tone]} 13%, transparent)`, color: TONE_COLOR[tone] }}
        >
          <Icon name={icon} size={19} />
        </span>
        <span className="text-[14.5px] font-semibold text-ink-2">{label}</span>
        <Icon name={href ? 'external' : 'arrow-right'} size={16} className="ml-auto text-ink-4 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </span>
      <span className="mt-5 flex items-end justify-between gap-3">
        <span className="text-[46px] leading-none font-bold tracking-[-0.04em] text-ink sm:text-[54px]">
          <AnimatedNumber value={value} />
        </span>
        {side}
      </span>
      <span className="mt-3 flex min-h-6 items-center">{foot}</span>
      <span className="-mx-6 -mb-6 mt-4 block sm:-mx-7 sm:-mb-7">{chart}</span>
    </>
  );
  const cls = 'group lift spotlight flex h-full flex-col overflow-visible rounded-[24px] border border-line bg-surface p-6 shadow-card sm:p-7';
  return href ? (
    <a href={href} onPointerMove={trackPointer} className={cls} style={{ ['--spot' as string]: TONE_COLOR[tone] }}>
      {body}
    </a>
  ) : (
    <Link to={to ?? '/'} onPointerMove={trackPointer} className={cls} style={{ ['--spot' as string]: TONE_COLOR[tone] }}>
      {body}
    </Link>
  );
}

/** Each agent as a bar: how busy it was in the last 15 minutes, coloured by its lifecycle state. */
function AgentBars({ agents, actions, now }: { agents: readonly Agent[]; actions: readonly ActionSummary[]; now: number }) {
  const reduce = useReducedMotion();
  const counts = agents.map((a) => actions.filter((x) => x.agent.id === a.id && !isObservation(x) && now - Date.parse(x.occurred_at) <= WINDOW_MS).length);
  const max = Math.max(1, ...counts);
  return (
    <span className="flex h-16 items-end gap-2 px-6 pb-5 sm:px-7">
      {agents.map((agent, i) => (
        <span key={agent.id} title={`${agent.id}: ${counts[i]} actions, ${agent.state}`} className="flex h-full flex-1 flex-col justify-end">
          <motion.span
            className="block w-full rounded-t-[6px] rounded-b-[2px]"
            style={{ background: TONE_COLOR[STATE_TONE[agent.state]], opacity: agent.state === 'active' ? 0.75 : 1 }}
            initial={reduce ? false : { height: 0 }}
            animate={{ height: `${Math.max(8, (counts[i]! / max) * 100)}%` }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.3 + i * 0.05 }}
          />
        </span>
      ))}
    </span>
  );
}

function Stats() {
  const { kpis, loading } = useKpis();
  const { actions } = useActions();
  const agents = useAgents();
  const w = useWindows();
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[260px]" />
        ))}
      </div>
    );
  }
  const offline = kpis.agentsQuarantined + kpis.agentsSuspended;
  const registered = agents.data?.length ?? 0;
  const deniedNow = w.current.reduce((sum, b) => sum + b.deny, 0);
  const totalNow = w.current.reduce((sum, b) => sum + b.total, 0);
  return (
    <Stagger className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4" step={0.06} delay={0.15}>
      <Rise>
        <StatShell
          to="/agents"
          icon="bot"
          tone={offline ? 'quar' : 'accent'}
          label="Agents active"
          value={kpis.agentsActive}
          ring
          side={<span className="pb-1 text-[15px] font-semibold text-ink-3 tabular-nums">of {registered}</span>}
          foot={
            offline ? (
              <span className="text-[13px] font-semibold text-quar-ink">
                {[kpis.agentsQuarantined && `${kpis.agentsQuarantined} quarantined`, kpis.agentsSuspended && `${kpis.agentsSuspended} suspended`].filter(Boolean).join(', ')}
              </span>
            ) : (
              <span className="text-[13px] font-medium text-ink-3">None quarantined; bars show who is busiest</span>
            )
          }
          chart={<AgentBars agents={groupByTeam(agents.data ?? []).flatMap(([, l]) => l)} actions={actions} now={w.now} />}
        />
      </Rise>
      <Rise>
        <StatShell
          to="/activity"
          icon="activity"
          tone="accent"
          label="Actions, last 15 min"
          value={kpis.actions15m}
          foot={<Delta now={totalNow} before={w.previous.total} tone="accent" unit="15 minutes" />}
          chart={<Sparkline values={w.current.map((b) => b.total)} tone="accent" delay={0.35} readout={(i) => `${minuteLabel(w.current[i]!.start)}: ${w.current[i]!.total} actions`} />}
        />
      </Rise>
      <Rise>
        <StatShell
          to="/activity?show=denied"
          icon="ban"
          tone="bad"
          label="Denied, last 15 min"
          value={kpis.denied15m}
          ring
          foot={<Delta now={deniedNow} before={w.previous.deny} tone="bad" unit="15 minutes" />}
          chart={<Sparkline values={w.current.map((b) => b.deny)} tone="bad" delay={0.45} readout={(i) => `${minuteLabel(w.current[i]!.start)}: ${w.current[i]!.deny} denied`} />}
        />
      </Rise>
      <Rise>
        <StatShell
          href={`${ECOSYSTEM_URL}/approvals`}
          icon="hourglass"
          tone="wait"
          label="Awaiting a human"
          value={kpis.awaitingHuman}
          ring
          foot={
            <span className="text-[13px] font-medium text-ink-3">
              {kpis.awaitingHuman && w.oldest ? `Oldest waiting ${formatAge(new Date(w.oldest).toISOString(), w.now).replace(' ago', '')}` : 'Nothing waiting for a person'}
            </span>
          }
          chart={<Sparkline values={w.pending} tone="wait" delay={0.55} readout={(i) => `${minuteLabel(w.current[i]!.start)}: ${w.pending[i]} waiting`} />}
        />
      </Rise>
    </Stagger>
  );
}

/** The guardrails at work in the last 15 minutes, as the Gateway counts them. */
function GuardrailStrip() {
  const summary = useSummary();
  const g = summary.data?.guardrails;
  if (!g) return null;
  const ms = (value: number | null) => (value === null ? '–' : formatDuration(value));
  const items: { icon: IconName; label: string; value: ReactNode; tone?: Tone; title?: string }[] = [
    { icon: 'gauge', label: 'Spent', value: `${formatCents(g.spent_cents_last_15m)} EUR`, title: `${g.spent_cents_last_15m} cents` },
    { icon: 'brain', label: 'Model tokens', value: <AnimatedNumber value={g.tokens_last_15m} /> },
    { icon: 'filter', label: 'Redactions', value: <AnimatedNumber value={g.redactions_last_15m} /> },
    { icon: 'radar', label: 'Signature hits', value: <AnimatedNumber value={g.signature_hits_last_15m} />, tone: g.signature_hits_last_15m ? 'bad' : undefined },
    { icon: 'sparkles', label: 'Semantic flags', value: <AnimatedNumber value={g.semantic_flags_last_15m} />, tone: g.semantic_flags_last_15m ? 'wait' : undefined },
    { icon: 'clock', label: 'Gateway p50 / p95', value: `${ms(g.latency_ms.p50)} / ${ms(g.latency_ms.p95)}`, title: `Over ${formatCount(g.latency_ms.samples)} decisions` },
  ];
  return (
    <Card className="mt-5 p-6">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-2">
          <Icon name="shield-check" size={16} className="text-ink-3" />
          Guardrails, last 15 min
        </h2>
        <span className="ml-auto">
          <TextLink to="/guardrails">Guardrails</TextLink>
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <div key={item.label} title={item.title} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
              <Icon name={item.icon} size={13} />
              {item.label}
            </dt>
            <dd className={`mt-1 truncate text-[20px] font-bold tracking-[-0.02em] tabular-nums ${item.tone ? toneClass(item.tone).ink : 'text-ink'}`}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Decisions over time by outcome, beside the overall outcome mix. */
function Analytics() {
  const { actions } = useActions();
  const tick = useNow(15_000);
  const [range, setRange] = useState<'15' | '60'>('15');
  const windowMs = Number(range) * MINUTE;
  const count = range === '15' ? 30 : 40;
  const buckets = useMemo(() => bucketize(actions, Math.max(tick, Date.now()), windowMs, count), [actions, tick, windowMs, count]);
  const sums = OUTCOME_SERIES.map((s) => ({ ...s, value: buckets.reduce((sum, b) => sum + b[s.key], 0) }));
  const total = sums.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
      <Card className="p-7 sm:p-8">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <h2 className="min-w-0 flex-1 text-[21px] font-bold tracking-[-0.02em] text-ink">Decisions over time</h2>
          <Segmented
            label="Range"
            value={range}
            onChange={setRange}
            options={[
              { value: '15', label: '15 min' },
              { value: '60', label: '1 hour' },
            ]}
          />
        </div>
        <StackedBars key={range} buckets={buckets} bucketMs={windowMs / count} />
      </Card>
      <Card className="flex flex-col p-7 sm:p-8">
        <h2 className="flex items-baseline gap-3 text-[21px] font-bold tracking-[-0.02em] text-ink">
          Outcome mix
          <span className="text-[14px] font-medium tracking-normal text-ink-3">{range === '15' ? 'last 15 min' : 'last hour'}</span>
        </h2>
        <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-7 sm:flex-row xl:flex-col 2xl:flex-row">
          <Donut key={range} parts={sums.map((s) => ({ key: s.key, label: s.label, value: s.value, tone: s.tone }))} centre={{ value: total, label: 'decisions' }} />
          <ul className="w-full max-w-[240px] space-y-3">
            {sums.map((s) => (
              <li key={s.key} className="flex items-center gap-3 text-[14px]">
                <span className="h-3 w-3 rounded-[4px]" style={{ background: TONE_COLOR[s.tone] }} />
                <span className="font-medium text-ink-2">{s.label}</span>
                <span className="ml-auto font-bold text-ink tabular-nums">
                  <AnimatedNumber value={s.value} />
                </span>
                <span className="w-11 text-right text-[12.5px] font-semibold text-ink-3 tabular-nums">{total ? Math.round((s.value / total) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

/** Which capabilities agents ask for most, and how long the Gateway takes to decide. */
function Insights() {
  const { actions } = useActions();
  const tick = useNow(15_000);
  const recent = useMemo(() => actions.filter((a) => Math.max(tick, Date.now()) - Date.parse(a.occurred_at) <= 60 * MINUTE), [actions, tick]);
  const top = useMemo(() => rankBy(recent, (a) => a.capability, 6), [recent]);
  const agentsTop = useMemo(() => rankBy(recent, (a) => a.agent.id, 6), [recent]);
  const latency = useMemo(() => bucketize(actions, Math.max(tick, Date.now()), 30 * MINUTE, 30), [actions, tick]);
  const all = latency.flatMap((b) => b.latencies);
  return (
    <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
      <Card className="p-7 sm:p-8">
        <h2 className="mb-6 flex items-baseline gap-3 text-[21px] font-bold tracking-[-0.02em] text-ink">
          Most requested capabilities
          <span className="text-[14px] font-medium tracking-normal text-ink-3">last hour</span>
        </h2>
        {top.length ? <RankBars items={top} label={(key) => <span className="font-mono text-[13.5px] font-medium text-ink">{key}</span>} /> : <p className="text-[14px] text-ink-3">No request yet.</p>}
      </Card>
      <Card className="p-7 sm:p-8">
        <h2 className="mb-6 flex items-baseline gap-3 text-[21px] font-bold tracking-[-0.02em] text-ink">
          Busiest agents
          <span className="text-[14px] font-medium tracking-normal text-ink-3">last hour</span>
        </h2>
        {agentsTop.length ? (
          <RankBars
            items={agentsTop}
            label={(key) => (
              <Link to={`/agents/${encodeURIComponent(key)}`} className="inline-flex items-center gap-2.5 text-[14px] font-semibold text-ink hover:text-accent-ink">
                <AgentGlyph size={26} agentId={key} />
                {key}
              </Link>
            )}
          />
        ) : (
          <p className="text-[14px] text-ink-3">No request yet.</p>
        )}
      </Card>
      <Card className="p-7 sm:p-8 lg:col-span-2 2xl:col-span-1">
        <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-[21px] font-bold tracking-[-0.02em] text-ink">Gateway decision time</h2>
          <span className="text-[14px] text-ink-3">
            median <span className="font-bold text-ink tabular-nums">{percentile(all, 50)} ms</span>, 95th{' '}
            <span className="font-bold text-ink tabular-nums">{percentile(all, 95)} ms</span>, last 30 min
          </span>
        </div>
        <LatencyChart buckets={latency} />
        <p className="mt-4 flex items-center gap-4 text-[12.5px] font-medium text-ink-3">
          <span className="flex items-center gap-2">
            <span className="h-[3px] w-5 rounded-full bg-accent" /> Median
          </span>
          <span className="flex items-center gap-2">
            <span className="h-0 w-5 border-t-2 border-dashed border-accent/50" /> 95th percentile
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-[3px] bg-accent/[0.18]" /> Decisions per minute
          </span>
        </p>
      </Card>
    </div>
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
    side = <ActionVerdict action={action} size="sm" />;
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
    <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" step={0.06}>
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
      to={`/agents?view=list&team=${encodeURIComponent(team)}`}
      onPointerMove={trackPointer}
      className="group lift spotlight flex h-full flex-col rounded-[22px] border border-line bg-surface p-7 shadow-card"
    >
      <Burst trigger={pulse.seq} color={TONE_COLOR[tone]} radius="16px" strength={1.035} />
      <span className="flex items-center gap-2">
        <span className="text-[18px] font-bold tracking-[-0.015em] text-ink">{teamName(team)}</span>
        <Icon name="arrow-right" size={14} className="ml-auto text-ink-4 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </span>
      <span className="mt-1 text-[13px] text-ink-3">
        {list.length} {list.length === 1 ? 'agent' : 'agents'}
        {offline.length > 0 && <span className="text-quar-ink">, {offline.length} offline</span>}
      </span>
      <span className="mt-5 flex -space-x-1.5 transition-all duration-300 group-hover:space-x-1">
        {list.slice(0, 6).map((agent) => (
          <span key={agent.id} title={`${agent.id}: ${agent.state}`} className="rounded-xl ring-2 ring-surface transition-all duration-300">
            <AgentGlyph state={agent.state} size={38} agentId={agent.id} />
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

/** The determinism story in one card: what decided, what AI changed, and that nothing was loosened. */
function DeterminismCard() {
  const { actions } = useActions();
  const stats = useMemo(() => determinismStats(actions), [actions]);
  const figures: { label: string; value: number; tone: Tone; note: string }[] = [
    { label: 'Decided by policy', value: stats.total, tone: 'accent', note: 'deterministic controls first, every time' },
    { label: 'Tightened by AI', value: stats.tightened, tone: 'ai', note: 'AI analysis may only make it stricter' },
    { label: 'Loosened by AI', value: stats.loosened, tone: 'ok', note: 'the invariant, checked on this feed' },
  ];
  return (
    <Link to="/determinism" onPointerMove={trackPointer} className="group lift spotlight block overflow-hidden rounded-[26px] border border-accent/15 bg-gradient-to-br from-accent-soft via-surface to-surface p-8 text-ink shadow-card sm:p-10">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-8">
        <div className="max-w-md min-w-0 flex-1">
          <p className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[12.5px] font-semibold text-accent-ink ring-1 ring-accent/15">
            <Icon name="cpu" size={14} />
            Determinism
          </p>
          <h2 className="mt-4 text-[26px] leading-tight font-bold tracking-[-0.025em] sm:text-[30px]">Non-deterministic agents, deterministic decisions.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">A model can phrase a request any way it likes. Whether it may act is decided by policy, the same way every time.</p>
          <span className="mt-6 inline-flex items-center gap-2 text-[14.5px] font-semibold text-accent-ink">
            See the boundary live
            <Icon name="arrow-right" size={15} className="transition-transform group-hover:translate-x-1" />
          </span>
        </div>
        <div className="grid flex-[1.2] grid-cols-3 gap-4">
          {figures.map((f) => (
            <div key={f.label} className="rounded-2xl border border-line bg-surface/80 p-5 shadow-card">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                <span className="h-2 w-2 rounded-full" style={{ background: TONE_COLOR[f.tone] }} />
                {f.label}
              </p>
              <p className="mt-4 text-[40px] leading-none font-bold tracking-[-0.03em]">
                <AnimatedNumber value={f.value} />
              </p>
              <p className="mt-2 text-[12.5px] leading-snug text-ink-3">{f.note}</p>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

function Explore() {
  const items: { to: string; icon: IconName; title: string; body: string }[] = [
    { to: '/agents', icon: 'network', title: 'Org chart', body: 'Every person, the agents beside them, live.' },
    { to: '/graph', icon: 'map', title: 'Graph', body: 'Who launched which agent, and what it touched.' },
    { to: '/determinism', icon: 'cpu', title: 'Determinism', body: 'Why a model never decides on its own.' },
    { to: '/coverage', icon: 'shield', title: 'Coverage', body: 'The OWASP agentic risks and the evidence.' },
  ];
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Link key={item.to} to={item.to} onPointerMove={trackPointer} className="group lift spotlight flex items-center gap-4 rounded-[22px] border border-line bg-surface p-6 shadow-card">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sunken text-ink-2 transition-all duration-300 group-hover:rotate-[-6deg] group-hover:bg-accent group-hover:text-white group-hover:shadow-lift">
            <Icon name={item.icon} size={21} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16.5px] font-bold text-ink">{item.title}</span>
            <span className="mt-0.5 block text-[13.5px] leading-snug text-ink-3">{item.body}</span>
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
      <GuardrailStrip />
      <Stagger className="mt-16 space-y-20" step={0.08} delay={0.35}>
        <Rise>
          <Attention />
        </Rise>
        <Rise>
          <Analytics />
        </Rise>
        <Rise>
          <LiveLanes />
        </Rise>
        <Rise>
          <Insights />
        </Rise>
        <Rise>
          <DeterminismCard />
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
