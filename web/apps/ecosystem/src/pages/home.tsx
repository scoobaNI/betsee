import { useEffect, useMemo, useState } from "react";
import {
  DecisionBars,
  Icon,
  IdToken,
  KpiTile,
  SeverityBadge,
  decisionBuckets,
} from "@betsee/ui";
import { useTraces } from "@betsee/api";
import {
  useControlCatalog,
  useConnectors,
  useEcosystemSummary,
  useSecurityEvents,
  useEcosystemMe,
} from "@betsee/api/resources/ecosystem";
import { ResourceState } from "../resource-state";

const stages = [
  ["authenticate", "Authenticate", "key-frame"],
  ["resolve_context", "Context", "hierarchy-2"],
  ["identity", "Identity", "user-identifier-card"],
  ["capability", "Capability", "tag"],
  ["cedar_authz", "Cedar authz", "justice-scale-1"],
  ["information_tier", "Tier", "layers-1"],
  ["command_validation", "Commands", "code-analysis"],
  ["threat_signatures", "Signatures", "shield-cross"],
  ["budget", "Budget", "dashboard-gauge-1"],
  ["ai_analysis", "AI analysis", "ai-scanner-robot"],
  ["decision", "Decision", "arrow-roadmap"],
  ["approval", "Approval", "inbox"],
  ["step_up", "Step-up", "fingerprint-1"],
  ["connector", "Connector", "link-chain"],
  ["output_controls", "Output", "filter-2"],
  ["audit", "Audit", "text-file"],
];

