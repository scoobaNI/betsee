import { usePolicy, type Control, type Span, type StageId, type Trace } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { analyzerVerdictLabel, decisionLabel, resolutionOf } from '../domain/decision.ts';
import { formatDateTime } from '../domain/format.ts';
import {
  RAIL_STATUS_LABEL,
  STAGE_GROUP_LABEL,
  STAGES,
  decidingStage,
  formatDuration,
  parentStage,
  spanDuration,
  type Rail,
  type RailStage,
  type RailStatus,
  type StageGroup,
} from '../domain/pipeline.ts';
import { Icon, type IconName } from './icon.tsx';
import { Burst, TONE_COLOR } from './motion.tsx';
import { Code, controlHref, EASE, outcomeOf, policyHref, RawTable, StatusBadge, type Tone } from './ui.tsx';

const STAGE_ICON: Record<StageId, IconName> = {
  authenticate: 'key',
  resolve_context: 'route',
  identity: 'id',
  capability: 'tag',
  cedar_authz: 'scale',
  information_tier: 'layers',
  command_validation: 'code',
  threat_signatures: 'radar',
  budget: 'gauge',
  ai_analysis: 'sparkles',
  decision: 'target',
  approval: 'inbox',
  step_up: 'lock',
  connector: 'link',
  output_controls: 'filter',
  audit: 'file',
};

const STATUS: Record<RailStatus, { icon: IconName; ring: string; text: string }> = {
  passed: { icon: 'check', ring: 'bg-ok-soft text-ok-ink', text: 'text-ok-ink' },
  denied: { icon: 'ban', ring: 'bg-bad-soft text-bad-ink', text: 'text-bad-ink' },
  tightened: { icon: 'sparkles', ring: 'bg-ai-soft text-ai-ink', text: 'text-ai-ink' },
  pending: { icon: 'hourglass', ring: 'bg-wait-soft text-wait-ink waiting-ring', text: 'text-wait-ink' },
  skipped: { icon: 'chevron-right', ring: 'bg-sunken text-ink-3', text: 'text-ink-3' },
  not_required: { icon: 'chevron-right', ring: 'bg-sunken text-ink-4', text: 'text-ink-3' },
  not_reached: { icon: 'x', ring: 'border border-dashed border-line-strong text-ink-4', text: 'text-ink-3' },
};

const GROUPS: StageGroup[] = ['ingress', 'controls', 'decision', 'execution'];

const PHASE_FILL: Partial<Record<RailStatus, Tone>> = { passed: 'ok', denied: 'bad', tightened: 'ai', pending: 'wait' };

// The replay walks the four phases at this pace, the way the request went through the Gateway.
const PHASE_STEP_S = 0.32;

/** A phase reads as its most telling stage: a deny, then a wait, then a tightening, then a pass. */
function phaseStatus(stages: RailStage[]): RailStatus {
  for (const s of ['denied', 'pending', 'tightened', 'passed'] as const) if (stages.some((x) => x.status === s)) return s;
  if (stages.every((x) => x.status === 'not_reached')) return 'not_reached';
  return 'not_required';
}

function StatusDot({ status, size = 28 }: { status: RailStatus; size?: number }) {
  const s = STATUS[status];
  return (
    <span style={{ width: size, height: size }} className={`flex shrink-0 items-center justify-center rounded-full ${s.ring}`}>
      <Icon name={s.icon} size={Math.round(size * 0.48)} />
    </span>
  );
}

