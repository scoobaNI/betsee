import type { Decision, Span, SpanStatus, StageId } from '@betsee/api';

export const STAGES: readonly { id: StageId; label: string; icon: string; group: StageGroup }[] = [
  { id: 'authenticate', label: 'Authenticate', icon: 'streamline-flex:key-frame', group: 'ingress' },
  { id: 'resolve_context', label: 'Resolve context', icon: 'streamline-flex:hierarchy-2', group: 'ingress' },
  { id: 'identity', label: 'Identity', icon: 'streamline-flex:user-identifier-card', group: 'controls' },
  { id: 'capability', label: 'Capability', icon: 'streamline-flex:tag', group: 'controls' },
  { id: 'cedar_authz', label: 'Cedar authz', icon: 'streamline-flex:justice-scale-1', group: 'controls' },
  { id: 'information_tier', label: 'Information tier', icon: 'streamline-flex:layers-1', group: 'controls' },
  { id: 'command_validation', label: 'Command validation', icon: 'streamline-flex:code-analysis', group: 'controls' },
  { id: 'budget', label: 'Budget', icon: 'streamline-flex:dashboard-gauge-1', group: 'controls' },
  { id: 'ai_analysis', label: 'AI analysis', icon: 'streamline-flex:ai-scanner-robot', group: 'decision' },
  { id: 'decision', label: 'Decision', icon: 'streamline-flex:arrow-roadmap', group: 'decision' },
  { id: 'approval', label: 'Approval', icon: 'streamline-flex:inbox', group: 'decision' },
  { id: 'step_up', label: 'Step-up', icon: 'streamline-flex:fingerprint-1', group: 'decision' },
  { id: 'connector', label: 'Connector', icon: 'streamline-flex:link-chain', group: 'execution' },
  { id: 'output_controls', label: 'Output controls', icon: 'streamline-flex:filter-2', group: 'execution' },
  { id: 'audit', label: 'Audit', icon: 'streamline-flex:text-file', group: 'execution' },
];

export type StageGroup = 'ingress' | 'controls' | 'decision' | 'execution';

export const STAGE_GROUP_LABEL: Record<StageGroup, string> = {
  ingress: 'Ingress',
  controls: 'Deterministic controls',
  decision: 'Analysis and decision',
  execution: 'Execution and audit',
};

export type RailStatus = SpanStatus | 'not_required' | 'not_reached';

export const RAIL_STATUS_LABEL: Record<RailStatus, string> = {
  passed: 'Passed',
  denied: 'Denied',
  tightened: 'Tightened',
  pending: 'Waiting',
  skipped: 'Skipped',
  not_required: 'Not required',
  not_reached: 'Not reached',
};

export interface RailStage {
  id: StageId;
  label: string;
  icon: string;
  group: StageGroup;
  status: RailStatus;
  span: Span | undefined;
  /** Offset from the first span's start, for the timing waterfall. */
  offsetMs: number | undefined;
}

export interface Rail {
  stages: RailStage[];
  totalMs: number;
}

/**
 * Lays a trace's spans onto the fixed stage rail. A missing span means "not reached"
 * (contracts/events.md), except approval and step-up, which an action may simply not need.
 * Pass the trace's step_up_required (or a step_up obligation) as stepUpRequired.
 */
export function buildRail(spans: readonly Span[], decision: Decision, stepUpRequired = false): Rail {
  const byStage = new Map<string, Span>();
  for (const span of spans) if (!byStage.has(span.stage)) byStage.set(span.stage, span);

  const starts = spans.map((s) => Date.parse(s.started_at)).filter((t) => !Number.isNaN(t));
  const origin = starts.length ? Math.min(...starts) : 0;
  const end = spans.reduce((max, s) => {
    const start = Date.parse(s.started_at);
    return Number.isNaN(start) ? max : Math.max(max, start + (spanDuration(s) ?? 0));
  }, origin);

  // The trace's own step_up_required / obligations is authoritative (contract v0.1); the Gateway's
  // approval span carries only approval_id and action_hash. A rejected approval never reaches step-up.
  const approval = byStage.get('approval');
  const stepUpExpected =
    decision === 'require_step_up' || (decision === 'require_approval' && stepUpRequired && approval?.status !== 'denied');

  // A deny ends the rail: every later stage reads "not reached" even when the Gateway still records a
  // skipped span for it; decision and audit always run (components.md, PipelineRail).
  const denyIndex = STAGES.findIndex((s) => s.id !== 'decision' && byStage.get(s.id)?.status === 'denied');
  const humanExpected = { approval: decision === 'require_approval', step_up: stepUpExpected } as const;

  const stages = STAGES.map((stage, index): RailStage => {
    const span = byStage.get(stage.id);
    let status: RailStatus;
    if (denyIndex >= 0 && index > denyIndex && stage.id !== 'decision' && stage.id !== 'audit') status = 'not_reached';
    else if ((stage.id === 'approval' || stage.id === 'step_up') && (!span || span.status === 'skipped')) {
      status = humanExpected[stage.id] ? 'not_reached' : 'not_required';
    } else if (span) status = span.status;
    else status = 'not_reached';
    const start = span ? Date.parse(span.started_at) : Number.NaN;
    return { ...stage, status, span, offsetMs: Number.isNaN(start) ? undefined : start - origin };
  });

  return { stages, totalMs: Math.max(0, end - origin) };
}

/** The stage to preselect: the first deny, else the first one waiting, else the analysis if it tightened. */
export function decidingStage(rail: Rail): RailStage | undefined {
  return (
    rail.stages.find((s) => s.status === 'denied') ??
    rail.stages.find((s) => s.status === 'pending') ??
    rail.stages.find((s) => s.status === 'tightened')
  );
}

/**
 * D11: stages decided inside one Cedar evaluation (identity, capability, information tier) carry no
 * duration of their own; they render nested under Cedar authz without a bar.
 */
export function spanDuration(span: Pick<Span, 'duration_ms'>): number | null {
  const value = (span as { duration_ms: number | null }).duration_ms;
  return typeof value === 'number' ? value : null;
}

export function parentStage(span: Span | undefined): string | undefined {
  const parent = (span as (Span & { parent_stage?: string | null }) | undefined)?.parent_stage;
  return typeof parent === 'string' ? parent : undefined;
}

export function formatDuration(ms: number): string {
  if (ms < 0.1) return '<0.1 ms';
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
  if (ms >= 1_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 10) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}
