import { api, unwrap, useAgents, useControls, useSessions, useUseCases, type Agent, type UseCase } from '@betsee/api';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon, type IconName } from '../components/icon.tsx';
import { Rise, Stagger } from '../components/motion.tsx';
import {
  AgentGlyph,
  Avatar,
  Card,
  Code,
  controlHref,
  EASE,
  ECOSYSTEM_URL,
  EmptyState,
  ErrorCard,
  PageHeader,
  policyHref,
  Segmented,
  Skeleton,
  StatePill,
  TextLink,
  TierText,
} from '../components/ui.tsx';
import { principalIds } from '../domain/chats.ts';
import { capabilityRules, delegationOf } from '../domain/configuration.ts';
import { teamName } from '../domain/feed.ts';
import { formatCents } from '../domain/format.ts';
import { PEOPLE, personById, personByName } from '../domain/people.ts';
import { useActions } from '../hooks.ts';

type Tab = 'permissions' | 'agents' | 'people' | 'policies';
const TABS: { value: Tab; label: string }[] = [
  { value: 'permissions', label: 'Permissions' },
  { value: 'agents', label: 'Agents' },
  { value: 'people', label: 'People' },
  { value: 'policies', label: 'Policies' },
];

function Qualifier({ tone, icon, label }: { tone: 'wait' | 'verify'; icon: IconName; label: string }) {
  return (
    <span title={label} className={`inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold ${tone === 'wait' ? 'bg-wait-soft text-wait-ink' : 'bg-verify-soft text-verify-ink'}`}>
      <Icon name={icon} size={10} />
      {tone === 'wait' ? 'Approval' : 'Step-up'}
    </span>
  );
}

