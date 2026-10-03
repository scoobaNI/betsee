import { usePolicy, type Control, type Span, type Trace } from '@betsee/api';
import { DecisionChip, Icon, IdToken, MockBadge } from '@betsee/ui';
import { useRef, useState, type KeyboardEvent } from 'react';
import { analyzerVerdictLabel, resolutionOf } from '../domain/decision.ts';
import { formatDateTime } from '../domain/format.ts';
import {
  RAIL_STATUS_LABEL,
  STAGE_GROUP_LABEL,
  STAGES,
  formatDuration,
  parentStage,
  spanDuration,
  type Rail,
  type RailStage,
  type RailStatus,
} from '../domain/pipeline.ts';
import { ECOSYSTEM_URL } from './shell.tsx';

const NODE: Record<RailStatus, string> = {
  passed: 'border border-allow-border bg-surface-2 text-fg-secondary',
  denied: 'border border-deny-fg bg-deny-bg text-deny-fg',
  tightened: 'border border-tightened-fg bg-surface-2 text-tightened-fg',
  pending: 'border border-dashed border-approval-fg bg-surface-2 text-approval-fg dir-ring-pending',
  skipped: 'border border-line-subtle bg-surface-2 text-fg-disabled',
  not_required: 'border border-line-subtle bg-surface-2 text-fg-disabled',
  not_reached: 'border border-dashed border-line-subtle bg-surface-2 text-fg-secondary opacity-40',
};

const BADGE: Partial<Record<RailStatus, { icon: string; className: string }>> = {
  passed: { icon: 'streamline:check', className: 'text-allow-fg' },
  denied: { icon: 'streamline-flex:block-2', className: 'text-deny-fg' },
  tightened: { icon: 'streamline:ai-chip-spark', className: 'text-tightened-fg' },
  pending: { icon: 'streamline-flex:hourglass', className: 'text-approval-fg' },
};

const LINE: Record<RailStatus, string> = {
  passed: 'border-t-2 border-brand-600',
  tightened: 'border-t-2 border-brand-600',
  denied: 'border-t-2 border-dashed border-line-default',
  pending: 'border-t-2 border-dashed border-line-default',
  skipped: 'border-t-2 border-line-default',
  not_required: 'border-t-2 border-line-default',
  not_reached: 'border-t-2 border-dashed border-line-subtle',
};

