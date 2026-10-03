import type { Connector, Policy } from "../../types.ts";
import { CONTROLS, USE_CASES } from "../world.ts";
import type { MockWorld } from "../generator.ts";
import policies from "./ecosystem-policies.json" with { type: "json" };

export const POLICY_FIXTURES: Policy[] = policies;
export const CONNECTOR_FIXTURES: Connector[] = [
  {
    id: "mcp",
    name: "Acme operations tools",
    kind: "mcp",
    status: "connected",
    model_label: null,
    base_url: "http://mcp-demo:8090/mcp",
    tools: [
      {
        name: "payments",
        status: "pinned",
        pinned_hash: "demo-fixture",
        description:
          "Transfer payments after exact-action approval and step-up.",
      },
      {
        name: "crm",
        status: "pinned",
        pinned_hash: "demo-fixture",
        description: "Read customer records inside the session tier ceiling.",
      },
    ],
  },
  {
    id: "company-ai-gateway",
    name: "OpenAI-compatible gateway",
    kind: "company-ai-gateway",
    status: "connected",
    model_label: "mock model (demo)",
    base_url: "http://mock-llm:8091/v1",
    tools: [],
  },
  {
    id: "anthropic-direct",
    name: "Anthropic direct",
    kind: "anthropic-direct",
    status: "not_configured",
    model_label: null,
    base_url: null,
    tools: [],
  },
  {
    id: "local-model",
    name: "Local model",
    kind: "local-model",
    status: "not_configured",
    model_label: null,
    base_url: null,
    tools: [],
  },
  {
    id: "self-hosted",
    name: "Self-hosted model",
    kind: "self-hosted",
    status: "not_configured",
    model_label: null,
    base_url: null,
    tools: [],
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
export function ecosystemMockResponse(
  world: MockWorld,
  path: string,
  method: string,
): Response | null {
  if (method !== "GET") return null;
  if (path === "/api/v1/controls") return json({ items: CONTROLS });
  if (path === "/api/v1/policies") return json({ items: POLICY_FIXTURES });
  if (path === "/api/v1/use-cases")
    return json({ items: Object.values(USE_CASES) });
  if (path === "/api/v1/connectors") return json({ items: CONNECTOR_FIXTURES });
  if (path === "/api/v1/approvals") return json({ items: world.approvals() });
  if (path === "/api/v1/summary") return json(world.summary());
  if (path === "/api/v1/security-events")
    return json({ items: world.securityEvents() });
  return null;
}
