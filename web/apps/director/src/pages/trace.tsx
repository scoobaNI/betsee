import { ApiRequestError, useAgentMessages, useAgents, useControls, useTrace, type Control, type Trace } from '@betsee/api';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Icon, type IconName } from '../components/icon.tsx';
import { Composition, DecisionPath, Waterfall } from '../components/pipeline.tsx';
import { Breakable, ReasonText } from '../components/reason.tsx';
import {
  ActionVerdict,
  AgentGlyph,
  Avatar,
  Breadcrumbs,
  Card,
  Code,
  controlHref,
  CopyId,
  Disclosure,
  EmptyState,
  ErrorCard,
  policyHref,
  RawTable,
  Section,
  Skeleton,
  TextLink,
  TierText,
} from '../components/ui.tsx';
import { callerLabel, callerOf, type Caller } from '../domain/caller.ts';
import { becauseSentence, decisionLabel, isVoided, reasonFromAnalyzer, resolutionOf } from '../domain/decision.ts';
import { teamName } from '../domain/feed.ts';
import { formatDateTime, formatTime } from '../domain/format.ts';
import { buildRail, formatDuration } from '../domain/pipeline.ts';

/** After a human decides, the Gateway rewrites decision to allow; the sentence names the human step. */
function verdictWords(trace: Trace): string {
  if (isVoided(trace)) return 'Voided: the session ended before a human decided';
  const resolution = resolutionOf(trace);
  // After approval the Gateway clears step_up_required; a passed step-up span is the evidence then.
  const stepUp =
    trace.step_up_required || trace.obligations.includes('step_up') || trace.spans.some((s) => s.stage === 'step_up' && s.status === 'passed');
  if (resolution === 'approved' || resolution === 'verified') return stepUp ? 'Approved by a human with step-up' : 'Approved by a human';
  if (resolution === 'rejected' || resolution === 'failed') return 'Rejected by a human';
  return decisionLabel[trace.decision];
}

type Execution = 'connector' | 'delegated' | 'forwarded';

/** Who carried the action out (contract addition p-861: optional `execution`). */
function executionLine(trace: Trace): string {
  if (!trace.executed) return 'Not executed.';
  const execution = (trace as Trace & { execution?: Execution }).execution;
  if (execution === 'delegated') return 'Executed by the agent runtime after allow.';
  if (execution === 'forwarded') return 'Forwarded to the agent after the check.';
  return 'Executed by the connector.';
}

function Sentence({ trace }: { trace: Trace }) {
  const policy = trace.policy_ids[0];
  const strong = 'font-semibold text-ink';
  return (
    <p className="text-[22px] leading-[1.45] tracking-[-0.01em] text-ink-2 md:text-[24px]">
      <span className={strong}>{callerLabel(callerOf(trace.human, trace.agent.id))}</span>, through <span className={strong}>{trace.agent.id}</span>,{' '}
      {trace.use_case ? (
        <>
          for <span className={strong}>{trace.use_case.name}</span>
        </>
      ) : (
        'with no bound use case'
      )}
      , asked for <span className={strong}>{trace.capability}</span> on {trace.resource.type} {trace.resource.id}.{' '}
      <span className={strong}>{verdictWords(trace)}</span>
      {policy ? (
        <>
          {resolutionOf(trace) ? ', under policy ' : ' by policy '}
          <span className="font-mono text-[0.8em] text-ink">{policy}</span>.
        </>
      ) : (
        '.'
      )}
    </p>
  );
}