function Capability({ capability, approval = false, stepUp = false, muted = false }: { capability: string; approval?: boolean; stepUp?: boolean; muted?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-xl border px-2 py-1 ${muted ? 'border-dashed border-line-strong text-ink-3 line-through decoration-ink-4' : 'border-line bg-surface text-ink-2'}`}>
      <span className="font-mono text-[12px]">{capability}</span>
      {approval && <Qualifier tone="wait" icon="hourglass" label="Needs a person's approval" />}
      {stepUp && <Qualifier tone="verify" icon="fingerprint" label="Needs step-up verification" />}
    </span>
  );
}

function Meta({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-3">
      <Icon name={icon} size={13} />
      {children}
    </span>
  );
}

/** What each use case lets an agent do, with the human checks on top: the permission model. */
function Permissions({ useCases }: { useCases: UseCase[] }) {
  if (!useCases.length) return <EmptyState icon="layers" title="No use cases" body="The Gateway has no use cases configured." />;
  return (
    <Stagger className="grid gap-5 lg:grid-cols-2" step={0.05}>
      {useCases.map((u) => (
        <Rise key={u.id}>
          <Card className="h-full p-6">
            <div className="flex flex-wrap items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-bold tracking-[-0.015em] text-ink">{u.name}</span>
                <Code className="mt-1">{u.id}</Code>
              </span>
              <TextLink href={`${ECOSYSTEM_URL}/policy-studio/use-cases/${encodeURIComponent(u.id)}`}>Edit</TextLink>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              <TierText tier={u.tier_ceiling} />
              <Meta icon="gauge">Budget {formatCents(u.budget.limit)} EUR</Meta>
              {u.approval_threshold_cents > 0 && <Meta icon="hourglass">Approval above {formatCents(u.approval_threshold_cents)} EUR</Meta>}
            </div>
            <p className="mt-5 mb-2 text-[12px] font-bold tracking-[0.06em] text-ink-3 uppercase">Permits</p>
            <div className="flex flex-wrap gap-2">
              {capabilityRules(u).map((r) => (
                <Capability key={r.capability} capability={r.capability} approval={r.approval} stepUp={r.stepUp} />
              ))}
            </div>
            {u.agent_ids.length > 0 && (
              <>
                <p className="mt-5 mb-2 text-[12px] font-bold tracking-[0.06em] text-ink-3 uppercase">Agents</p>
                <div className="flex flex-wrap gap-2">
                  {u.agent_ids.map((id) => (
                    <Link key={id} to={`/agents/${encodeURIComponent(id)}`} className="press inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
                      <AgentGlyph size={24} agentId={id} />
                      {id}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Card>
        </Rise>
      ))}
    </Stagger>
  );
}

/** Every agent with what its current session delegates, and what the use case lets through. */
function Agents({ agents }: { agents: Agent[] }) {
  if (!agents.length) return <EmptyState icon="bot" title="No agents" body="The Gateway has no agents registered." />;
  return (
    <Card className="divide-y divide-line/70">
      {agents.map((agent, i) => {
        const session = agent.current_session;
        const delegation = session ? delegationOf(session) : null;
        return (
          <motion.div key={agent.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE, delay: i * 0.03 }} className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] md:items-center">
            <Link to={`/agents/${encodeURIComponent(agent.id)}`} className="group flex min-w-0 items-center gap-3">
              <AgentGlyph state={agent.state} size={44} agentId={agent.id} />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold text-ink group-hover:text-accent-ink">{agent.id}</span>
                  {agent.state !== 'active' && <StatePill state={agent.state} />}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                  {[teamName(agent.team), agent.model].filter(Boolean).join(', ')}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                  {session ? `${session.human.display_name}, ${session.use_case.name}` : 'No session'}
                </span>
              </span>
            </Link>
            <div className="flex flex-wrap gap-2">
              {delegation ? (
                <>
                  {delegation.effective.map((c) => (
                    <Capability key={c} capability={c} />
                  ))}
                  {delegation.blocked.map((c) => (
                    <span key={c} title="Delegated, but the use case does not permit it: the Gateway denies it (CTL-CAP-001).">
                      <Capability capability={c} muted />
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-[13px] text-ink-3">Nothing delegated without a session.</span>
              )}
            </div>
            <span className="flex items-center gap-4 md:justify-end">
              <Meta icon="gauge">{formatCents(agent.budget.limit)} EUR</Meta>
              <TextLink href={`${ECOSYSTEM_URL}/identity/agents/${encodeURIComponent(agent.id)}`}>Delegation</TextLink>
            </span>
          </motion.div>
        );
      })}
    </Card>
  );
}

/** The directory with who is a Gateway principal, read from the data, and what they run. */
function People({ principals, launched }: { principals: Set<string>; launched: Map<string, number> }) {
  const departments = [...new Set(PEOPLE.map((p) => p.department))];
  return (
    <Stagger className="space-y-8" step={0.05}>
      {departments.map((department) => (
        <Rise key={department}>
          <p className="mb-3 text-[12px] font-bold tracking-[0.06em] text-ink-3 uppercase">{department}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PEOPLE.filter((p) => p.department === department).map((person) => {
              const principal = principals.has(person.id);
              const manager = person.manager ? personById(person.manager) : undefined;
              const runs = launched.get(person.id) ?? 0;
              return (
                <Link key={person.id} to={`/agents?person=${person.id}`} className="group hover-lift flex items-center gap-3 rounded-[18px] border border-line bg-surface p-4 shadow-card">
                  <span className="relative shrink-0">
                    <Avatar name={person.name} size={48} />
                    {principal && (
                      <span title="Signs in to Betsee" className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white ring-2 ring-surface">
                        <Icon name="key" size={10} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">{person.name}</span>
                    <span className="block truncate text-[13px] text-ink-3">{person.title}</span>
                    <span className="mt-1 block truncate text-[12.5px] text-ink-3">
                      {principal ? (runs ? `Runs ${runs} ${runs === 1 ? 'agent' : 'agents'}` : 'Principal, no agent running') : 'Directory only'}
                      {manager ? `, reports to ${manager.name}` : ''}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </Rise>
      ))}
    </Stagger>
  );
}

/** A policy's effect, read from the Cedar naming the Gateway uses ("permit-...", "forbid-..."). */
const effectOf = (id: string) => (id.startsWith('permit') ? 'permit' : id.startsWith('forbid') ? 'forbid' : 'other');

/** Cedar policies grouped by the control they implement, each linking to Policy Studio. */
function Policies() {
  const policies = useQuery({ queryKey: ['policies'], queryFn: async () => (await unwrap(api.GET('/api/v1/policies'))).items, staleTime: 5 * 60_000 });
  const controls = useControls();
  const groups = useMemo(() => {
    const byControl = new Map<string, string[]>();
    for (const policy of policies.data ?? []) {
      const control = policy.control_ids[0] ?? 'Unattached';
      byControl.set(control, [...(byControl.get(control) ?? []), policy.id]);
    }
    return [...byControl].sort(([a], [b]) => a.localeCompare(b));
  }, [policies.data]);
  const nameOf = useMemo(() => new Map((controls.data ?? []).map((c) => [c.id, c.name])), [controls.data]);
  if (policies.isPending) return <Skeleton className="h-96" />;
  if (policies.isError) return <ErrorCard title="Could not load policies" error={policies.error} onRetry={() => void policies.refetch()} />;
  if (!policies.data.length) return <EmptyState icon="scale" title="No policies" body="The Gateway has no Cedar policies loaded." />;
  return (
    <Stagger className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" step={0.03}>
      {groups.map(([control, ids]) => (
        <Rise key={control}>
          <Card className="h-full p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
                <Icon name="scale" size={16} />
              </span>
              <span className="min-w-0">
                {control === 'Unattached' ? <span className="text-[14px] font-semibold text-ink-2">No control</span> : <Code href={controlHref(control)}>{control}</Code>}
                {nameOf.get(control) && <span className="mt-1 block text-[14px] font-semibold text-ink">{nameOf.get(control)}</span>}
              </span>
            </div>
            <ul className="mt-4 space-y-1.5">
              {ids.map((id) => {
                const effect = effectOf(id);
                return (
                  <li key={id} className="flex min-w-0 items-center gap-2">
                    <span title={effect} className={`h-1.5 w-1.5 shrink-0 rounded-full ${effect === 'permit' ? 'bg-ok' : effect === 'forbid' ? 'bg-bad' : 'bg-ink-4'}`} />
                    <Code href={policyHref(id)} className="min-w-0 truncate">
                      {id}
                    </Code>
                  </li>
                );
              })}
            </ul>
          </Card>
        </Rise>
      ))}
    </Stagger>
  );
}

/**
 * The Gateway's configuration, read-only: the Gateway has no write API for use cases, delegations,
 * people or policies, so every edit links to the ecosystem's Policy Studio or Identity.
 */
export function ConfigurationPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.value === params.get('tab'))?.value ?? 'permissions';
  const setTab = (next: Tab) => setParams(next === 'permissions' ? {} : { tab: next }, { replace: true });
  const useCases = useUseCases();
  const agents = useAgents();
  const sessions = useSessions();
  const { actions } = useActions();
  const principals = useMemo(() => principalIds(sessions.data ?? [], actions, agents.data ?? []), [sessions.data, actions, agents.data]);
  const launched = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of sessions.data ?? []) {
      const person = s.status === 'active' ? personByName(s.human.display_name) : undefined;
      if (person) out.set(person.id, (out.get(person.id) ?? 0) + 1);
    }
    return out;
  }, [sessions.data]);

  const pending = tab === 'permissions' ? useCases.isPending : tab === 'agents' ? agents.isPending : false;
  const failed = tab === 'permissions' ? useCases : tab === 'agents' ? agents : null;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Configuration' }]}
        title="Configuration"
        actions={<Segmented label="Configuration" value={tab} onChange={setTab} options={TABS} />}
      />
      <p className="mb-8 text-[14px] text-ink-3">
        <Icon name="lock" size={14} className="mr-2 inline align-[-2px]" />
        Read-only. The Gateway has no write API for this configuration; changes are made in{' '}
        <a href={`${ECOSYSTEM_URL}/policy-studio`} className="font-semibold text-accent-ink hover:text-accent">
          Policy Studio
        </a>{' '}
        and{' '}
        <a href={`${ECOSYSTEM_URL}/identity`} className="font-semibold text-accent-ink hover:text-accent">
          Identity
        </a>
        .
      </p>
      {pending ? (
        <Skeleton className="h-96" />
      ) : failed?.isError ? (
        <ErrorCard title="Could not load the configuration" error={failed.error} onRetry={() => void failed.refetch()} />
      ) : tab === 'permissions' ? (
        <Permissions useCases={useCases.data ?? []} />
      ) : tab === 'agents' ? (
        <Agents agents={agents.data ?? []} />
      ) : tab === 'people' ? (
        <People principals={principals} launched={launched} />
      ) : (
        <Policies />
      )}
    </div>
  );
}