export function PipelineRail({ rail, selected, onSelect }: { rail: Rail; selected: string | undefined; onSelect: (id: RailStage['id']) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: KeyboardEvent, index: number) => {
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : -1;
    if (next < 0 || next >= rail.stages.length) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onSelect(rail.stages[next]!.id);
  };
  const groups = rail.stages.reduce<{ group: RailStage['group']; count: number }[]>((acc, stage) => {
    const last = acc.at(-1);
    if (last?.group === stage.group) last.count++;
    else acc.push({ group: stage.group, count: 1 });
    return acc;
  }, []);

  return (
    <div className="overflow-x-auto rounded-lg border border-line-subtle bg-surface-1 p-4 shadow-e1">
      <div className="grid min-w-[840px] grid-cols-15 gap-y-2">
        {groups.map(({ group, count }) => (
          <p key={group} style={{ gridColumn: `span ${count}` }} className="truncate border-l border-line-subtle pl-2 text-2xs font-semibold uppercase tracking-[var(--bs-font-tracking-caps)] text-fg-tertiary first:border-l-0 first:pl-0">
            {STAGE_GROUP_LABEL[group]}
          </p>
        ))}
        {rail.stages.map((stage, index) => {
          const pending = stage.status === 'pending';
          const stepUp = stage.id === 'step_up';
          const badge = pending && stepUp ? { icon: 'streamline-flex:fingerprint-1', className: 'text-stepup-fg' } : BADGE[stage.status];
          return (
            <div key={stage.id} className="relative flex flex-col items-center">
              {index < rail.stages.length - 1 && (
                <span aria-hidden="true" className={`absolute left-1/2 top-4 w-full ${LINE[stage.status]}`} />
              )}
              <button
                ref={(el) => {
                  refs.current[index] = el;
                }}
                type="button"
                onClick={() => onSelect(stage.id)}
                onKeyDown={(e) => onKey(e, index)}
                aria-pressed={selected === stage.id}
                aria-label={`${stage.label}: ${RAIL_STATUS_LABEL[stage.status]}`}
                title={`${stage.label}: ${RAIL_STATUS_LABEL[stage.status]}${stage.span && spanDuration(stage.span) !== null ? `, ${formatDuration(spanDuration(stage.span)!)}` : ''}`}
                className={`relative z-(--bs-z-base) flex h-8 w-8 items-center justify-center rounded-sm ${NODE[stage.status]} ${
                  pending && stepUp ? 'dir-ring-stepup border-stepup-fg text-stepup-fg' : ''
                } ${selected === stage.id ? 'shadow-selected' : ''}`}
              >
                <Icon name={stage.icon} size={14} />
                {badge && (
                  <span className={`absolute -bottom-1.5 -right-1.5 flex h-3 w-3 items-center justify-center rounded-pill bg-surface-1 ${badge.className}`}>
                    <Icon name={badge.icon} size={12} />
                  </span>
                )}
              </button>
              <span className={`mt-2 text-center text-2xs leading-tight ${stage.status === 'not_reached' ? 'text-fg-tertiary' : 'text-fg-secondary'}`}>
                {stage.label}
              </span>
              <span className="text-center text-2xs text-fg-tertiary">{stage.status === 'passed' ? '' : RAIL_STATUS_LABEL[stage.status]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BAR: Partial<Record<RailStatus, string>> = {
  passed: 'bg-brand-600',
  denied: 'bg-deny-fg',
  tightened: 'bg-tightened-fg',
  pending: 'dir-hatch-pending',
  skipped: 'bg-line-default',
};

export function Waterfall({ rail, selected, onSelect }: { rail: Rail; selected: string | undefined; onSelect: (id: RailStage['id']) => void }) {
  const total = Math.max(rail.totalMs, 1);
  // D11: stages decided inside one Cedar evaluation carry no duration; list them under their parent.
  // D20: a stage nests under its parent only when the span names one (parent_stage); any other
  // stage without a duration is a normal row with its status and no bar.
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
    <div className="rounded-lg border border-line-subtle bg-surface-1 p-2 shadow-e1">
      <div className="flex items-center justify-between px-2 pb-2 pt-1 text-2xs text-fg-tertiary">
        <span className="font-semibold uppercase tracking-[var(--bs-font-tracking-caps)]">Spans</span>
        <span className="font-mono tabular-nums">{formatDuration(rail.totalMs)} end to end</span>
      </div>
      <ul>
        {rows.map(({ stage, child }) => {
          const span = stage.span!;
          const duration = spanDuration(span);
          const left = ((stage.offsetMs ?? 0) / total) * 100;
          const width = Math.max(0.6, ((duration ?? 0) / total) * 100);
          const parentId = parentStage(span);
          const parent = STAGES.find((s) => s.id === parentId)?.label;
          return (
            <li key={stage.id}>
              <button
                type="button"
                onClick={() => onSelect(stage.id)}
                className={`relative grid h-9 w-full grid-cols-[180px_1fr_72px] items-center gap-3 rounded-md px-2 text-left hover:bg-surface-2 ${
                  selected === stage.id ? 'bg-surface-2 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-pill before:bg-accent' : ''
                }`}
              >
                <span className={`relative flex min-w-0 items-center gap-2 text-sm ${child ? 'pl-5 text-fg-secondary' : ''}`}>
                  {child && <span aria-hidden="true" className="absolute left-2 top-[-18px] h-[27px] w-2.5 rounded-bl-xs border-b border-l border-line-default" />}
                  <Icon name={stage.icon} size={14} className="text-fg-secondary" />
                  <span className="truncate">{stage.label}</span>
                </span>
                {duration === null ? (
                  <span className="text-xs text-fg-tertiary">
                    {child && parent ? `decided in the same ${parent === 'Cedar authz' ? 'Cedar' : parent} evaluation` : RAIL_STATUS_LABEL[stage.status]}
                  </span>
                ) : (
                  <span className="relative h-2 rounded-xs bg-surface-inset">
                    <span className={`absolute inset-y-0 rounded-xs ${BAR[stage.status] ?? 'bg-line-default'}`} style={{ left: `${Math.min(left, 99.4)}%`, width: `max(2px, ${width}%)` }} />
                  </span>
                )}
                <span className="text-right font-mono text-xs tabular-nums text-fg-secondary">{duration === null ? '\u2013' : formatDuration(duration)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const controlHref = (id: string) => `${ECOSYSTEM_URL}/policy-studio/controls/${encodeURIComponent(id)}`;
const policyHref = (id: string) => `${ECOSYSTEM_URL}/policy-studio/policies/${encodeURIComponent(id)}`;

function CedarExcerpt({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const policy = usePolicy(open ? id : undefined);
  return (
    <div>
      <div className="flex items-center gap-2">
        <IdToken id={id} href={policyHref(id)} />
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-accent-text hover:underline">
          {open ? 'Hide Cedar' : 'Show Cedar'}
        </button>
      </div>
      {open && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-sm bg-surface-inset p-3 font-mono text-xs text-fg-secondary">
          {policy.isPending ? 'Loading policy...' : policy.isError ? 'The Gateway did not return this policy.' : policy.data?.cedar}
        </pre>
      )}
    </div>
  );
}

function Attributes({ attributes }: { attributes: Span['attributes'] }) {
  const entries = Object.entries(attributes ?? {});
  if (!entries.length) return null;
  return (
    <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-1.5 rounded-sm bg-surface-inset p-3 font-mono text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-fg-tertiary">{key}</dt>
          <dd className="break-all text-fg-primary">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SpanDetail({ stage, controls }: { stage: RailStage | undefined; controls: Map<string, Control> }) {
  if (!stage) {
    return (
      <div className="rounded-lg border border-line-subtle bg-surface-1 p-5 text-sm text-fg-secondary shadow-e1">Select a stage to see what it checked.</div>
    );
  }
  const span = stage.span;
  const modelLabel = typeof span?.attributes?.model_label === 'string' ? span.attributes.model_label : undefined;
  return (
    <section aria-label={`${stage.label} detail`} className="space-y-4 rounded-lg border border-line-subtle bg-surface-1 p-5 shadow-e1">
      <header className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-surface-3 text-fg-secondary">
          <Icon name={stage.icon} size={16} />
        </span>
        <div>
          <h3 className="text-lg font-semibold">{stage.label}</h3>
          <p className="text-xs text-fg-secondary">
            {RAIL_STATUS_LABEL[stage.status]}
            {span
              ? spanDuration(span) === null
                ? parentStage(span) === 'cedar_authz'
                  ? ` - decided inside the Cedar evaluation - ${formatDateTime(span.started_at)}`
                  : ` - no measured duration - ${formatDateTime(span.started_at)}`
                : ` - ${formatDuration(spanDuration(span)!)} - started ${formatDateTime(span.started_at)}`
              : ''}
          </p>
        </div>
        {modelLabel && <MockBadge modelLabel={modelLabel} className="ml-auto" />}
      </header>
      {!span && (
        <p className="text-sm text-fg-secondary">
          {stage.status === 'not_required'
            ? 'This action did not need this stage.'
            : 'The pipeline never reached this stage: an earlier stage decided the action, or it is still waiting.'}
        </p>
      )}
      {span?.reason && <p className="text-md">{span.reason}</p>}
      {span && span.control_ids.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-fg-secondary">Controls</h4>
          {span.control_ids.map((id) => {
            const control = controls.get(id);
            return (
              <div key={id} className="rounded-md border border-line-subtle p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <IdToken id={id} href={controlHref(id)} />
                  <span className="text-sm font-semibold">{control?.name ?? 'Control'}</span>
                </div>
                {control?.description && <p className="mt-1.5 text-sm text-fg-secondary">{control.description}</p>}
              </div>
            );
          })}
        </div>
      )}
      {span && span.policy_ids.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-fg-secondary">Policies</h4>
          {span.policy_ids.map((id) => (
            <CedarExcerpt key={id} id={id} />
          ))}
        </div>
      )}
      {span && <Attributes attributes={span.attributes} />}
    </section>
  );
}

export function CompositionPanel({ trace }: { trace: Trace }) {
  const ran = trace.analyzer.verdict !== 'skipped';
  return (
    <section aria-label="Decision composition" className="space-y-4 rounded-lg border border-line-subtle bg-surface-1 p-5 shadow-e1">
      <h3 className="text-lg font-semibold">How the decision was composed</h3>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 [&>div]:shrink-0">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg-secondary">Deterministic</p>
          <DecisionChip decision={trace.deterministic_decision} size="sm" />
        </div>
        <Icon name="streamline:interface-arrows-button-right-arrow-right-keyboard" size={14} className="mt-7 text-fg-tertiary" />
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg-secondary">AI analysis</p>
          <span
            className={`inline-flex h-5 items-center gap-1.5 rounded-pill border px-2 text-xs font-semibold ${
              trace.ai_tightened ? 'border-tightened-border bg-tightened-bg text-tightened-fg' : 'border-line-default text-fg-secondary'
            }`}
          >
            <Icon name="streamline-flex:ai-scanner-robot" size={12} />
            {analyzerVerdictLabel[trace.analyzer.verdict]}
          </span>
          <MockBadge modelLabel={trace.analyzer.model_label} />
        </div>
        <Icon name="streamline:interface-arrows-button-right-arrow-right-keyboard" size={14} className="mt-7 text-fg-tertiary" />
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg-secondary">Final</p>
          <DecisionChip
            decision={trace.decision}
            resolution={resolutionOf(trace)}
            aiTightened={trace.ai_tightened}
            modelLabel={trace.analyzer.model_label}
            controlIds={trace.control_ids}
            size="sm"
          />
        </div>
      </div>
      {(ran || trace.ai_tightened) && trace.analyzer.rationale && <p className="text-sm text-fg-secondary">{trace.analyzer.rationale}</p>}
      {!ran && <p className="text-sm text-fg-secondary">The deterministic controls denied this action, so the analyzer was not consulted.</p>}
      <p className="border-t border-line-subtle pt-3 text-sm text-fg-secondary">
        AI analysis may make a decision stricter. It can never make a deterministic deny go away.
      </p>
    </section>
  );
}
