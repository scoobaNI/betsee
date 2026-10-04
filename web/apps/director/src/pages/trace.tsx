import { ApiRequestError, useAgentMessages, useAgents, useControls, useTrace, type Control, type Trace } from '@betsee/api';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Icon, type IconName } from '../components/icon.tsx';
import { Burst, Rise, Stagger, TONE_COLOR } from '../components/motion.tsx';
import { Composition, DecisionPath, Waterfall } from '../components/pipeline.tsx';
import { Chip, MaskedList, SemanticDetail, SignatureList } from '../components/guardrails.tsx';
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
  outcomeOf,
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
import { formatCents, formatCount, formatDateTime, formatTime } from '../domain/format.ts';
import { classLabel, formatPriceCents } from '../domain/guardrails.ts';
import { buildRail, formatDuration } from '../domain/pipeline.ts';
import { repeatGroups } from '../domain/determinism.ts';
import { useActions } from '../hooks.ts';

/** After a human decides, the Gateway rewrites decision to allow; the sentence names the human step. */
function verdictWords(trace: Trace): string {
  if (isVoided(trace)) return 'Voided: the session ended before a human decided';
  const resolution = resolutionOf(trace);
  // After approval the Gateway clears step_up_required; a passed step-up span is the evidence then.
  const stepUp =
    trace.step_up_required || trace.obligations.includes('step_up') || trace.spans.some((s) => s.stage === 'step_up' && s.status === 'passed');
  if (resolution === 'verified') return 'Verified with step-up';
  if (resolution === 'failed') return 'Step-up failed';
  if (resolution === 'approved') return stepUp ? 'Approved by a human with step-up' : 'Approved by a human';
  if (resolution === 'rejected') return 'Rejected by a human';
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
  const reduce = useReducedMotion();
  const tone = outcomeOf(trace).tone;
  return (
    <Card className="relative overflow-hidden p-8 md:p-10">
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-24 h-80 w-80 rounded-full blur-3xl"
        animate={{ background: TONE_COLOR[tone], opacity: 0.13 }}
        initial={{ opacity: 0 }}
        transition={{ duration: 1 }}
      />
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3">
        <motion.span
          className="relative inline-flex rounded-full"
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.1 }}
        >
          <Burst trigger={1} onMount color={TONE_COLOR[tone]} strength={1.5} delay={0.25} />
          <ActionVerdict action={trace} size="lg" />
        </motion.span>
        <span className="ml-auto flex items-center gap-3 text-[13px] text-ink-3">
          <span title={formatDateTime(trace.occurred_at)} className="tabular-nums">
            {formatTime(trace.occurred_at)}
          </span>
          <span aria-hidden="true">-</span>
          <span className="tabular-nums">{formatDuration(trace.latency_ms)} in the Gateway</span>
          <CopyId value={trace.trace_id} />
        </span>
      </div>
      <motion.div
        className="relative mt-7"
        initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
      >
        <Sentence trace={trace} />
      </motion.div>
      <div className="relative mt-7 border-t border-line pt-6">
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
    <Rise className="min-w-0 bg-surface p-6 transition-colors duration-200 hover:bg-hover/60">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
        <Icon name={icon} size={13} />
        {label}
      </p>
      <div className="mt-3 text-[15px] text-ink">{children}</div>
      {sub && <div className="mt-1.5 text-[13px] text-ink-3">{sub}</div>}
    </Rise>
  );
}

