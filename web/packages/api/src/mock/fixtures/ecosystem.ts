import type { Connector, Policy } from "../../types.ts";
import { CONTROLS, USE_CASES } from "../world.ts";
import type { MockWorld } from "../generator.ts";
import policies from "./ecosystem-policies.json" with { type: "json" };

export const POLICY_FIXTURES: Policy[] = policies;
export const CONNECTOR_FIXTURES: Connector[] = [
  {
    id: "mcp-demo",
    name: "Acme operations tools",
    kind: "mcp",
    status: "connected",
    model_label: null,
    base_url: "http://mcp:8081/mcp",
    tools: [
      [
        "crm",
        "5d67492dc11c0965bd70ae15829120aee075b5d534d3bc4347853c1eef21d8f5",
      ],
      [
        "tickets",
        "84a809d567f41d877a3d6f791a45b333fedbd5dba7bf76c57fadf509240f44b0",
      ],
      [
        "files",
        "b96c522f7e3edf787d99b08114185ea27d66a44033f2b383eaa8c9c47c5e7e2c",
      ],
      [
        "payments",
        "60e647f273024fb53ba686954c5320ce4faf0e7b9556c42695b39907ff13fd00",
      ],
      [
        "email",
        "2a75cb9cfb0dbcbec5244ca4ddf61aba4ef84c41a41be5cac53e16eecc316580",
      ],
    ].map(([name, hash]) => ({
      name,
      connector_id: "mcp-demo",
      status: "ready",
      pinned_hash: `sha256:${hash}`,
      observed_hash: `sha256:${hash}`,
    })),
  },
  {
    id: "openai-compatible",
    name: "OpenAI-compatible gateway",
    kind: "company-ai-gateway",
    status: "connected",
    model_label: "mock model (demo)",
    base_url: "http://mock-llm:8082/v1",
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
