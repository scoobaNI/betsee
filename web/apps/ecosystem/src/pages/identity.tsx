import { useParams, Link } from "react-router";
import {
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
import { PageHeader, Tabs } from "../layout";
import { ResourceState } from "../resource-state";

const tabs = ["agents", "humans", "teams"].map((section) => ({
  href: `/identity/${section}`,
  label: section[0].toUpperCase() + section.slice(1),
}));
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
                  className={`block rounded-lg border p-4 ${selected?.id === agent.id ? "border-line-focus bg-surface-2" : "border-line-subtle bg-surface-1 hover:bg-surface-2"}`}
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
                    {agent.team} · {agent.provider}
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
              <article className="eco-detail-panel rounded-lg border border-line-subtle bg-surface-1 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-mono text-lg">{selected.id}</h2>
                  <LifecycleBadge state={selected.state} />
                </div>
                <p className="mt-3 text-md text-fg-secondary">
                  {selected.team} · confidential Keycloak client · client
                  credentials
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <IdToken>{selected.provider}</IdToken>
                  <IdToken>{selected.model}</IdToken>
                  {selected.model.includes("mock") && (
                    <MockBadge modelLabel="mock model (demo)" />
                  )}
                </div>
                {selected.state_reason && (
                  <p className="mt-4 text-sm text-quarantined-fg">
                    {selected.state_reason}
                  </p>
                )}
                {selected.current_session ? (
                  <>
                    <h3 className="mt-6 text-md font-semibold">AgentSession</h3>
                    <p className="mt-2 text-md text-fg-secondary">
                      Initiated by {selected.current_session.human.display_name}{" "}
                      for {selected.current_session.use_case.name}.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <IdToken>{selected.current_session.id}</IdToken>
                      <TierBadge tier={selected.current_session.tier_ceiling} />
                    </div>
                    <p className="mt-4 text-sm text-fg-secondary">
                      Budget used{" "}
                      {(
                        selected.current_session.budget.used / 100
                      ).toLocaleString("en-US")}{" "}
                      /{" "}
                      {(
                        selected.current_session.budget.limit / 100
                      ).toLocaleString("en-US")}{" "}
                      EUR
                    </p>
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
              </article>
            )}
          </div>
        ) : section === "humans" ? (
          <div className="eco-grid">
            {humans.map((human) => (
              <article
                key={human.sub}
                className="rounded-lg border border-line-subtle bg-surface-1 p-5"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-pill bg-surface-3 font-display">
                  {human.display_name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </span>
                <h2 className="mt-4 font-display text-xl">
                  {human.display_name}
                </h2>
                <div className="mt-3">
                  <IdToken>{human.sub}</IdToken>
                </div>
                <p className="mt-4 text-sm text-fg-secondary">
                  Initiates{" "}
                  {
                    agents.data?.filter(
                      (a) => a.current_session?.human.sub === human.sub,
                    ).length
                  }{" "}
                  active agent sessions. Agents receive only explicit
                  delegation.
                </p>
              </article>
            ))}
          </div>
        ) : section === "teams" ? (
          <div className="eco-grid">
            {teams.map((team) => (
              <article
                key={team}
                className="rounded-lg border border-line-subtle bg-surface-1 p-5"
              >
                <Icon name="streamline-flex:user-collaborate-group" size={28} />
                <h2 className="mt-4 font-display text-xl">{team}</h2>
                <div className="mt-4 space-y-2">
                  {agents.data
                    ?.filter((a) => a.team === team)
                    .map((a) => (
                      <div key={a.id}>
                        <IdToken
                          id={a.id}
                          href={`/identity/agents/${encodeURIComponent(a.id)}`}
                        />
                      </div>
                    ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>Unknown Identity section.</p>
        )}
      </ResourceState>
    </>
  );
}
