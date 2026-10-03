import { useAgentMessages, useAgents, useReleaseAgent, useUseCases, type AgentSession, type UseCase } from '@betsee/api';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { ActivityList } from '../components/activity.tsx';
import { Icon } from '../components/icon.tsx';
import { ReasonText } from '../components/reason.tsx';
import {
  AgentGlyph,
  Avatar,
  Button,
  Card,
  Code,
  Disclosure,
  EASE,
  ECOSYSTEM_URL,
  EmptyState,
  ErrorCard,
  KeyValues,
  Meter,
  OutcomePill,
  outcomeOf,
  PageHeader,
  Section,
  Skeleton,
  StatePill,
  TextLink,
  TierText,
} from '../components/ui.tsx';
import { isObservation } from '../domain/decision.ts';
import { teamName } from '../domain/feed.ts';
import { formatCents, formatCount, formatDateTime, formatTime } from '../domain/format.ts';
import { useActions } from '../hooks.ts';
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
      <Icon name="check" size={13} strokeWidth={2.25} />
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
  const denied = decided.filter((a) => a.decision === 'deny').length;
  const budgetRatio = agent.budget.limit > 0 ? agent.budget.used / agent.budget.limit : 0;

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: 'Overview', to: '/' },
          { label: 'Agents', to: '/agents' },
          { label: teamName(agent.team), to: `/agents?team=${encodeURIComponent(agent.team)}` },
          { label: agent.id },
        ]}
        title={
          <span className="flex items-center gap-4">
            <AgentGlyph state={agent.state} size={52} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-3">
                <span className="truncate">{agent.id}</span>
                <StatePill state={agent.state} />
              </span>
              <span className="mt-1 block text-[14px] font-normal tracking-normal text-ink-3">
                {teamName(agent.team)} team - {agent.provider} <span className="font-mono text-[13px]">{agent.model}</span>
              </span>
            </span>
          </span>
        }
        actions={<TextLink href={`${ECOSYSTEM_URL}/identity/agents/${encodeURIComponent(agent.id)}`}>Edit delegation</TextLink>}
      />

      <AnimatePresence>
        {agent.state !== 'active' && <ReleaseBanner agentId={agent.id} state={agent.state} reason={agent.state_reason} at={agent.state_changed_at} />}
      </AnimatePresence>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-6">
          <p className="text-[13px] font-medium text-ink-2">Actions recorded</p>
          <p className="mt-3 text-[32px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{formatCount(decided.length)}</p>
          <p className="mt-2 text-[13px] text-ink-3">In the live feed</p>
        </Card>
        <Card className="p-6">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
            {denied > 0 && <span className="h-1.5 w-1.5 rounded-full bg-bad" />}
            Denied
          </p>
          <p className="mt-3 text-[32px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{formatCount(denied)}</p>
          <p className="mt-2 text-[13px] text-ink-3">Stopped before execution</p>
        </Card>
        <Card className="p-6">
          <p className="text-[13px] font-medium text-ink-2">Budget used</p>
          <p className="mt-3 text-[32px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{Math.round(budgetRatio * 100)}%</p>
          <Meter ratio={budgetRatio} label="Budget used" className="mt-3" />
          <p className="mt-2 text-[13px] text-ink-3 tabular-nums">
            {formatCents(agent.budget.used)} of {formatCents(agent.budget.limit)} {BUDGET_CURRENCY}
          </p>
        </Card>
      </div>

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
                        <OutcomePill size="sm" outcome={outcomeOf({ decision: m.decision, approval_state: 'none', capability: m.capability, agent: m.sender })} />
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
