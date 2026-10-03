import { useAgentMessages, useAgents, useReleaseAgent, useTraces, useUseCases } from '@betsee/api';
import { CapabilityIntersection, DecisionChip, Icon, IdToken, LifecycleBadge, TierBadge } from '@betsee/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AgentMark, HumanAvatar } from '../components/marks.tsx';
import { ReasonText } from '../components/reason.tsx';
import { ECOSYSTEM_URL } from '../components/shell.tsx';
import { EmptyState, ErrorCard, Skeleton } from '../components/states.tsx';
import { resolutionOf } from '../domain/decision.ts';
import { teamName } from '../domain/feed.ts';
import { formatCents, formatDateTime, formatTime } from '../domain/format.ts';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line-subtle pt-4">
      <h3 className="text-md font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function AgentDetail({ agentId }: { agentId: string }) {
  const agents = useAgents();
  const useCases = useUseCases();
  const traces = useTraces();
  const messages = useAgentMessages();
  const release = useReleaseAgent();
  const agent = agents.data?.find((a) => a.id === agentId);
  const session = agent?.current_session ?? null;
  const useCase = useCases.data?.find((u) => u.id === session?.use_case.id);
  const recent = useMemo(() => (traces.data ?? []).filter((t) => t.agent.id === agentId).slice(0, 8), [traces.data, agentId]);
  const traffic = useMemo(
    () => (messages.data ?? []).filter((m) => m.sender.id === agentId || m.receiver.id === agentId).slice(0, 6),
    [messages.data, agentId],
  );

  if (agents.isPending) return <Skeleton className="h-96" />;
  if (agents.isError) return <ErrorCard title="Could not load the agent" error={agents.error} onRetry={() => void agents.refetch()} />;
  if (!agent) return <EmptyState icon="streamline-flex:ai-chip-robot" title="Agent not found" body={`No agent ${agentId} is registered.`} />;

  const qualifiers: Record<string, string> = {};
  for (const capability of useCase?.approval_required ?? []) qualifiers[capability] = 'approval';
  for (const capability of useCase?.step_up_required ?? []) {
    qualifiers[capability] = qualifiers[capability] ? 'approval + step-up' : 'step-up';
  }
  if (useCase && useCase.approval_threshold_cents > 0) {
    for (const capability of Object.keys(qualifiers)) {
      if (capability.startsWith('payments.')) qualifiers[capability] = `above ${formatCents(useCase.approval_threshold_cents)} EUR: ${qualifiers[capability]}`;
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-3">
        <AgentMark state={agent.state} />
        <div className="min-w-0">
          <h2 className="truncate font-mono text-lg font-medium">{agent.id}</h2>
          <p className="text-xs text-fg-secondary">
            {teamName(agent.team)} - {agent.provider} <span className="font-mono">{agent.model}</span>
          </p>
        </div>
        <LifecycleBadge state={agent.state} className="ml-auto" />
      </header>

      {agent.state !== 'active' && (
        <div className="space-y-3 rounded-md border border-quarantined-border bg-quarantined-bg p-3">
          <p className="text-sm text-quarantined-fg">
            {agent.state === 'quarantined' ? 'Quarantined' : 'Suspended'} {agent.state_changed_at ? formatTime(agent.state_changed_at) : ''}
            {agent.state_reason && (
              <>
                {' - '}
                <ReasonText text={agent.state_reason} />
              </>
            )}
          </p>
          <p className="text-xs text-fg-secondary">Every action this agent attempts is denied until a security officer releases it.</p>
          <button
            type="button"
            disabled={release.isPending}
            onClick={() => release.mutate(agent.id)}
            className="h-9 rounded-md border border-line-strong px-4 text-sm font-semibold hover:bg-surface-2"
          >
            {release.isPending ? 'Releasing' : 'Release agent'}
          </button>
          {release.isError && <p className="text-xs text-danger">{release.error.message}</p>}
        </div>
      )}

      <Section title="Identity">
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-fg-secondary">Principal</dt>
          <dd>
            <IdToken id={agent.id} />
          </dd>
          <dt className="text-fg-secondary">Credential</dt>
          <dd>Its own Keycloak client, client credentials</dd>
          <dt className="text-fg-secondary">Owning team</dt>
          <dd>{teamName(agent.team)}</dd>
        </dl>
        <a href={`${ECOSYSTEM_URL}/identity/agents/${encodeURIComponent(agent.id)}`} className="inline-flex items-center gap-1.5 text-sm text-accent-text hover:underline">
          Edit delegation in Identity
          <Icon name="streamline-flex:arrow-expand" size={12} />
        </a>
      </Section>

      <Section title="Current session">
        {session ? (
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-fg-secondary">Launched by</dt>
            <dd className="flex items-center gap-2">
              <HumanAvatar name={session.human.display_name} size="xs" />
              {session.human.display_name}
            </dd>
            <dt className="text-fg-secondary">Use case</dt>
            <dd>{session.use_case.name}</dd>
            <dt className="text-fg-secondary">Tier ceiling</dt>
            <dd>
              <TierBadge tier={session.tier_ceiling} />
            </dd>
            <dt className="text-fg-secondary">Budget</dt>
            <dd className="tabular-nums">
              {formatCents(session.budget.used)} / {formatCents(session.budget.limit)} EUR
            </dd>
            <dt className="text-fg-secondary">Started</dt>
            <dd>{formatDateTime(session.started_at)}</dd>
          </dl>
        ) : (
          <p className="text-sm text-fg-tertiary">No active session</p>
        )}
      </Section>

      {session && (
        <Section title="Capabilities">
          <CapabilityIntersection delegated={session.delegated} permitted={useCase?.permitted ?? session.effective} useCase={session.use_case.name} qualifiers={qualifiers} />
        </Section>
      )}

      <Section title="Recent actions">
        {recent.length === 0 && <p className="text-sm text-fg-tertiary">No actions yet</p>}
        <ul className="space-y-1">
          {recent.map((action) => (
            <li key={action.trace_id}>
              <Link to={`/traces/${encodeURIComponent(action.trace_id)}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                <span className="font-mono text-2xs text-fg-tertiary">{formatTime(action.occurred_at)}</span>
                <span className="font-mono">{action.capability}</span>
                <span className="min-w-0 truncate text-fg-secondary">{action.resource.id}</span>
                <span className="ml-auto">
                  <DecisionChip decision={action.decision} resolution={resolutionOf(action)} aiTightened={action.ai_tightened} modelLabel={action.analyzer.model_label} size="sm" variant="compact" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {traffic.length > 0 && (
        <Section title="Agent messages">
          <ul className="space-y-1">
            {traffic.map((m) => (
              <li key={m.id}>
                <Link to={`/traces/${encodeURIComponent(m.trace_id)}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                  <span className="font-mono text-xs">{m.sender.id}</span>
                  <Icon name="streamline:interface-arrows-button-right-arrow-right-keyboard" size={12} className="text-fg-tertiary" />
                  <span className="font-mono text-xs">{m.receiver.id}</span>
                  <span className="ml-auto">
                    <DecisionChip decision={m.decision} size="sm" variant="compact" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Slides over the feed from the right (contract 8.2); Esc or the close button returns to Live. */
export function AgentDrawer() {
  const { agentId } = useParams();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate('/');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <AnimatePresence>
      {agentId && (
        <motion.aside
          key={agentId}
          aria-label={`Agent ${agentId}`}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
          transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
          className="fixed bottom-3 right-3 top-[calc(var(--bs-layout-dir-topbar)+12px)] z-(--bs-z-modal) w-(--bs-layout-dir-drawer) max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line-subtle bg-surface-1 p-5 shadow-e3"
        >
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Close agent"
            title="Close"
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-sm text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
          >
            <Icon name="streamline:delete-1" size={14} />
          </button>
          <div className="pt-6">
            <AgentDetail agentId={agentId} />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
