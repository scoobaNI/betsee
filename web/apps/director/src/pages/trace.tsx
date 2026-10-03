import { ApiRequestError, useAgentMessages, useControls, useTrace, type Control, type Trace } from '@betsee/api';
import { DecisionChip, Icon, IdToken, TierBadge } from '@betsee/ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { chipHistory } from '../components/feed.tsx';
import { AgentMark, HumanAvatar } from '../components/marks.tsx';
import { CompositionPanel, PipelineRail, SpanDetail, Waterfall } from '../components/pipeline.tsx';
import { ReasonText } from '../components/reason.tsx';
import { ECOSYSTEM_URL } from '../components/shell.tsx';
import { EmptyState, ErrorCard, Skeleton } from '../components/states.tsx';
import { becauseSentence, decisionLabel, resolutionOf } from '../domain/decision.ts';
import { formatDateTime, formatTime } from '../domain/format.ts';
import { teamName } from '../domain/feed.ts';
import { buildRail, decidingStage, formatDuration, type RailStage } from '../domain/pipeline.ts';

function verdictWords(trace: Trace): string {
  const resolution = resolutionOf(trace);
  if (resolution) return `${decisionLabel[trace.decision]}, then ${resolution}`;
  return decisionLabel[trace.decision];
}

function DecisionSentence({ trace }: { trace: Trace }) {
  const policy = trace.policy_ids[0];
  return (
    <p className="font-display text-xl leading-snug">
      <span className="font-semibold">{trace.human.display_name}</span>, through{' '}
      <span className="font-mono text-lg">{trace.agent.id}</span>, for {trace.use_case.name}, asked for{' '}
      <span className="font-mono text-lg">{trace.capability}</span> on {trace.resource.type} {trace.resource.id} ({trace.resource.tier}).{' '}
      <span className="font-semibold">{verdictWords(trace)}</span>
      {policy ? (
        <>
          {' '}
          by policy <span className="font-mono text-lg">{policy}</span>.
        </>
      ) : (
        '.'
      )}
    </p>
  );
}

function Cell({ label, icon, children }: { label: string; icon: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line-subtle bg-surface-1 p-4 shadow-e1">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg-secondary">
        <Icon name={icon} size={14} />
        {label}
      </p>
      {children}
    </div>
  );
}

function SevenQuestions({ trace, controls }: { trace: Trace; controls: Map<string, Control> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <Cell label="Who initiated" icon="streamline-flex:user-circle-single">
          <p className="flex items-center gap-2 text-md">
            <HumanAvatar name={trace.human.display_name} />
            <span className="truncate">{trace.human.display_name}</span>
          </p>
        </Cell>
        <Cell label="Which agent" icon="streamline-flex:ai-chip-robot">
          <Link to={`/agents/${encodeURIComponent(trace.agent.id)}`} className="flex items-center gap-2 hover:text-accent-text">
            <AgentMark size="sm" />
            <span className="truncate font-mono text-sm font-medium">{trace.agent.id}</span>
          </Link>
          <p className="mt-1 text-xs text-fg-secondary">{teamName(trace.agent.team)}</p>
        </Cell>
        <Cell label="Why (use case)" icon="streamline-flex:target">
          <p className="text-md">{trace.use_case.name}</p>
          <p className="mt-1 text-xs text-fg-secondary">
            Session <span className="font-mono">{trace.session_id}</span>
          </p>
        </Cell>
        <Cell label="What capability" icon="streamline-flex:tag">
          <IdToken copy={false}>{trace.capability}</IdToken>
          {trace.tool && (
            <p className="mt-1.5 text-xs text-fg-secondary">
              via <span className="font-mono">{trace.tool.name}</span> on {trace.tool.connector}
            </p>
          )}
        </Cell>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Cell label="What resource" icon="streamline-flex:layers-1">
          <p className="break-all font-mono text-sm">
            {trace.resource.type}:{trace.resource.id}
          </p>
          <TierBadge tier={trace.resource.tier} className="mt-1.5" />
        </Cell>
        <Cell label="Which policy and controls" icon="streamline-flex:justice-scale-1">
          <div className="flex flex-wrap gap-1.5">
            {trace.policy_ids.map((id) => (
              <IdToken key={id} id={id} href={`${ECOSYSTEM_URL}/policy-studio/policies/${encodeURIComponent(id)}`} />
            ))}
            {trace.control_ids.map((id) => (
              <IdToken key={id} id={id} href={`${ECOSYSTEM_URL}/policy-studio/controls/${encodeURIComponent(id)}`} />
            ))}
            {!trace.policy_ids.length && !trace.control_ids.length && <span className="text-sm text-fg-tertiary">None recorded</span>}
          </div>
        </Cell>
        <Cell label="What decision" icon="streamline-flex:arrow-roadmap">
          <DecisionChip
            decision={trace.decision}
            resolution={resolutionOf(trace)}
            aiTightened={trace.ai_tightened}
            modelLabel={trace.analyzer.model_label}
            controlIds={trace.control_ids}
            history={chipHistory(trace)}
          />
          <p className="mt-2 text-sm text-fg-secondary">
            <ReasonText text={becauseSentence(trace, (id) => controls.get(id)?.name)} />
          </p>
          <p className="mt-1 text-xs text-fg-tertiary">{trace.executed ? 'Executed by the connector.' : 'Not executed.'}</p>
        </Cell>
      </div>
    </div>
  );
}