function Hero({ trace, controls }: { trace: Trace; controls: Map<string, Control> }) {
  return (
    <Card className="p-8 md:p-10">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ActionVerdict action={trace} size="lg" />
        <span className="ml-auto flex items-center gap-3 text-[13px] text-ink-3">
          <span title={formatDateTime(trace.occurred_at)} className="tabular-nums">
            {formatTime(trace.occurred_at)}
          </span>
          <span aria-hidden="true">-</span>
          <span className="tabular-nums">{formatDuration(trace.latency_ms)} in the Gateway</span>
          <CopyId value={trace.trace_id} />
        </span>
      </div>
      <div className="mt-7">
        <Sentence trace={trace} />
      </div>
      <div className="mt-7 border-t border-line pt-6">
        <p className="text-[12px] font-medium text-ink-3">Why</p>
        <p className="mt-2 text-[15px] leading-relaxed text-ink">
          <ReasonText text={becauseSentence(trace, (id) => controls.get(id))} />
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <Icon name={trace.executed ? 'circle-check' : 'ban'} size={14} />
            {executionLine(trace)}
          </span>
          {reasonFromAnalyzer(trace) && (
            <span className="inline-flex items-center gap-1.5 text-ai-ink">
              <Icon name="sparkles" size={14} />
              Reason found by AI analysis{trace.analyzer.model_label ? ` (${trace.analyzer.model_label})` : ''}
            </span>
          )}
        </p>
      </div>
    </Card>
  );
}

function CallerValue({ caller }: { caller: Caller }) {
  if (caller.kind === 'human') {
    return (
      <span className="flex items-center gap-2.5">
        <Avatar name={caller.name} size={26} />
        <span className="truncate">{caller.name}</span>
      </span>
    );
  }
  // An unauthenticated request or the Gateway itself is never drawn as a person (p-420).
  return (
    <span className="flex items-center gap-2.5">
      <span className={`flex h-[26px] w-[26px] items-center justify-center rounded-lg ${caller.kind === 'gateway' ? 'bg-accent-soft text-accent-ink' : 'bg-bad-soft text-bad-ink'}`}>
        <Icon name={caller.kind === 'gateway' ? 'shield' : 'shield-x'} size={14} />
      </span>
      <span>
        {caller.name} <span className="font-mono text-[12px] text-ink-3">({caller.id})</span>
      </span>
    </span>
  );
}

function Fact({ icon, label, children, sub }: { icon: IconName; label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 bg-surface p-6">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
        <Icon name={icon} size={13} />
        {label}
      </p>
      <div className="mt-3 text-[15px] text-ink">{children}</div>
      {sub && <div className="mt-1.5 text-[13px] text-ink-3">{sub}</div>}
    </div>
  );
}

function Facts({ trace }: { trace: Trace }) {
  const agents = useAgents();
  const state = agents.data?.find((a) => a.id === trace.agent.id)?.state;
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-card sm:grid-cols-2 lg:grid-cols-3">
      <Fact icon="user" label="Who initiated">
        <CallerValue caller={callerOf(trace.human, trace.agent.id)} />
      </Fact>
      <Fact icon="bot" label="Through which agent" sub={`${teamName(trace.agent.team)} team`}>
        <Link to={`/agents/${encodeURIComponent(trace.agent.id)}`} className="group inline-flex items-center gap-2.5 hover:text-accent-ink">
          <AgentGlyph state={state} size={26} />
          <span className="truncate font-medium">{trace.agent.id}</span>
          <Icon name="chevron-right" size={14} className="text-ink-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </Fact>
      <Fact
        icon="target"
        label="Why (use case)"
        sub={
          trace.session_id ? (
            <>
              Session <span className="font-mono text-[12px]">{trace.session_id}</span>
            </>
          ) : undefined
        }
      >
        {trace.use_case ? trace.use_case.name : <span className="text-ink-2">None: the request was not bound to a valid session</span>}
      </Fact>
      <Fact
        icon="tag"
        label="Capability"
        sub={
          trace.tool ? (
            <>
              via <span className="font-mono text-[12px]">{trace.tool.name}</span> on {trace.tool.connector}
            </>
          ) : undefined
        }
      >
        <Code className="text-[13px]">{trace.capability}</Code>
      </Fact>
      <Fact icon="layers" label="Resource" sub={<TierText tier={trace.resource.tier} />}>
        <span className="font-mono text-[13px] [overflow-wrap:normal]">
          <Breakable text={`${trace.resource.type}:${trace.resource.id}`} />
        </span>
      </Fact>
      <Fact icon="scale" label="Policy and controls">
        <span className="flex flex-wrap gap-1.5">
          {trace.policy_ids.map((id) => (
            <Code key={id} href={policyHref(id)}>
              {id}
            </Code>
          ))}
          {trace.control_ids.map((id) => (
            <Code key={id} href={controlHref(id)}>
              {id}
            </Code>
          ))}
          {!trace.policy_ids.length && !trace.control_ids.length && <span className="text-[14px] text-ink-3">None recorded</span>}
        </span>
      </Fact>
    </div>
  );
}

