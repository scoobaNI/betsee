import { useParams, Link } from "react-router";
import {
  BudgetGauge,
  CapabilityIntersection,
  Icon,
  IdToken,
  LifecycleBadge,
  MockBadge,
  TierBadge,
} from "@betsee/ui";
import {
  useEcosystemAgents,
  useUseCases,
} from "@betsee/api/resources/ecosystem";
import { useTraces } from "@betsee/api";
import { useMemo } from "react";
import { PageHeader, Tabs } from "../layout";
import { ResourceState } from "../resource-state";
import { centsLabel } from "../money";

const tabs = ["agents", "humans", "teams"].map((section) => ({
  href: `/identity/${section}`,
  label: section[0].toUpperCase() + section.slice(1),
}));
const teamName = (team: string) =>
  team ? team[0].toUpperCase() + team.slice(1) : team;
export function Identity() {
  const { section, id } = useParams();
  const agents = useEcosystemAgents();
  const cases = useUseCases();
  const selected = agents.data?.find((a) => a.id === id) ?? agents.data?.[0];
  const useCase = cases.data?.find(
    (c) => c.id === selected?.current_session?.use_case.id,
  );
  const humans = [
    ...new Map(
      agents.data?.flatMap((a) =>
        a.current_session
          ? [[a.current_session.human.sub, a.current_session.human] as const]
          : [],
      ),
    ).values(),
  ];
  const teams = [...new Set(agents.data?.map((a) => a.team))];
  const traces = useTraces();
  const recent = useMemo(() => {
    const cutoff = Date.now() - 15 * 60_000;
    return (traces.data ?? []).filter(
      (trace) =>
        trace.agent.id === selected?.id &&
        Date.parse(trace.occurred_at) > cutoff &&
        !(trace as { record_type?: string }).record_type,
    );
  }, [traces.data, selected?.id]);
  const sessionsOf = (sub: string) =>
    agents.data?.filter((a) => a.current_session?.human.sub === sub).length ??
    0;
  return (
    <>
      <PageHeader
        product="Identity"
        icon="streamline-flex:user-identifier-card"
        title={
          section === "humans"
            ? "Humans in active sessions"
            : section === "teams"
              ? "Agent teams"
              : "Agent principals"
        }
        purpose="Every agent is a principal with its own identity."
      />
      <Tabs items={tabs} />
      <ResourceState
        query={agents}
        noun="agents"
        empty={!agents.data?.length}
        emptyTitle="No agents registered"
        emptyHint="Run scripts/bootstrap."
      >
        {section === "agents" ? (
          <div className="eco-detail">
            <div className="space-y-2">
              {agents.data?.map((agent) => (
                <Link
                  key={agent.id}
                  to={`/identity/agents/${encodeURIComponent(agent.id)}`}
                  className={`block rounded-lg p-4 ${selected?.id === agent.id ? "bg-surface-2 shadow-selected" : "bg-surface-1 shadow-e1 hover:bg-surface-2"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-3">
                      <span className="rounded-sm bg-surface-3 p-2 text-accent-text">
                        <Icon name="streamline-flex:ai-chip-robot" />
                      </span>
                      <span className="font-mono text-sm">{agent.id}</span>
                    </span>
                    <LifecycleBadge state={agent.state} />
                  </div>
                  <p className="ml-11 mt-2 text-sm text-fg-secondary">
                    {teamName(agent.team)} · {agent.provider}
                  </p>
                  <div className="ml-11 mt-3 flex flex-wrap gap-1">
                    {agent.current_session?.effective.slice(0, 4).map((c) => (
                      <IdToken key={c} copy={false}>
                        {c}
                      </IdToken>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
            {selected && (
              <article className="eco-detail-panel space-y-3">
                <section className="rounded-lg bg-surface-2 p-5 shadow-e1">
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded-md bg-surface-3 text-accent-text">
                      <Icon name="streamline-flex:ai-chip-robot" size={28} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-mono text-xl font-medium">
                        {selected.id}
                      </h2>
                      <p className="mt-1 text-sm text-fg-secondary">
                        {teamName(selected.team)} · {selected.provider} ·{" "}
                        {selected.model}
                      </p>
                    </div>
                    <LifecycleBadge state={selected.state} />
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-3">
                    {[
                      ["Actions, 15 min", recent.length],
                      [
                        "Denied, 15 min",
                        recent.filter((t) => t.decision === "deny").length,
                      ],
                      [
                        "Awaiting a human",
                        recent.filter((t) => t.approval_state === "pending")
                          .length,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-md bg-surface-1 p-3 shadow-e1"
                      >
                        <p className="text-xs text-fg-secondary">{label}</p>
                        <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                          {traces.data ? value : "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="rounded-lg bg-surface-1 p-5 shadow-e1">
                  <p className="text-md text-fg-secondary">
                    {teamName(selected.team)} · confidential Keycloak client ·
                    client credentials
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <IdToken>{selected.provider}</IdToken>
                    <IdToken>{selected.model}</IdToken>
                    {selected.model.includes("mock") && (
                      <MockBadge modelLabel="mock model (demo)" />
                    )}
                  </div>
                  {selected.state_reason && (
                    <p
                      className={`mt-4 text-sm ${selected.state === "quarantined" ? "text-quarantined-fg" : "text-fg-secondary"}`}
                    >
                      {selected.state_reason}
                    </p>
                  )}
                  {selected.current_session ? (
                    <>
                      <h3 className="mt-6 text-md font-semibold">
                        AgentSession
                      </h3>
                      <p className="mt-2 text-md text-fg-secondary">
                        Initiated by{" "}
                        {selected.current_session.human.display_name} for{" "}
                        {selected.current_session.use_case.name}.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <IdToken>{selected.current_session.id}</IdToken>
                        <TierBadge
                          tier={selected.current_session.tier_ceiling}
                        />
                      </div>
                      <div className="mt-5 flex items-center gap-5 rounded-md bg-surface-2 p-4">
                        <BudgetGauge
                          used={selected.current_session.budget.used}
                          limit={selected.current_session.budget.limit}
                          label={centsLabel(
                            selected.current_session.budget.limit,
                          )}
                        />
                        <p className="text-sm text-fg-secondary">
                          Budget used{" "}
                          {centsLabel(selected.current_session.budget.used)} /{" "}
                          {centsLabel(selected.current_session.budget.limit)}.
                          An action that would exceed it is refused.
                        </p>
                      </div>
                      <h3 className="mb-4 mt-6 text-md font-semibold">
                        What this agent can do
                      </h3>
                      <ResourceState query={cases} noun="use cases">
                        {useCase ? (
                          <CapabilityIntersection
                            delegated={selected.current_session.delegated}
                            permitted={useCase.permitted}
                            useCase={useCase.name}
                            qualifiers={Object.fromEntries(
                              useCase.step_up_required.map((c) => [
                                c,
                                "Approval + step-up above the use case threshold",
                              ]),
                            )}
                          />
                        ) : (
                          <p className="text-md text-fg-secondary">
                            The use case ceiling is unavailable. No additional
                            capabilities are inferred.
                          </p>
                        )}
                      </ResourceState>
                    </>
                  ) : (
                    <p className="mt-6 text-md text-fg-secondary">
                      No active session. A human must create an AgentSession
                      before this agent can act.
                    </p>
                  )}
                  <a
                    href={`http://director.betsee.localhost/agents/${encodeURIComponent(selected.id)}`}
                    className="mt-6 inline-flex items-center gap-2 text-sm text-accent-text"
                  >
                    Open in Director
                    <Icon name="streamline-flex:arrow-expand" size={14} />
                  </a>
                </section>
              </article>
            )}
          </div>
        ) : section === "humans" ? (
          <div className="eco-grid">
            {humans.map((human) => {
              const count = sessionsOf(human.sub);
              return (
                <article
                  key={human.sub}
                  className="flex min-h-16 items-center gap-3 rounded-lg bg-surface-1 p-4 shadow-e1"
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-surface-3 font-display text-sm">
                    {human.display_name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-md font-semibold">
                      {human.display_name}
                    </h2>
                    <IdToken className="mt-1">{human.sub}</IdToken>
                  </div>
                  <p className="shrink-0 text-right text-xs text-fg-secondary">
                    {count} active {count === 1 ? "session" : "sessions"}
                  </p>
                </article>
              );
            })}
          </div>
        ) : section === "teams" ? (
          <OrgTree
            teams={teams.map((team) => ({
              id: team,
              name: teamName(team),
              agents: agents.data?.filter((a) => a.team === team) ?? [],
            }))}
            humans={humans.length}
          />
        ) : (
          <p>Unknown Identity section.</p>
        )}
      </ResourceState>
    </>
  );
}

type TreeAgent = NonNullable<
  ReturnType<typeof useEcosystemAgents>["data"]
>[number];

/** Organisation, its teams and their agent principals, top-down; connectors are plain borders. */
function OrgTree({
  teams,
  humans,
}: {
  teams: { id: string; name: string; agents: TreeAgent[] }[];
  humans: number;
}) {
  const agentCount = teams.reduce((sum, team) => sum + team.agents.length, 0);
  return (
    <section aria-label="Organisation tree" className="overflow-x-auto pb-4">
      <p className="text-sm text-fg-secondary">
        {humans} {humans === 1 ? "human" : "humans"} in active sessions ·{" "}
        {agentCount} agent principals
      </p>
      <div className="mt-6 flex min-w-max flex-col items-center">
        <div className="inline-flex h-14 items-center gap-3 rounded-md bg-surface-2 px-4 shadow-e1">
          <Icon
            name="streamline-flex:office-building-1"
            size={20}
            className="text-accent-text"
          />
          <span className="text-md font-semibold">Acme Logistics</span>
        </div>
        <div className="h-6 w-px bg-line-strong" aria-hidden="true" />
        <ul className="flex gap-4">
          {teams.map((team, index) => (
            <li
              key={team.id}
              className="relative flex flex-col items-center pt-6"
            >
              <span
                aria-hidden="true"
                className={`absolute top-0 h-px bg-line-strong ${index === 0 ? "left-1/2 right-[-8px]" : index === teams.length - 1 ? "left-[-8px] right-1/2" : "-left-2 -right-2"} ${teams.length === 1 ? "hidden" : ""}`}
              />
              <span
                aria-hidden="true"
                className="absolute top-0 h-6 w-px bg-line-strong"
              />
              <div className="flex h-14 w-44 items-center gap-3 rounded-md bg-surface-1 px-3 shadow-e1">
                <Icon
                  name="streamline-flex:user-collaborate-group"
                  size={18}
                  className="text-fg-secondary"
                />
                <div className="min-w-0">
                  <p className="truncate text-md font-semibold">{team.name}</p>
                  <p className="text-xs text-fg-secondary">
                    {team.agents.length}{" "}
                    {team.agents.length === 1 ? "agent" : "agents"}
                  </p>
                </div>
              </div>
              <ul className="mt-0 flex flex-col items-center">
                {team.agents.map((agent) => (
                  <li key={agent.id} className="flex flex-col items-center">
                    <span
                      aria-hidden="true"
                      className="h-4 w-px bg-line-strong"
                    />
                    <div className="w-44 rounded-md bg-surface-1 p-3 shadow-e1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface-3 text-accent-text">
                          <Icon
                            name="streamline-flex:ai-chip-robot"
                            size={14}
                          />
                        </span>
                        <span className="truncate font-mono text-xs font-medium">
                          {agent.id}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-col items-start gap-1.5">
                        <LifecycleBadge state={agent.state} />
                        <Link
                          to={`/identity/agents/${encodeURIComponent(agent.id)}`}
                          className="text-xs font-medium text-accent-text hover:underline"
                        >
                          Open profile
                        </Link>
                      </div>
                      {agent.current_session && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-secondary">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-pill bg-surface-3 font-display text-2xs">
                            {agent.current_session.human.display_name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </span>
                          {agent.current_session.human.display_name}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