function AgentMessageBlock({ traceId }: { traceId: string }) {
  const messages = useAgentMessages();
  const message = messages.data?.find((m) => m.trace_id === traceId);
  if (!message) return null;
  return (
    <section aria-label="Agent message" className="rounded-lg border border-line-subtle bg-surface-1 p-5 shadow-e1">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Icon name="streamline-flex:chat-bubble-text-square" size={16} />
        Mediated agent message
      </h3>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <IdToken copy={false}>{message.sender.id}</IdToken>
        <Icon name="streamline:interface-arrows-button-right-arrow-right-keyboard" size={12} className="text-fg-tertiary" />
        <IdToken copy={false}>{message.receiver.id}</IdToken>
        <span className="text-fg-secondary">for {message.use_case.name}, asking</span>
        <IdToken copy={false}>{message.capability}</IdToken>
      </p>
      <p className="mt-3 text-sm text-fg-secondary">
        {message.content ? `Delivered content: ${message.content}` : 'Blocked content is never delivered to the receiver.'}
      </p>
      <dl className="mt-3 grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-1.5 rounded-sm bg-surface-inset p-3 font-mono text-xs">
        {Object.entries(message.provenance).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-fg-tertiary">provenance.{key}</dt>
            <dd className="break-all">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ExecutionContext({ context }: { context: Trace['execution_context'] }) {
  const entries = Object.entries(context ?? {});
  if (!entries.length) return null;
  return (
    <details className="rounded-lg border border-line-subtle bg-surface-1 p-5 shadow-e1">
      <summary className="cursor-pointer text-md font-semibold">Execution context as the Gateway resolved it</summary>
      <dl className="mt-3 grid grid-cols-[minmax(140px,auto)_1fr] gap-x-4 gap-y-1.5 rounded-sm bg-surface-inset p-3 font-mono text-xs">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-fg-tertiary">{key}</dt>
            <dd className="break-all">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function TraceSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-16" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-28" />
      <Skeleton className="h-72" />
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
      trace.data
        ? buildRail(trace.data.spans, trace.data.decision, trace.data.step_up_required || trace.data.obligations.includes('step_up'))
        : undefined,
    [trace.data],
  );
  const [selected, setSelected] = useState<RailStage['id'] | undefined>();

  useEffect(() => {
    setSelected(undefined);
  }, [traceId]);

  useEffect(() => {
    if (rail && !selected) setSelected(decidingStage(rail)?.id ?? 'decision');
  }, [rail, selected]);

  useEffect(() => {
    document.title = `Trace ${traceId?.slice(0, 8) ?? ''} - Director - Betsee`;
    return () => {
      document.title = 'Live - Director - Betsee';
    };
  }, [traceId]);

  if (trace.isPending) return <TraceSkeleton />;
  if (trace.isError) {
    if (trace.error instanceof ApiRequestError && trace.error.status === 404) {
      return (
        <div className="rounded-lg border border-line-subtle bg-surface-1">
          <EmptyState icon="streamline-flex:hierarchy-2" title="Trace not found" body="The Gateway has no trace with this id.">
            <Link to="/" className="text-sm text-accent-text hover:underline">
              Back to Live
            </Link>
          </EmptyState>
        </div>
      );
    }
    return <ErrorCard title="Could not load the trace" error={trace.error} onRetry={() => void trace.refetch()} />;
  }

  const data = trace.data;
  const stage = rail?.stages.find((s) => s.id === selected);
  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-2 text-xs text-fg-secondary">
        <Link to="/" className="hover:text-fg-primary">
          Live
        </Link>
        <Icon name="streamline:interface-arrows-button-right-arrow-right-keyboard" size={12} />
        <span>Trace</span>
        <IdToken id={data.trace_id} />
        <span className="ml-auto" title={formatDateTime(data.occurred_at)}>
          {formatTime(data.occurred_at)} - {formatDuration(data.latency_ms)} in the Gateway
        </span>
      </nav>
      <DecisionSentence trace={data} />
      <SevenQuestions trace={data} controls={controls} />
      {rail && <PipelineRail rail={rail} selected={selected} onSelect={setSelected} />}
      {rail && <Waterfall rail={rail} selected={selected} onSelect={setSelected} />}
      <div className="grid grid-cols-2 items-start gap-4">
        <CompositionPanel trace={data} />
        <SpanDetail stage={stage} controls={controls} />
      </div>
      <AgentMessageBlock traceId={data.trace_id} />
      <ExecutionContext context={data.execution_context} />
    </div>
  );
}
