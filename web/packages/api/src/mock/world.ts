// The demo cast from docs/demo-script.md. Controls and primitives come from a snapshot of
// policies/controls.yaml, so mock traces cite the same CTL ids as the live Gateway.
import type { Control, Human, Me, Primitive, Tier, UseCase, UseCaseRef } from '../types.ts';
import catalog from './controls.snapshot.json' with { type: 'json' };

export const ORGANIZATION = { id: 'acme-logistics', name: 'Acme Logistics' };
export const ANALYZER_LABEL = 'mock model (demo)';

export const CONTROLS = catalog.controls as Control[];
export const PRIMITIVES = catalog.primitives as Primitive[];
export const controlById = new Map(CONTROLS.map((c) => [c.id, c]));

export const HUMANS = {
  maya: { sub: 'u-maya-chen', display_name: 'Maya Chen' },
  daniel: { sub: 'u-daniel-ortiz', display_name: 'Daniel Ortiz' },
  priya: { sub: 'u-priya-raman', display_name: 'Priya Raman' },
} satisfies Record<string, Human>;

// The presenter is signed in as Daniel in both tabs (decision D8, p-114).
export const MOCK_ME: Me = {
  human: HUMANS.daniel,
  roles: ['security-officer', 'approver'],
  organization: ORGANIZATION,
  acr: '1',
};

export const ASI_TITLES: Record<string, string> = {
  ASI01: 'Agent goal hijack',
  ASI02: 'Tool misuse and exploitation',
  ASI03: 'Identity and privilege abuse',
  ASI04: 'Agentic supply chain',
  ASI05: 'Unexpected code execution',
  ASI06: 'Memory and context poisoning',
  ASI07: 'Insecure inter-agent communication',
  ASI08: 'Cascading failures',
  ASI09: 'Human-agent trust exploitation',
  ASI10: 'Rogue agents',
};

const ZERO_BUDGET = { limit: 0, used: 0, unit: 'cents' as const };

function useCase(
  id: string,
  name: string,
  permitted: string[],
  tier: Tier,
  extra: Partial<UseCase> = {},
): UseCase {
  return {
    id,
    name,
    permitted,
    tier_ceiling: tier,
    approval_required: [],
    step_up_required: [],
    approval_threshold_cents: 0,
    budget: ZERO_BUDGET,
    agent_ids: [],
    peer_ids: [],
    ...extra,
  };
}

export const USE_CASES = {
  invoice: useCase('invoice-processing', 'Invoice processing', ['crm.read', 'files.read', 'payments.transfer', 'email.send'], 'internal', {
    approval_required: ['payments.transfer'],
    step_up_required: ['payments.transfer'],
    approval_threshold_cents: 1_000_000,
    agent_ids: ['invoice-assistant'],
  }),
  triage: useCase('ticket-triage', 'Ticket triage', ['tickets.read', 'tickets.write', 'crm.read', 'memory.write'], 'internal', {
    agent_ids: ['support-triage'],
  }),
  research: useCase('market-research', 'Market research', ['llm.complete', 'files.read', 'agent.message'], 'public', {
    agent_ids: ['research-agent'],
  }),
  deploy: useCase('deployment-helper', 'Deployment helper', ['shell.exec'], 'internal', {
    agent_ids: ['ops-runner'],
  }),
  reporting: useCase('weekly-reporting', 'Weekly reporting', ['crm.read', 'llm.complete'], 'internal', {
    agent_ids: ['report-bot'],
  }),
};

export const ref = (u: UseCase): UseCaseRef => ({ id: u.id, name: u.name });

export interface AgentSeed {
  id: string;
  team: string;
  provider: string;
  model: string;
  human: Human;
  useCase: UseCase;
  delegated: string[];
  tierCeiling: Tier;
  budgetCents: number;
}

export const AGENTS: AgentSeed[] = [
  {
    id: 'invoice-assistant',
    team: 'Finance',
    provider: 'company-ai-gateway',
    model: 'mock-llm',
    human: HUMANS.maya,
    useCase: USE_CASES.invoice,
    delegated: ['crm.read', 'files.read', 'payments.transfer', 'email.send'],
    tierCeiling: 'internal',
    budgetCents: 2_000,
  },
  {
    id: 'report-bot',
    team: 'Finance',
    provider: 'company-ai-gateway',
    model: 'mock-llm',
    human: HUMANS.maya,
    useCase: USE_CASES.reporting,
    delegated: ['crm.read', 'llm.complete'],
    tierCeiling: 'internal',
    budgetCents: 400,
  },
  {
    id: 'support-triage',
    team: 'Support',
    provider: 'local-model',
    model: 'mock-llm',
    human: HUMANS.daniel,
    useCase: USE_CASES.triage,
    delegated: ['tickets.read', 'tickets.write', 'crm.read', 'memory.write'],
    tierCeiling: 'internal',
    budgetCents: 1_500,
  },
  {
    id: 'research-agent',
    team: 'Strategy',
    provider: 'self-hosted',
    model: 'mock-llm',
    human: HUMANS.priya,
    useCase: USE_CASES.research,
    delegated: ['llm.complete', 'files.read', 'agent.message'],
    tierCeiling: 'public',
    budgetCents: 1_200,
  },
  {
    id: 'ops-runner',
    team: 'Platform',
    provider: 'company-ai-gateway',
    model: 'mock-llm',
    human: HUMANS.priya,
    useCase: USE_CASES.deploy,
    delegated: ['shell.exec'],
    tierCeiling: 'internal',
    budgetCents: 600,
  },
];

export const TOOLS = {
  crm: { name: 'crm', connector: 'mcp' },
  tickets: { name: 'tickets', connector: 'mcp' },
  files: { name: 'files', connector: 'mcp' },
  payments: { name: 'payments', connector: 'mcp' },
  email: { name: 'email-outbox', connector: 'mcp' },
  shell: { name: 'shell-templates', connector: 'mcp' },
  llm: { name: 'chat-completions', connector: 'company-ai-gateway' },
  memory: { name: 'agent-memory', connector: 'mcp' },
} as const;

/** Spend per action in cents, so budget meters move like the Gateway's. */
export const COST_CENTS: Record<string, number> = {
  'llm.complete': 12,
  'crm.read': 5,
  'files.read': 3,
  'tickets.read': 2,
  'tickets.write': 3,
  'memory.write': 2,
  'shell.exec': 8,
  'agent.message': 1,
  'email.send': 2,
  'payments.transfer': 10,
};

export const CUSTOMERS = ['C-1042', 'C-1043', 'C-1057', 'C-1088', 'C-1102', 'C-1131', 'C-1164', 'C-1190'];