export function Home() {
  const summary = useEcosystemSummary();
  const controls = useControlCatalog();
  const connectors = useConnectors();
  const events = useSecurityEvents();
  const me = useEcosystemMe();
  const traces = useTraces();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    document.title = "Home - Betsee";
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const buckets = useMemo(
    () => decisionBuckets(traces.data ?? [], now),
    [traces.data, now],
  );
  const products = [
    {
      name: "Director",
      icon: "streamline:eye-optic",
      purpose: "See every agent, every action, every decision, live.",
      href: "http://director.betsee.localhost",
      number: summary.data?.actions_last_15m,
      label: "actions in 15 min",
    },
    {
      name: "Gateway",
      icon: "streamline-flex:shield-2",
      purpose: "Every agent action passes one deterministic boundary.",
      href: "#gateway-health",
      number: 15,
      label: "pipeline stages",
    },
    {
      name: "Policy Studio",
      icon: "streamline-flex:justice-scale-1",
      purpose: "Controls, Cedar policies and use cases in one place.",
      href: "/policy-studio/controls",
      number: controls.data?.length,
      label: "controls in the catalog",
    },
    {
      name: "Identity",
      icon: "streamline-flex:user-identifier-card",
      purpose: "Every agent is a principal with its own identity.",
      href: "/identity/agents",
      number: summary.data?.agents_active,
      label: "active agent principals",
    },
    {
      name: "Connect",
      icon: "streamline-flex:link-chain",
      purpose: "Every model, provider and tool behind one boundary.",
      href: "/connect/connectors",
      number: connectors.data?.filter((c) => c.status === "connected").length,
      label: "connected adapters",
    },
    {
      name: "Approvals",
      icon: "streamline-flex:inbox",
      purpose:
        "High-impact actions wait for a human, with proof of who they are.",
      href: "/approvals",
      number: summary.data?.awaiting_human,
      label: "waiting for a human",
    },
  ];
  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm text-fg-secondary">
            Acme Logistics · Enterprise Agent Control Ecosystem
          </p>
          <h1 className="mt-4 font-display text-5xl font-semibold">
            See every agent<span className="text-accent-text">.</span>
          </h1>
          <p className="mt-3 text-lg text-fg-secondary">
            Better see what your agents do.
          </p>
        </div>
        <a
          href="http://director.betsee.localhost"
          className="inline-flex h-11 items-center gap-3 rounded-md bg-accent px-5 text-md font-semibold text-fg-on-accent hover:bg-accent-hover"
        >
          <Icon name="streamline:eye-optic" />
          Open Director
          <Icon name="streamline-flex:arrow-expand" size={14} />
        </a>
      </header>
      <ResourceState query={summary} noun="Gateway summary">
        <div className="eco-kpis">
          <KpiTile
            label="Agents active"
            value={summary.data?.agents_active.toLocaleString("en-US") ?? "—"}
            detail="Each one is its own principal"
            href="/identity/agents"
            feature
          />
          <KpiTile
            label="Actions in 15 min"
            value={
              summary.data?.actions_last_15m.toLocaleString("en-US") ?? "—"
            }
            detail="Requests through the Gateway"
            href="http://director.betsee.localhost"
          />
          <KpiTile
            label="Denied"
            value={summary.data?.denied_last_15m.toLocaleString("en-US") ?? "—"}
            detail="Deterministic boundaries enforced"
            href="http://director.betsee.localhost"
          />
          <KpiTile
            label="Awaiting human"
            value={summary.data?.awaiting_human.toLocaleString("en-US") ?? "—"}
            detail="Exact actions needing review"
            href="/approvals"
          />
        </div>
      </ResourceState>
      <div className="my-8 grid items-start gap-5 lg:grid-cols-12">
        <section className="rounded-lg bg-surface-1 p-5 shadow-e1 lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">
                Decisions, last 15 minutes
              </h2>
              <p className="mt-2 text-sm text-fg-secondary">
                Every request the Gateway decided, per minute.
              </p>
            </div>
            <a
              href="http://director.betsee.localhost"
              className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
            >
              Open in Director
              <Icon name="streamline-flex:arrow-expand" size={14} />
            </a>
          </div>
          <div className="mt-5">
            <ResourceState query={traces} noun="decisions">
              <DecisionBars buckets={buckets} />
            </ResourceState>
          </div>
        </section>
        <section className="rounded-lg bg-surface-1 p-5 shadow-e1 lg:col-span-4">
          <h2 className="font-display text-xl font-semibold">
            Recent security events
          </h2>
          <div className="mt-4">
            <ResourceState
              query={events}
              noun="security events"
              empty={!events.data?.length}
              emptyTitle="No security events yet"
              emptyHint="Security exceptions appear here as agents act."
            >
              <div className="space-y-4">
                {events.data?.slice(0, 4).map((event) => (
                  <div
                    key={event.id}
                    className="border-b border-line-subtle pb-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <SeverityBadge severity={event.severity} />
                      <time className="font-mono text-2xs text-fg-tertiary">
                        {new Date(event.occurred_at).toLocaleTimeString([], {
                          hour12: false,
                        })}
                      </time>
                    </div>
                    <p className="mt-2 text-sm">
                      {event.message === "Agent released by authorized human" &&
                      typeof event.attributes.agent_id === "string" &&
                      me.data &&
                      event.attributes.human_sub === me.data.human.sub
                        ? `${event.attributes.agent_id} released by ${me.data.human.display_name}`
                        : event.message}
                    </p>
                    {event.trace_id && (
                      <div className="mt-2">
                        <IdToken
                          id={event.trace_id}
                          href={`http://director.betsee.localhost/traces/${encodeURIComponent(event.trace_id)}`}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ResourceState>
          </div>
        </section>
      </div>
      <div className="mb-8">
        <section
          id="gateway-health"
          className="rounded-lg bg-surface-1 p-5 shadow-e1"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">
                One execution boundary.
              </h2>
              <p className="mt-2 text-sm text-fg-secondary">
                Nondeterministic agents operate inside deterministic execution
                boundaries.
              </p>
            </div>
            <Icon
              name="streamline-flex:shield-2"
              size={28}
              className="text-fg-secondary"
            />
          </div>
          <div className="mt-6 grid grid-cols-3 gap-2 md:grid-cols-5 xl:grid-cols-15">
            {stages.map(([key, label, icon]) => (
              <div key={key} className="rounded-md bg-surface-2 p-3 shadow-e1">
                <div className="flex items-center justify-between gap-2">
                  <Icon
                    name={`streamline-flex:${icon}`}
                    size={16}
                    className="text-fg-secondary"
                  />
                  <span className="font-mono text-sm">
                    {summary.data
                      ? String(summary.data.stage_counts[key] ?? 0)
                      : "—"}
                  </span>
                </div>
                <p className="mt-2 truncate text-xs text-fg-secondary">
                  {label}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-fg-secondary">
            Counts are stage executions reported by the Gateway.
          </p>
        </section>
      </div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 className="font-display text-2xl font-semibold">
          One ecosystem. Six products.
        </h2>
        <span className="hidden text-sm text-fg-secondary md:inline">
          Shared identity. Shared controls.
        </span>
      </div>
      <div className="eco-grid">
        {products.map((product) => (
          <a
            key={product.name}
            href={product.href}
            className="group flex min-h-56 flex-col rounded-lg bg-surface-1 p-5 shadow-e1 hover:bg-surface-2 hover:shadow-e2"
          >
            <div className="flex items-center justify-between">
              <span className="rounded-sm bg-surface-3 p-3 text-accent-text">
                <Icon name={product.icon} size={28} />
              </span>
              <Icon
                name={
                  product.href.startsWith("http")
                    ? "streamline-flex:arrow-expand"
                    : "streamline:interface-arrows-upright-corner-arrow-up-right-upright-corner"
                }
                size={16}
                className="text-fg-tertiary group-hover:text-fg-primary"
              />
            </div>
            <h3 className="mt-4 font-display text-xl font-semibold">
              {product.name}
            </h3>
            <p className="mt-2 text-md text-fg-secondary">{product.purpose}</p>
            <p className="mt-auto pt-5 text-sm text-fg-secondary">
              <span className="mr-2 font-mono text-fg-primary">
                {product.number ?? "—"}
              </span>
              {product.label}
            </p>
          </a>
        ))}
      </div>
    </>
  );
}