function AgentMessage({ traceId }: { traceId: string }) {
  const messages = useAgentMessages();
  const message = messages.data?.find((m) => m.trace_id === traceId);
  if (!message) return null;
  return (
    <Disclosure title="Mediated agent message" hint={`${message.sender.id} to ${message.receiver.id}`} icon="message" defaultOpen>
      <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
        <span className="font-medium text-ink">{message.sender.id}</span>
        <Icon name="arrow-right" size={13} className="text-ink-4" />
        <span className="font-medium text-ink">{message.receiver.id}</span>
        <span>for {message.use_case.name}, asking</span>
        <Code>{message.capability}</Code>
      </p>
      <p className="mt-4 rounded-xl border border-line p-4 text-[14px] leading-relaxed text-ink">
        {message.content ? message.content : <span className="text-ink-3">Blocked content is never delivered to the receiver.</span>}
      </p>
      {Object.keys(message.provenance).length > 0 && (
        <div className="mt-4">
          <RawTable entries={Object.entries(message.provenance)} prefix="provenance." />
        </div>
      )}
    </Disclosure>
  );
}

function TraceSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-64 rounded-lg" />
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
      <Skeleton className="h-80" />
    </div>
  );
}

export function TracePage() {
  const { traceId } = useParams();
  const trace = useTrace(traceId);
  const controlsQuery = useControls();
  const controls = useMemo(() => new Map<string, Control>((controlsQuery.data ?? []).map((c) => [c.id, c])), [controlsQuery.data]);
  const rail = useMemo(
    () =>
      trace.data ? buildRail(trace.data.spans, trace.data.decision, trace.data.step_up_required || trace.data.obligations.includes('step_up')) : undefined,
    [trace.data],
  );

  useEffect(() => {
    document.title = `Trace ${traceId?.slice(0, 8) ?? ''} - Director - Betsee`;
  }, [traceId]);

  const crumbs = [
    { label: 'Overview', to: '/' },
    { label: 'Activity', to: '/activity' },
    { label: `Trace ${traceId?.slice(0, 8) ?? ''}` },
  ];

  if (trace.isPending) return <TraceSkeleton />;
  if (trace.isError) {
    if (trace.error instanceof ApiRequestError && trace.error.status === 404) {
      return (
        <Card>
          <EmptyState icon="route" title="Trace not found" body="The Gateway has no trace with this id.">
            <TextLink to="/activity">Back to activity</TextLink>
          </EmptyState>
        </Card>
      );
    }
    return <ErrorCard title="Could not load the trace" error={trace.error} onRetry={() => void trace.refetch()} />;
  }

  const data = trace.data;
  const context = Object.entries(data.execution_context ?? {});
  return (
    <div>
      <div className="mb-8">
        <Breadcrumbs items={crumbs} />
      </div>
      <Hero trace={data} controls={controls} />
      <div className="mt-6">
        <Facts trace={data} />
      </div>
      <div className="mt-14 space-y-14">
        {rail && (
          <Section title="How the Gateway decided" hint="Open any step to see what it checked">
            <Card className="p-4 md:p-6">
              <DecisionPath rail={rail} controls={controls} />
            </Card>
          </Section>
        )}
        <Section title="Deeper detail">
          <div className="space-y-3">
            <AgentMessage traceId={data.trace_id} />
            <Disclosure title="How the decision was composed" hint="Deterministic controls, then AI analysis, then the final decision" icon="sparkles">
              <Composition trace={data} />
            </Disclosure>
            {rail && (
              <Disclosure title="Timing" hint={`${formatDuration(rail.totalMs)} across ${data.spans.length} recorded spans`} icon="clock">
                <Waterfall rail={rail} />
              </Disclosure>
            )}
            {context.length > 0 && (
              <Disclosure title="Execution context" hint="Exactly as the Gateway resolved it" icon="code">
                <RawTable entries={context} />
              </Disclosure>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
