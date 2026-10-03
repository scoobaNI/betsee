import { useParams } from "react-router";
import { Icon, IdToken, MockBadge } from "@betsee/ui";
import { useConnectors } from "@betsee/api/resources/ecosystem";
import { PageHeader, Tabs } from "../layout";
import { ResourceState } from "../resource-state";

const tabs = ["connectors", "tools", "models"].map((section) => ({
  href: `/connect/${section}`,
  label: section[0].toUpperCase() + section.slice(1),
}));
const kindCopy: Record<string, string> = {
  "anthropic-direct":
    "Commercial provider adapter. API key is not configured for this demo.",
  "company-ai-gateway":
    "Real OpenAI-compatible HTTP adapter. The demo endpoint serves a mock model; a company gateway uses the same interface.",
  "local-model":
    "Use an OpenAI-compatible local endpoint, such as Ollama or LM Studio. Not configured in this demo.",
  "self-hosted":
    "Use an OpenAI-compatible self-hosted endpoint, such as vLLM. Not configured in this demo.",
  mcp: "MCP protocol tools behind deterministic controls and pinned descriptors.",
};
export function Connect() {
  const { section, id } = useParams();
  const query = useConnectors();
  const connectors = id ? query.data?.filter((c) => c.id === id) : query.data;
  const tools: Array<Record<string, unknown> & { connector: string }> =
    query.data?.flatMap((c) =>
      c.tools.map((t) => ({ ...t, connector: c.id })),
    ) ?? [];
  const models = query.data?.filter((c) => c.model_label !== null) ?? [];
  return (
    <>
      <PageHeader
        product="Connect"
        icon="streamline-flex:link-chain"
        title={
          section === "tools"
            ? "MCP tools"
            : section === "models"
              ? "Models behind the boundary"
              : "Connectors and providers"
        }
        purpose="Every model, provider and tool behind one boundary."
      />
      <Tabs items={tabs} />
      <ResourceState
        query={query}
        noun="connectors"
        empty={!query.data?.length}
      >
        <div className="eco-grid">
          {section === "connectors" ? (
            connectors?.map((connector) => (
              <article
                key={connector.id}
                className="rounded-lg border border-line-subtle bg-surface-1 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-sm bg-surface-3 p-3">
                    <Icon
                      name={
                        connector.kind === "mcp"
                          ? "streamline-flex:wrench-hand"
                          : "streamline-flex:link-chain"
                      }
                      size={28}
                    />
                  </span>
                  <span className="rounded-pill border border-line-default px-2 py-1 text-xs text-fg-secondary">
                    {connector.status.replaceAll("_", " ")}
                  </span>
                </div>
                <h2 className="mt-5 font-display text-xl font-semibold">
                  {connector.name}
                </h2>
                <div className="mt-3">
                  <IdToken
                    id={connector.id}
                    href={`/connect/connectors/${encodeURIComponent(connector.id)}`}
                  />
                </div>
                <p className="mt-4 text-md text-fg-secondary">
                  {kindCopy[connector.kind]}
                </p>
                {connector.model_label && (
                  <div className="mt-4">
                    <MockBadge modelLabel={connector.model_label} />
                  </div>
                )}
                <dl className="mt-5 border-t border-line-subtle pt-4 text-sm">
                  <dt className="text-fg-secondary">Endpoint</dt>
                  <dd className="mt-1 break-all font-mono">
                    {connector.base_url ?? "Not configured"}
                  </dd>
                  <dt className="mt-4 text-fg-secondary">Tools</dt>
                  <dd className="mt-1 font-mono">{connector.tools.length}</dd>
                </dl>
              </article>
            ))
          ) : section === "tools" ? (
            tools.map((tool, index) => (
              <article
                key={`${tool.connector}-${index}`}
                className="rounded-lg border border-line-subtle bg-surface-1 p-5"
              >
                <Icon name="streamline-flex:wrench-hand" size={28} />
                <h2 className="mt-4 font-mono text-lg">
                  {String(tool.name ?? tool.id ?? "MCP tool")}
                </h2>
                <p className="mt-3 text-sm text-fg-secondary">
                  Connector{" "}
                  <IdToken
                    id={tool.connector}
                    href={`/connect/connectors/${encodeURIComponent(tool.connector)}`}
                  />
                </p>
                <p className="mt-3 break-all font-mono text-xs">
                  Pinned:{" "}
                  {String(
                    tool.pinned_hash ??
                      tool.pinned_descriptor_hash ??
                      "Not reported",
                  )}
                </p>
                <p className="mt-3 text-sm text-fg-secondary">
                  Status: {String(tool.status ?? "Not reported")}
                </p>
              </article>
            ))
          ) : section === "models" ? (
            models.map((model) => (
              <article
                key={model.id}
                className="rounded-lg border border-line-subtle bg-surface-1 p-5"
              >
                <Icon
                  name="streamline-flex:artificial-intelligence-brain-chip"
                  size={28}
                />
                <h2 className="mt-4 font-display text-xl">
                  {model.model_label}
                </h2>
                <div className="mt-3">
                  <MockBadge modelLabel={model.model_label!} />
                </div>
                <p className="mt-4 text-md text-fg-secondary">
                  The analyzer uses this connector to tighten deterministic
                  decisions. It can never loosen a deny.
                </p>
                <div className="mt-4">
                  <IdToken
                    id={model.id}
                    href={`/connect/connectors/${encodeURIComponent(model.id)}`}
                  />
                </div>
              </article>
            ))
          ) : (
            <p>Unknown Connect section.</p>
          )}
        </div>
        {section === "tools" && !tools.length && (
          <p className="rounded-lg bg-surface-1 p-6 text-md text-fg-secondary">
            No tools reported by configured connectors.
          </p>
        )}
        {section === "models" && !models.length && (
          <p className="rounded-lg bg-surface-1 p-6 text-md text-fg-secondary">
            No model is configured.
          </p>
        )}
      </ResourceState>
    </>
  );
}