function CedarExcerpt({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const policy = usePolicy(open ? id : undefined);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Code href={policyHref(id)}>{id}</Code>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-[13px] font-medium text-accent-ink hover:text-accent">
          {open ? 'Hide Cedar' : 'Show Cedar'}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.pre
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="scrollbar-quiet mt-3 max-h-64 overflow-auto rounded-xl bg-sunken p-4 font-mono text-[12px] leading-relaxed text-ink-2"
          >
            {policy.isPending ? 'Loading policy...' : policy.isError ? 'The Gateway did not return this policy.' : policy.data?.cedar}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}

function StageDetail({ stage, controls }: { stage: RailStage; controls: Map<string, Control> }) {
  const span = stage.span;
  const duration = span ? spanDuration(span) : null;
  const modelLabel = typeof span?.attributes?.model_label === 'string' ? span.attributes.model_label : undefined;
  const timing = span
    ? duration === null
      ? parentStage(span) === 'cedar_authz'
        ? 'Decided inside the Cedar evaluation'
        : 'No measured duration'
      : `${formatDuration(duration)}, started ${formatDateTime(span.started_at)}`
    : undefined;
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunken text-ink-2">
          <Icon name={STAGE_ICON[stage.id]} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold text-ink">{stage.label}</p>
          <p className={`text-[13px] font-medium ${STATUS[stage.status].text}`}>
            {RAIL_STATUS_LABEL[stage.status]}
            {timing && <span className="font-normal text-ink-3"> - {timing}</span>}
          </p>
        </div>
        {modelLabel && <span className="rounded-full bg-sunken px-2.5 py-1 text-[12px] text-ink-3">{modelLabel}</span>}
      </div>
      {!span && (
        <p className="text-[14px] leading-relaxed text-ink-2">
          {stage.status === 'not_required'
            ? 'This action did not need this stage.'
            : 'The pipeline never reached this stage: an earlier stage decided the action, or it is still waiting.'}
        </p>
      )}
      {span?.reason && <p className="text-[15px] leading-relaxed text-ink">{span.reason}</p>}
      {span && span.control_ids.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-ink-3">Controls</p>
          {span.control_ids.map((id) => {
            const control = controls.get(id);
            return (
              <div key={id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Code href={controlHref(id)}>{id}</Code>
                  <span className="text-[14px] font-medium text-ink">{control?.name ?? 'Control'}</span>
                </div>
                {control?.description && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{control.description}</p>}
              </div>
            );
          })}
        </div>
      )}
      {span && span.policy_ids.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-ink-3">Policies</p>
          {span.policy_ids.map((id) => (
            <CedarExcerpt key={id} id={id} />
          ))}
        </div>
      )}
      {span && Object.keys(span.attributes ?? {}).length > 0 && <RawTable entries={Object.entries(span.attributes)} />}
    </div>
  );
}

/**
 * The pipeline stages folded into four phases. The phase and stage that decided the action are
 * open on arrival; every other stage is one click away. Arrow keys walk the stages.
 */