function Facts({ trace }: { trace: Trace }) {
  const agents = useAgents();
  const state = agents.data?.find((a) => a.id === trace.agent.id)?.state;
  return (
    <Stagger className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-card sm:grid-cols-2 lg:grid-cols-3" step={0.05} delay={0.3}>
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
    </Stagger>
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

/** How often this exact request was made, and whether policy answered it the same way each time. */
function Repeats({ traceId }: { traceId: string }) {
  const { actions } = useActions();
  const group = useMemo(() => repeatGroups(actions).find((g) => g.decisions.some((d) => d.traceId === traceId)), [actions, traceId]);
  if (!group) return null;
  return (
    <div className={`mt-5 flex flex-wrap items-center gap-3 rounded-2xl px-5 py-4 text-[14px] ${group.consistent ? 'bg-ok-soft text-ok-ink' : 'bg-wait-soft text-wait-ink'}`}>
      <Icon name={group.consistent ? 'equal' : 'git-branch'} size={18} />
      <span className="min-w-0 flex-1 font-medium">
        {group.consistent
          ? `The same agent asked for exactly this ${group.decisions.length} times; policy gave the same answer every time.`
          : `The same agent asked for exactly this ${group.decisions.length} times; the answer changed when the state the controls read changed.`}
      </span>
      <Link to="/determinism" className="font-semibold underline-offset-4 hover:underline">
        Determinism
      </Link>
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-2.5 text-[12px] font-medium text-ink-3">{title}</p>
      {children}
    </div>
  );
}

/** The content checks, signatures, semantic score and cost the Gateway recorded on this trace. */
function GuardrailsPanel({ trace }: { trace: Trace }) {
  const g = trace.guardrails;
  const cost = trace.cost;
  const out = trace.output_filter;
  const semantic = typeof trace.analyzer.score === 'number' ? trace.analyzer : undefined;
  const model = [
    ['model_call', g?.model_call],
    ['model_check', g?.model_check],
  ].filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[1]));
  return (
    <Card className="grid gap-x-10 gap-y-8 p-6 md:grid-cols-2 md:p-7">
      {g && (
        <Part title="Profile">
          <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
            <Code>{g.profile}</Code>
            policy <Code>{g.policy_version}</Code>
            {g.flagged_untrusted && (
              <Chip tone="wait" icon="alert" title="High-impact actions in this session need a person (CTL-PROV-001)">
                Flagged untrusted
              </Chip>
            )}
          </p>
          {(g.redactions?.length || g.recorded?.length) ? (
            <div className="mt-4 space-y-3">
              <MaskedList items={g.redactions ?? []} />
              {g.recorded && g.recorded.length > 0 && (
                <>
                  <p className="text-[12px] text-ink-3">Recorded only, the profile allows them</p>
                  <MaskedList items={g.recorded} />
                </>
              )}
            </div>
          ) : null}
        </Part>
      )}
      {cost && (
        <Part title="Cost">
          <p className="text-[14px] text-ink tabular-nums">
            {formatPriceCents(cost.cents)}
            {cost.tokens > 0 && <>, {formatCount(cost.tokens)} tokens</>}
            {typeof cost.seconds === 'number' && <span className="text-ink-3">, {formatDuration(cost.seconds * 1000)}</span>}
          </p>
          {typeof cost.session_used_cents === 'number' && (
            <p className="mt-1 text-[13px] text-ink-3 tabular-nums">
              Session so far {formatCents(cost.session_used_cents)} EUR
              {typeof cost.session_tokens_used === 'number' && <>, {formatCount(cost.session_tokens_used)} tokens</>}
            </p>
          )}
        </Part>
      )}
      {g?.signatures && (
        <Part title="Threat signatures">
          <SignatureList hits={g.signatures} empty="No known-exploit signature matched." />
        </Part>
      )}
      {semantic && (
        <Part title="Semantic analysis">
          <SemanticDetail analyzer={semantic} rationale={false} />
        </Part>
      )}
      {out && (
        <Part title="Output filter">
          <div className="space-y-3">
            {(out.indirect_injection_suspected || out.withheld.length > 0) && (
              <p className="flex flex-wrap gap-2">
                {out.withheld.length > 0 && (
                  <Chip tone="bad" icon="lock">
                    Withheld: {out.withheld.map(classLabel).join(', ')}
                  </Chip>
                )}
                {out.indirect_injection_suspected && (
                  <Chip tone="wait" icon="alert">
                    Indirect injection suspected
                  </Chip>
                )}
              </p>
            )}
            <MaskedList items={out.redactions} empty="Nothing redacted from the result." />
            {out.recorded.length > 0 && <MaskedList items={out.recorded} />}
            {out.signatures.length > 0 && <SignatureList hits={out.signatures} />}
            {out.semantic && typeof out.semantic.score === 'number' && (
              <p className="text-[13px] text-ink-3">
                Semantic score of the result {out.semantic.score.toFixed(2)}
                {out.semantic.verdict ? `, ${out.semantic.verdict}` : ''}
              </p>
            )}
          </div>
        </Part>
      )}
      {model.length > 0 && (
        <Part title="Model">
          <div className="space-y-3">
            {model.map(([key, value]) => (
              <RawTable key={key} entries={Object.entries(value)} prefix={`${key}.`} />
            ))}
          </div>
        </Part>
      )}
    </Card>
  );
}

const hasGuardrails = (trace: Trace) => Boolean(trace.guardrails || trace.cost || trace.output_filter || typeof trace.analyzer.score === 'number');

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
  const [replay, setReplay] = useState(0);
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
      <div className="mt-16 space-y-16">
        <Section title="Deterministic first, AI second" hint="Why a model never decides this on its own">
          <Card className="p-6 md:p-7">
            <Composition trace={data} />
            <Repeats traceId={data.trace_id} />
          </Card>
        </Section>
        {rail && (
          <Section
            title="How the Gateway decided"
            hint="Open any step to see what it checked"
            action={
              <button
                type="button"
                onClick={() => setReplay((n) => n + 1)}
                className="press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              >
                <Icon name="play" size={12} />
                Replay
              </button>
            }
          >
            <Card className="p-4 md:p-6">
              <DecisionPath key={replay} rail={rail} controls={controls} />
            </Card>
          </Section>
        )}
        {hasGuardrails(data) && (
          <Section title="Guardrails" hint="Content checks, signatures and cost" action={<TextLink to="/guardrails">Configuration</TextLink>}>
            <GuardrailsPanel trace={data} />
          </Section>
        )}
        <Section title="Deeper detail">
          <div className="space-y-3">
            <AgentMessage traceId={data.trace_id} />
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