export function DecisionPath({ rail, controls }: { rail: Rail; controls: Map<string, Control> }) {
  const reduce = useReducedMotion();
  const step = reduce ? 0 : PHASE_STEP_S;
  const initial = useMemo(() => decidingStage(rail) ?? rail.stages.find((s) => s.id === 'decision'), [rail]);
  const [selected, setSelected] = useState<StageId | undefined>(initial?.id);
  useEffect(() => setSelected(initial?.id), [initial]);
  const stage = rail.stages.find((s) => s.id === selected);
  const group = stage?.group ?? 'decision';
  const phases = GROUPS.map((g) => ({ group: g, stages: rail.stages.filter((s) => s.group === g) }));
  const inPhase = phases.find((p) => p.group === group)!.stages;
  const refs = useRef<Partial<Record<StageId, HTMLButtonElement | null>>>({});

  const onKey = (event: KeyboardEvent) => {
    const index = rail.stages.findIndex((s) => s.id === selected);
    const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? index - 1 : -1;
    if (next < 0 || next >= rail.stages.length) return;
    event.preventDefault();
    const id = rail.stages[next]!.id;
    setSelected(id);
    requestAnimationFrame(() => refs.current[id]?.focus());
  };

  return (
    <div>
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {phases.map((phase, i) => {
          const status = phaseStatus(phase.stages);
          const active = phase.group === group;
          const first = decidingStage({ stages: phase.stages, totalMs: 0 }) ?? phase.stages.find((s) => s.span) ?? phase.stages[0]!;
          const decides = phase.stages.some((x) => x.id === initial?.id);
          return (
            <motion.li
              key={phase.group}
              className="relative"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: status === 'not_reached' ? 0.6 : 1, y: 0 }}
              transition={{ duration: 0.45, ease: EASE, delay: i * step }}
            >
              <button
                type="button"
                onClick={() => setSelected(first.id)}
                aria-pressed={active}
                className={`relative flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-colors ${active ? 'text-ink' : 'text-ink-2 hover:bg-hover'}`}
              >
                {active && (
                  <motion.span
                    layoutId="phase-active"
                    className="absolute inset-0 rounded-xl border border-line bg-surface shadow-card"
                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 42 }}
                  />
                )}
                <motion.span
                  className="relative"
                  initial={reduce ? false : { scale: 0, rotate: -40 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 15, delay: i * step + 0.12 }}
                >
                  {decides && <Burst trigger={1} onMount color={TONE_COLOR[PHASE_FILL[status] ?? 'accent']} strength={2.4} delay={i * step + 0.3} />}
                  <StatusDot status={status} />
                </motion.span>
                <span className="relative min-w-0">
                  <span className="block text-[12px] text-ink-3">Step {i + 1}</span>
                  <span className="block truncate text-[14px] font-medium">{STAGE_GROUP_LABEL[phase.group]}</span>
                </span>
              </button>
            </motion.li>
          );
        })}
      </ol>
      <div aria-hidden="true" className="mt-3 grid grid-cols-4 gap-2 px-1">
        {phases.map((phase, i) => {
          const tone = PHASE_FILL[phaseStatus(phase.stages)];
          return (
            <span key={phase.group} className={`h-1 overflow-hidden rounded-full ${tone ? 'bg-sunken' : 'hatch'}`}>
              {tone && (
                <motion.span
                  className="block h-full origin-left rounded-full"
                  style={{ background: TONE_COLOR[tone], opacity: tone === 'ok' ? 0.7 : 1 }}
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: step || 0.01, ease: 'linear', delay: i * step }}
                />
              )}
            </span>
          );
        })}
      </div>
      <div className="mt-6 grid gap-6 border-t border-line pt-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ul className="space-y-1" onKeyDown={onKey}>
          {inPhase.map((s, i) => {
            const duration = s.span ? spanDuration(s.span) : null;
            return (
              <motion.li
                key={s.id}
                initial={reduce ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, ease: EASE, delay: i * 0.04 }}
              >
                <button
                  ref={(el) => {
                    refs.current[s.id] = el;
                  }}
                  type="button"
                  onClick={() => setSelected(s.id)}
                  aria-pressed={selected === s.id}
                  className={`press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${selected === s.id ? 'bg-sunken' : 'hover:bg-hover'}`}
                >
                  <StatusDot status={s.status} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[14px] ${s.status === 'not_reached' || s.status === 'not_required' ? 'text-ink-3' : 'text-ink'}`}>{s.label}</span>
                    <span className="block text-[12px] text-ink-3">{RAIL_STATUS_LABEL[s.status]}</span>
                  </span>
                  {duration !== null && <span className="font-mono text-[11px] text-ink-3 tabular-nums">{formatDuration(duration)}</span>}
                </button>
              </motion.li>
            );
          })}
        </ul>
        <AnimatePresence mode="wait" initial={false}>
          {stage && (
            <motion.div
              key={stage.id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              <StageDetail stage={stage} controls={controls} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const BAR: Partial<Record<RailStatus, string>> = {
  passed: 'bg-accent',
  denied: 'bg-bad',
  tightened: 'bg-ai',
  pending: 'bg-wait',
  skipped: 'bg-ink-4',
};

/** Where the time went; stages decided inside one Cedar evaluation nest under it without a bar (D11, D20). */
export function Waterfall({ rail }: { rail: Rail }) {
  const total = Math.max(rail.totalMs, 1);
  const withSpan = rail.stages.filter((s) => s.span);
  const nested = withSpan.filter((s) => parentStage(s.span) !== undefined);
  const rows: { stage: RailStage; child: boolean }[] = [];
  for (const stage of withSpan) {
    if (nested.includes(stage)) continue;
    rows.push({ stage, child: false });
    for (const child of nested) if (parentStage(child.span) === stage.id) rows.push({ stage: child, child: true });
  }
  for (const orphan of nested) if (!rows.some((r) => r.stage === orphan)) rows.push({ stage: orphan, child: true });
  return (
    <div>
      <p className="mb-3 text-[13px] text-ink-3 tabular-nums">{formatDuration(rail.totalMs)} end to end</p>
      <ul className="space-y-1">
        {rows.map(({ stage, child }) => {
          const span = stage.span as Span;
          const duration = spanDuration(span);
          const left = ((stage.offsetMs ?? 0) / total) * 100;
          const width = Math.max(0.6, ((duration ?? 0) / total) * 100);
          const parent = STAGES.find((s) => s.id === parentStage(span))?.label;
          return (
            <li key={stage.id} className="grid h-8 grid-cols-[170px_1fr_64px] items-center gap-4">
              <span className={`flex min-w-0 items-center gap-2 text-[13px] ${child ? 'pl-5 text-ink-3' : 'text-ink-2'}`}>
                <Icon name={STAGE_ICON[stage.id]} size={13} className="text-ink-3" />
                <span className="truncate">{stage.label}</span>
              </span>
              {duration === null ? (
                <span className="text-[12px] text-ink-3">
                  {child && parent ? `decided in the same ${parent === 'Cedar authz' ? 'Cedar' : parent} evaluation` : RAIL_STATUS_LABEL[stage.status]}
                </span>
              ) : (
                <span className="relative h-1.5 rounded-full bg-sunken">
                  <motion.span
                    className={`absolute inset-y-0 rounded-full ${BAR[stage.status] ?? 'bg-ink-4'}`}
                    style={{ left: `${Math.min(left, 99.4)}%` }}
                    initial={{ width: 0 }}
                    animate={{ width: `max(3px, ${width}%)` }}
                    transition={{ duration: 0.6, ease: EASE }}
                  />
                </span>
              )}
              <span className="text-right font-mono text-[12px] text-ink-3 tabular-nums">{duration === null ? '–' : formatDuration(duration)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Step({ title, icon, note, children, index }: { title: string; icon: IconName; note: string; children: ReactNode; index: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="min-w-0 flex-1 rounded-[18px] border border-line bg-sunken/60 p-5"
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.1 + index * 0.18 }}
    >
      <p className="flex items-center gap-2 text-[13.5px] font-bold text-ink-2">
        <Icon name={icon} size={16} className="text-ink-3" />
        {title}
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">{children}</div>
      <p className="mt-3 text-[12.5px] leading-snug text-ink-3">{note}</p>
    </motion.div>
  );
}

function Arrow({ index }: { index: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      className="hidden shrink-0 text-ink-4 md:block"
      initial={reduce ? false : { opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: 0.2 + index * 0.18 }}
    >
      <Icon name="arrow-right" size={20} />
    </motion.span>
  );
}

const ANALYZER_ICON: Record<Trace['analyzer']['verdict'], IconName> = {
  clean: 'check',
  suspicious: 'alert',
  malicious: 'ban',
  unavailable: 'info',
  skipped: 'pause',
};

/** Deterministic verdict, then what AI analysis said, then the final decision: AI only ever tightens. */
export function Composition({ trace }: { trace: Trace }) {
  const ran = trace.analyzer.verdict !== 'skipped';
  const det = { decision: trace.deterministic_decision, approval_state: 'none' as const, capability: trace.capability, agent: trace.agent };
  const verdictTone: Tone = trace.ai_tightened ? 'ai' : trace.analyzer.verdict === 'clean' ? 'ok' : 'muted';
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
        <Step index={0} icon="scale" title="Deterministic controls" note="Policy alone. The same request always gets this answer.">
          <StatusBadge outcome={outcomeOf(det)} />
        </Step>
        <Arrow index={0} />
        <Step index={1} icon="sparkles" title="AI analysis" note={ran ? 'Advisory. It may only make the decision stricter.' : 'Not needed: policy had already denied it.'}>
          <StatusBadge outcome={{ tone: verdictTone, label: analyzerVerdictLabel[trace.analyzer.verdict], waiting: false }} icon={ANALYZER_ICON[trace.analyzer.verdict]} />
          {trace.analyzer.model_label && <span className="text-[12.5px] text-ink-3">{trace.analyzer.model_label}</span>}
        </Step>
        <Arrow index={1} />
        <Step index={2} icon="target" title="Final decision" note={trace.ai_tightened ? 'Stricter than policy alone, because of the analysis.' : 'Exactly what policy decided.'}>
          <StatusBadge
            outcome={outcomeOf(trace)}
            title={resolutionOf(trace) ? `Gateway decision: ${decisionLabel[trace.decision]}.` : undefined}
            ai={trace.ai_tightened ? (trace.analyzer.model_label ?? true) : undefined}
          />
        </Step>
      </div>
      {(ran || trace.ai_tightened) && trace.analyzer.rationale && <p className="text-[14px] leading-relaxed text-ink-2">{trace.analyzer.rationale}</p>}
      {!ran && <p className="text-[14px] text-ink-2">The deterministic controls denied this action, so the analyzer was not consulted.</p>}
      <p className="flex items-center gap-2 text-[13px] text-ink-3">
        <Icon name="info" size={14} />
        AI analysis may make a decision stricter. It can never make a deterministic deny go away.
      </p>
    </div>
  );
}
