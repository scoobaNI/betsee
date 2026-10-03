import type {
  ActionSummary,
  Agent,
  AgentMessage,
  Analyzer,
  Approval,
  Coverage,
  Decision,
  Resource,
  Scenario,
  ScenarioRun,
  SecurityEvent,
  Span,
  SpanStatus,
  StageId,
  StreamEvent,
  ToolRef,
  Trace,
} from '../types.ts';
import { SCENARIOS } from './scenarios.ts';
import {
  AGENTS,
  ANALYZER_LABEL,
  ASI_TITLES,
  CONTROLS,
  COST_CENTS,
  CUSTOMERS,
  ORGANIZATION,
  PRIMITIVES,
  TOOLS,
  ref,
  type AgentSeed,
} from './world.ts';

export type DeterministicStage =
  | 'identity'
  | 'capability'
  | 'cedar_authz'
  | 'information_tier'
  | 'command_validation'
  | 'budget';

export type Outcome =
  | { kind: 'allow' }
  | { kind: 'deny'; stage: DeterministicStage; controls: string[]; policy?: string; reason: string }
  | { kind: 'tighten'; to: 'require_approval' | 'deny'; rationale: string }
  | {
      kind: 'approval';
      controls: string[];
      reason: string;
      stepUp: boolean;
      resolution: 'approved' | 'rejected';
      resolveAfterMs: number;
      parameters: Record<string, string | number>;
    };

export interface ActionPlan {
  agentId: string;
  capability: string;
  resource: Resource;
  tool: ToolRef | null;
  outcome: Outcome;
  message?: { receiverId: string; content: string };
  quarantineAfter?: string;
}

export interface LoggedEvent {
  id: number;
  event: StreamEvent;
}

export interface WorldOptions {
  seed?: number;
  /** Multiplies every scheduled delay; tests run the world at a fraction of real time. */
  timeScale?: number;
  backgroundEveryMs?: [number, number];
  backfill?: number;
  /** The Director has no approve button, so its mock lets Daniel decide on a timer. */
  autoResolveApprovals?: boolean;
}

const DETERMINISTIC: { stage: DeterministicStage; control: string; ms: number }[] = [
  { stage: 'identity', control: 'CTL-ID-001', ms: 0.4 },
  { stage: 'capability', control: 'CTL-CAP-001', ms: 0.3 },
  { stage: 'cedar_authz', control: 'CTL-POL-001', ms: 0.9 },
  { stage: 'information_tier', control: 'CTL-TIER-001', ms: 0.2 },
  { stage: 'command_validation', control: 'CTL-EXEC-001', ms: 0.3 },
  { stage: 'budget', control: 'CTL-RUN-001', ms: 0.2 },
];

const BUDGET_WINDOW_MS = 5 * 60_000;
const EVENT_LOG_LIMIT = 2_000;
const FEED_LIMIT = 1_000;
const AUTO_REJECT_TIGHTENED_MS = 9_000;

interface Record_ {
  trace: Trace;
  plan: ActionPlan;
  approval: Approval | null;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const emptyCounts = () => ({ allow: 0, deny: 0, require_approval: 0, require_step_up: 0, ai_tightened: 0 });

export function createMockWorld(options: WorldOptions = {}) {
  const rng = mulberry32(options.seed ?? 7);
  const timeScale = options.timeScale ?? 1;
  const [minEvery, maxEvery] = options.backgroundEveryMs ?? [1_500, 3_000];
  const hex = (len: number) =>
    Array.from({ length: len }, () => Math.floor(rng() * 16).toString(16)).join('');
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];

  const seeds = new Map(AGENTS.map((a) => [a.id, a]));
  const agents = new Map<string, Agent>();
  const records = new Map<string, Record_>();
  const feed: string[] = [];
  const messages: AgentMessage[] = [];
  const evidence = new Map<string, ReturnType<typeof emptyCounts>>();
  const log: LoggedEvent[] = [];
  const listeners = new Set<(e: LoggedEvent) => void>();
  const runs = new Map<string, ScenarioRun>();
  const securityEvents: SecurityEvent[] = [];
  const breakerTripped = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let eventSeq = 0;
  let backgroundTimer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms * timeScale);
    timers.add(timer);
  };

  const emit = (event: StreamEvent) => {
    const entry = { id: ++eventSeq, event };
    log.push(entry);
    if (log.length > EVENT_LOG_LIMIT) log.splice(0, log.length - EVENT_LOG_LIMIT);
    for (const listener of listeners) listener(entry);
  };

  function buildAgent(seed: AgentSeed, at: number): Agent {
    const budget = { limit: seed.budgetCents, used: 0, unit: 'cents' as const };
    const effective = seed.delegated.filter((c) => seed.useCase.permitted.includes(c));
    return {
      id: seed.id,
      name: seed.id,
      team: seed.team,
      provider: seed.provider,
      model: seed.model,
      state: 'active',
      state_reason: null,
      state_changed_at: null,
      budget,
      current_session: {
        id: `ses-${seed.id}`,
        human: seed.human,
        agent_id: seed.id,
        use_case: ref(seed.useCase),
        delegated: seed.delegated,
        effective,
        tier_ceiling: seed.tierCeiling,
        budget,
        approval_state: 'none',
        status: 'active',
        started_at: new Date(at - 45 * 60_000).toISOString(),
        expires_at: new Date(at + 8 * 60 * 60_000).toISOString(),
      },
    };
  }

  function spentCents(agentId: string, at: number): number {
    let used = 0;
    for (let i = feed.length - 1; i >= 0; i--) {
      const r = records.get(feed[i]);
      if (!r) continue;
      if (Date.parse(r.trace.occurred_at) < at - BUDGET_WINDOW_MS) break;
      if (r.trace.agent.id === agentId && r.trace.executed) used += COST_CENTS[r.trace.capability] ?? 1;
    }
    return used;
  }

  function buildSpans(
    plan: ActionPlan,
    traceId: string,
    start: number,
    final: Decision,
    resolution?: { state: 'approved' | 'rejected'; at: number },
  ): Span[] {
    const spans: Span[] = [];
    let clock = start;
    const add = (
      stage: StageId,
      status: SpanStatus,
      ms: number,
      extra: Partial<Pick<Span, 'control_ids' | 'policy_ids' | 'reason' | 'attributes'>> = {},
    ) => {
      spans.push({
        span_id: `${traceId.slice(0, 16)}${String(spans.length + 1).padStart(2, '0')}`,
        parent_span_id: null,
        stage,
        status,
        started_at: new Date(clock).toISOString(),
        duration_ms: ms,
        control_ids: extra.control_ids ?? [],
        policy_ids: extra.policy_ids ?? [],
        reason: extra.reason ?? '',
        attributes: extra.attributes ?? {},
      });
      clock += ms;
    };
    const audit = () => add('audit', 'passed', 2.4, { control_ids: ['CTL-AUD-001'], attributes: { table: 'audit_events' } });
    const { outcome } = plan;

    add('authenticate', 'passed', 1.8, { attributes: { client_id: plan.agentId, grant: 'client_credentials' } });
    add('resolve_context', 'passed', 3.1, { attributes: { session_id: `ses-${plan.agentId}` } });
    for (const { stage, control, ms } of DETERMINISTIC) {
      if (outcome.kind === 'deny' && outcome.stage === stage) {
        add(stage, 'denied', ms, {
          control_ids: outcome.controls,
          policy_ids: outcome.policy ? [outcome.policy] : [],
          reason: outcome.reason,
        });
        add('decision', 'denied', 0.1, { attributes: { decision: 'deny' } });
        audit();
        return spans;
      }
      if (stage === 'command_validation' && plan.capability !== 'shell.exec') {
        add(stage, 'skipped', 0, { reason: 'No command to validate for this capability.' });
        continue;
      }
      add(stage, 'passed', ms, { control_ids: [control] });
    }
    const tightened = outcome.kind === 'tighten';
    add('ai_analysis', tightened ? 'tightened' : 'passed', 182, {
      control_ids: ['CTL-AI-001'],
      policy_ids: tightened ? [outcome.to === 'deny' ? 'analyzer-malicious' : 'analyzer-suspicious'] : [],
      reason: tightened ? outcome.rationale : 'No instructions found inside data.',
      attributes: { verdict: tightened ? (outcome.to === 'deny' ? 'malicious' : 'suspicious') : 'clean', model_label: ANALYZER_LABEL },
    });
    add('decision', final === 'deny' ? 'denied' : 'passed', 0.1, { attributes: { decision: final } });
    if (final === 'deny') {
      audit();
      return spans;
    }
    if (final === 'require_approval') {
      const stepUp = outcome.kind === 'approval' && outcome.stepUp;
      const controls = outcome.kind === 'approval' ? outcome.controls : ['CTL-AI-001'];
      if (!resolution) {
        add('approval', 'pending', 0, {
          control_ids: controls,
          reason: 'Waiting for an approver with the security-officer role.',
          attributes: { requires_step_up: stepUp },
        });
        audit();
        return spans;
      }
      const waited = Math.max(0, resolution.at - clock);
      const decided = { approver_sub: 'u-daniel-ortiz', approver_name: 'Daniel Ortiz', decided_at: new Date(resolution.at).toISOString(), requires_step_up: stepUp };
      if (resolution.state === 'rejected') {
        add('approval', 'denied', waited, { control_ids: controls, reason: 'Rejected by Daniel Ortiz.', attributes: decided });
        audit();
        return spans;
      }
      add('approval', 'passed', waited, { control_ids: controls, reason: 'Approved by Daniel Ortiz.', attributes: decided });
      if (stepUp) {
        add('step_up', 'passed', 0.8, {
          control_ids: ['CTL-APR-002'],
          attributes: { ...decided, acr: '2', method: 'otp' },
        });
      }
    }
    add('connector', 'passed', 24, { attributes: { tool: plan.tool?.name ?? '-', connector: plan.tool?.connector ?? '-' } });
    add('output_controls', 'passed', 0.6, { control_ids: ['CTL-OUT-001'] });
    audit();
    return spans;
  }

  function decisions(outcome: Outcome): { deterministic: Decision; final: Decision } {
    switch (outcome.kind) {
      case 'allow':
        return { deterministic: 'allow', final: 'allow' };
      case 'deny':
        return { deterministic: 'deny', final: 'deny' };
      case 'tighten':
        return { deterministic: 'allow', final: outcome.to };
      case 'approval':
        return { deterministic: 'require_approval', final: 'require_approval' };
    }
  }

  function analyzerFor(outcome: Outcome): Analyzer {
    if (outcome.kind === 'deny') {
      return { verdict: 'skipped', rationale: 'Deterministic deny: the analyzer is not consulted.', model_label: ANALYZER_LABEL };
    }
    if (outcome.kind === 'tighten') {
      return { verdict: outcome.to === 'deny' ? 'malicious' : 'suspicious', rationale: outcome.rationale, model_label: ANALYZER_LABEL };
    }
    return { verdict: 'clean', rationale: 'No instructions found inside data.', model_label: ANALYZER_LABEL };
  }

  function countEvidence(action: ActionSummary) {
    const asiIds = new Set<string>();
    for (const id of action.control_ids) {
      for (const asi of CONTROLS.find((c) => c.id === id)?.asi ?? []) asiIds.add(asi);
    }
    for (const asi of asiIds) {
      const counts = evidence.get(asi) ?? emptyCounts();
      counts[action.decision]++;
      if (action.ai_tightened) counts.ai_tightened++;
      evidence.set(asi, counts);
    }
  }

  function perform(input: ActionPlan, at = Date.now(), quiet = false): Trace {
    const seed = seeds.get(input.agentId);
    const agent = agents.get(input.agentId);
    if (!seed || !agent) throw new Error(`unknown agent ${input.agentId}`);
    const plan: ActionPlan =
      agent.state === 'active'
        ? input
        : {
            ...input,
            outcome: {
              kind: 'deny',
              stage: 'identity',
              controls: ['CTL-ID-002'],
              policy: 'forbid-agent-not-active',
              reason: `${agent.id} is ${agent.state}: ${agent.state_reason ?? 'kill switch'}.`,
            },
          };
    const o = plan.outcome;
    const traceId = hex(32);
    const { deterministic, final } = decisions(o);
    const spans = buildSpans(plan, traceId, at, final);
    const session = agent.current_session;
    const trace: Trace = {
      trace_id: traceId,
      occurred_at: new Date(at).toISOString(),
      agent: { id: agent.id, name: agent.name, team: agent.team },
      session_id: session?.id ?? 'ses-none',
      human: seed.human,
      use_case: ref(seed.useCase),
      capability: plan.capability,
      resource: plan.resource,
      tool: plan.tool,
      decision: final,
      deterministic_decision: deterministic,
      analyzer: analyzerFor(o),
      ai_tightened: o.kind === 'tighten',
      control_ids:
        o.kind === 'deny' ? o.controls
        : o.kind === 'tighten' ? ['CTL-AI-001']
        : o.kind === 'approval' ? o.controls
        : ['CTL-CAP-001'],
      policy_ids:
        o.kind === 'deny' ? (o.policy ? [o.policy] : [])
        : o.kind === 'tighten' ? [o.to === 'deny' ? 'analyzer-malicious' : 'analyzer-suspicious']
        : o.kind === 'approval' ? ['approval-payment-above-threshold', 'step-up-payment-above-threshold']
        : ['permit-effective-capability'],
      reasons:
        o.kind === 'deny' ? [o.reason]
        : o.kind === 'tighten' ? [o.rationale]
        : o.kind === 'approval' ? [o.reason]
        : [`${plan.capability} is effective for ${seed.useCase.name}.`],
      approval_state: final === 'require_approval' || final === 'require_step_up' ? 'pending' : 'none',
      latency_ms: Math.round(spans.reduce((sum, s) => sum + s.duration_ms, 0) * 10) / 10,
      executed: final === 'allow',
      output: final === 'allow' ? { status: 'ok' } : null,
      obligations:
        o.kind === 'approval' ? (o.stepUp ? ['approval', 'step_up'] : ['approval'])
        : o.kind === 'tighten' && o.to === 'require_approval' ? ['approval']
        : [],
      step_up_required: o.kind === 'approval' && o.stepUp,
      caller_trace_id: null,
      spans,
      execution_context: {
        organization: ORGANIZATION.name,
        human: seed.human.display_name,
        agent: agent.id,
        use_case: seed.useCase.name,
        session_id: session?.id ?? null,
        delegated: session?.delegated ?? [],
        effective: session?.effective ?? [],
        tier_ceiling: session?.tier_ceiling ?? null,
      },
    };
    let approval: Approval | null = null;
    if (trace.approval_state === 'pending') {
      approval = {
        id: `apr-${traceId.slice(0, 12)}`,
        trace_id: traceId,
        state: 'pending',
        action: summary(trace),
        parameters: o.kind === 'approval' ? o.parameters : { resource: `${plan.resource.type}:${plan.resource.id}` },
        provenance: { source: 'gateway', parameters: 'as received from the agent request' },
        action_hash: `sha256:${hex(16)}`,
        requires_step_up: o.kind === 'approval' && o.stepUp,
        created_at: trace.occurred_at,
        decided_at: null,
        approver: null,
      };
    }
    records.set(traceId, { trace, plan, approval });
    feed.push(traceId);
    if (feed.length > FEED_LIMIT) records.delete(feed.shift()!);
    agent.budget.used = spentCents(agent.id, at);
    countEvidence(trace);

    let message: AgentMessage | null = null;
    if (plan.message) {
      const receiver = agents.get(plan.message.receiverId);
      message = {
        id: `msg-${traceId.slice(0, 12)}`,
        sender: trace.agent,
        receiver: receiver
          ? { id: receiver.id, name: receiver.name, team: receiver.team }
          : { id: plan.message.receiverId, name: plan.message.receiverId, team: '' },
        use_case: trace.use_case,
        capability: plan.capability,
        provenance: { origin: agent.id, trust: 'untrusted', via: 'gateway' },
        decision: final,
        trace_id: traceId,
        occurred_at: trace.occurred_at,
        content: final === 'allow' ? plan.message.content : '',
        executed: final === 'allow',
        control_ids: trace.control_ids,
        policy_ids: trace.policy_ids,
      };
      messages.push(message);
    }
    if (!quiet) {
      emit({ type: 'action.decided', data: summary(trace) });
      if (message) emit({ type: 'message.mediated', data: structuredClone(message) });
      if (o.kind === 'deny' && o.controls.includes('CTL-TOOL-001')) {
        emit({
          type: 'tool.descriptor_changed',
          data: { connector_id: 'mcp', tool: plan.resource.id, pinned_hash: 'sha256:9f2c..e1', observed_hash: 'sha256:4ab0..77', status: 'blocked' },
        });
        securityEvent('descriptor_drift', 'critical', traceId, `${plan.resource.id} tool descriptor changed; the tool is blocked.`, { tool: plan.resource.id });
      }
      if (o.kind === 'deny' && o.controls.includes('CTL-RUN-003') && !breakerTripped.has(agent.id)) {
        breakerTripped.add(agent.id);
        securityEvent('breaker_tripped', 'high', traceId, `Circuit breaker tripped for ${agent.id}.`, { agent_id: agent.id });
      }
    }
    if (options.autoResolveApprovals !== false) {
      if (o.kind === 'approval') {
        schedule(o.resolveAfterMs, () => resolve(traceId, o.resolution));
      } else if (o.kind === 'tighten' && o.to === 'require_approval') {
        schedule(AUTO_REJECT_TIGHTENED_MS, () => resolve(traceId, 'rejected'));
      }
    }
    if (plan.quarantineAfter && agent.state === 'active') {
      setAgentState(agent.id, 'quarantined', plan.quarantineAfter, at);
      if (!quiet) securityEvent('agent_quarantined', 'high', traceId, `${agent.id} quarantined: ${plan.quarantineAfter}`, { agent_id: agent.id });
    }
    return structuredClone(trace);
  }

  function resolve(traceId: string, state: 'approved' | 'rejected') {
    const r = records.get(traceId);
    if (!r || r.trace.approval_state !== 'pending') return;
    const at = Date.now();
    r.trace.approval_state = state;
    r.trace.executed = state === 'approved';
    r.trace.output = state === 'approved' ? { status: 'ok' } : null;
    r.trace.spans = buildSpans(r.plan, traceId, Date.parse(r.trace.occurred_at), r.trace.decision, { state, at });
    if (r.approval) {
      r.approval.state = state;
      r.approval.decided_at = new Date(at).toISOString();
      r.approval.approver = { sub: 'u-daniel-ortiz', display_name: 'Daniel Ortiz' };
      r.approval.action = summary(r.trace);
    }
    emit({ type: 'action.updated', data: summary(r.trace) });
    if (state === 'rejected') {
      securityEvent('approval_rejected', 'low', traceId, `Approval rejected for ${r.trace.agent.id}: ${r.trace.capability}.`);
    }
  }

  function securityEvent(
    type: SecurityEvent['type'],
    severity: SecurityEvent['severity'],
    traceId: string,
    message: string,
    attributes: Record<string, unknown> = {},
  ) {
    const event: SecurityEvent = {
      id: `sev-${hex(12)}`,
      type,
      severity,
      trace_id: traceId,
      message,
      occurred_at: new Date().toISOString(),
      attributes,
    };
    securityEvents.push(event);
    emit({ type: 'security.event', data: structuredClone(event) });
  }

  function setAgentState(id: string, state: Agent['state'], reason: string | null, at = Date.now()) {
    const agent = agents.get(id);
    if (!agent) return undefined;
    agent.state = state;
    agent.state_reason = reason;
    agent.state_changed_at = new Date(at).toISOString();
    emit({
      type: 'agent.state_changed',
      data: { agent_id: id, state, reason: reason ?? '', occurred_at: agent.state_changed_at },
    });
    return structuredClone(agent);
  }

  function summary(trace: Trace): ActionSummary {
    const { spans: _spans, execution_context: _context, ...rest } = trace;
    return structuredClone(rest);
  }

  function backgroundPlan(): ActionPlan {
    const weighted = [
      'invoice-assistant', 'invoice-assistant', 'invoice-assistant',
      'support-triage', 'support-triage', 'support-triage',
      'research-agent', 'research-agent', 'ops-runner', 'report-bot',
    ] as const;
    const agentId = pick(weighted);
    const customer = (): Resource => ({ type: 'customer', id: pick(CUSTOMERS), tier: 'internal' });
    const allow: Outcome = { kind: 'allow' };
    switch (agentId) {
      case 'invoice-assistant':
        return rng() < 0.6
          ? { agentId, capability: 'crm.read', resource: customer(), tool: TOOLS.crm, outcome: allow }
          : {
              agentId,
              capability: 'files.read',
              resource: { type: 'file', id: `invoices/INV-2026-${1000 + Math.floor(rng() * 900)}.pdf`, tier: 'internal' },
              tool: TOOLS.files,
              outcome: allow,
            };
      case 'support-triage': {
        const ticket: Resource = { type: 'ticket', id: `T-${4400 + Math.floor(rng() * 90)}`, tier: 'internal' };
        const r = rng();
        if (r < 0.45) return { agentId, capability: 'tickets.read', resource: ticket, tool: TOOLS.tickets, outcome: allow };
        if (r < 0.8) return { agentId, capability: 'tickets.write', resource: ticket, tool: TOOLS.tickets, outcome: allow };
        return { agentId, capability: 'crm.read', resource: customer(), tool: TOOLS.crm, outcome: allow };
      }
      case 'research-agent':
        return rng() < 0.7
          ? { agentId, capability: 'llm.complete', resource: { type: 'model', id: 'mock-llm', tier: 'public' }, tool: TOOLS.llm, outcome: allow }
          : { agentId, capability: 'files.read', resource: { type: 'file', id: 'market/benchmarks-q3.pdf', tier: 'public' }, tool: TOOLS.files, outcome: allow };
      case 'ops-runner':
        return {
          agentId,
          capability: 'shell.exec',
          resource: { type: 'command', id: pick(['deploy-service billing', 'tail-logs billing', 'restart-service invoices']), tier: 'internal' },
          tool: TOOLS.shell,
          outcome: allow,
        };
      case 'report-bot':
        return rng() < 0.7
          ? { agentId, capability: 'crm.read', resource: customer(), tool: TOOLS.crm, outcome: allow }
          : { agentId, capability: 'llm.complete', resource: { type: 'model', id: 'mock-llm', tier: 'internal' }, tool: TOOLS.llm, outcome: allow };
    }
  }

  function scheduleBackground() {
    backgroundTimer = setTimeout(() => {
      const plan = backgroundPlan();
      if (agents.get(plan.agentId)?.state === 'active') perform(plan);
      scheduleBackground();
    }, (minEvery + rng() * (maxEvery - minEvery)) * timeScale);
  }

  function launch(scenarioId: string): string | undefined {
    const script = SCENARIOS.find((s) => s.id === scenarioId);
    if (!script) return undefined;
    const runId = `run-${hex(12)}`;
    const run: ScenarioRun = {
      run_id: runId,
      scenario_id: script.id,
      status: script.steps.length ? 'running' : 'passed',
      steps: script.steps.map((step, i) => ({
        step_id: `${script.id}.s${i + 1}`,
        n: 1,
        trace_id: null,
        expected_decision: step.expected,
        actual_decision: null,
        control_ids: [],
        ok: null,
      })),
    };
    runs.set(runId, run);
    let delay = 0;
    script.steps.forEach((step, i) => {
      delay += step.delayMs;
      schedule(delay, () => {
        const trace = perform(step.plan);
        const runStep = run.steps[i];
        runStep.trace_id = trace.trace_id;
        runStep.actual_decision = trace.decision;
        runStep.control_ids = trace.control_ids;
        runStep.ok = trace.decision === step.expected;
        if (i === script.steps.length - 1) {
          run.status = run.steps.every((s) => s.ok) ? 'passed' : 'failed';
        }
      });
    });
    return runId;
  }

  function scenarios(): Scenario[] {
    return SCENARIOS.map((s) => ({
      id: s.id,
      act: s.act,
      title: s.title,
      asi: s.asi,
      summary: s.title,
      steps: s.steps.map((step, i) => ({
        step_id: `${s.id}.s${i + 1}`,
        kind: step.plan.message ? 'agent_message' : 'action',
        repeat: 1,
        narration: '',
        agent: step.plan.agentId,
        human: seeds.get(step.plan.agentId)?.human.display_name ?? '',
        capability: step.plan.capability,
        resource: `${step.plan.resource.type}:${step.plan.resource.id}`,
        expected_decision: step.expected,
      })),
    }));
  }

  function coverage(): Coverage[] {
    return Object.entries(ASI_TITLES).map(([asiId, name]) => {
      const controls = CONTROLS.filter((c) => c.asi.includes(asiId));
      const primitiveIds = new Set(controls.map((c) => c.primitive));
      const counts = evidence.get(asiId) ?? emptyCounts();
      return {
        asi_id: asiId,
        name,
        primitives: PRIMITIVES.filter((p) => primitiveIds.has(p.id)),
        controls: structuredClone(controls),
        evidence_count: counts.allow + counts.deny + counts.require_approval + counts.require_step_up,
        decision_counts: { ...counts },
      };
    });
  }

  function summaryCounts() {
    const now = Date.now();
    const recent = feed
      .map((id) => records.get(id)?.trace)
      .filter((t): t is Trace => Boolean(t) && now - Date.parse(t!.occurred_at) <= 15 * 60_000);
    const stage_counts: Record<string, number> = {};
    for (const t of recent) for (const s of t.spans) stage_counts[s.stage] = (stage_counts[s.stage] ?? 0) + 1;
    return {
      agents_active: [...agents.values()].filter((a) => a.state === 'active').length,
      actions_last_15m: recent.length,
      denied_last_15m: recent.filter((t) => t.decision === 'deny').length,
      awaiting_human: [...records.values()].filter((r) => r.trace.approval_state === 'pending').length,
      stage_counts,
    };
  }

  function resetAgents() {
    const now = Date.now();
    for (const seed of AGENTS) agents.set(seed.id, buildAgent(seed, now));
  }

  resetAgents();

  return {
    start() {
      const now = Date.now();
      const backfill = options.backfill ?? 40;
      for (let i = backfill; i > 0; i--) perform(backgroundPlan(), now - i * ((15 * 60_000) / backfill), true);
      evidence.clear();
      scheduleBackground();
    },
    stop() {
      clearTimeout(backgroundTimer);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
    subscribe(listener: (e: LoggedEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Events after a cursor; without one, the latest 100, as the Gateway does (contracts/events.md). */
    eventsAfter(id: number | null) {
      return id == null ? log.slice(-100) : log.filter((e) => e.id > id);
    },
    agents: () => [...agents.values()].map((a) => structuredClone(a)),
    traces(limit = 100): ActionSummary[] {
      const out: ActionSummary[] = [];
      for (let i = feed.length - 1; i >= 0 && out.length < limit; i--) {
        const r = records.get(feed[i]);
        if (r) out.push(summary(r.trace));
      }
      return out;
    },
    trace: (id: string) => {
      const r = records.get(id);
      return r ? structuredClone(r.trace) : undefined;
    },
    approvals: () =>
      [...records.values()].flatMap((r) => (r.approval ? [structuredClone(r.approval)] : [])),
    messages: () => structuredClone(messages),
    securityEvents: () => structuredClone(securityEvents),
    summary: summaryCounts,
    release(agentId: string) {
      const agent = agents.get(agentId);
      if (!agent) return undefined;
      breakerTripped.delete(agentId);
      return agent.state === 'active' ? structuredClone(agent) : setAgentState(agentId, 'active', null);
    },
    coverage,
    scenarios,
    launch,
    run: (id: string) => {
      const r = runs.get(id);
      return r ? structuredClone(r) : undefined;
    },
    reset() {
      for (const agent of agents.values()) {
        if (agent.state !== 'active') setAgentState(agent.id, 'active', null);
      }
      breakerTripped.clear();
      emit({
        type: 'tool.descriptor_changed',
        data: { connector_id: 'mcp', tool: 'payments', pinned_hash: 'sha256:9f2c..e1', observed_hash: 'sha256:9f2c..e1', status: 'restored' },
      });
      evidence.clear();
    },
    /** For the Approvals mock: resolves the approval as a human would, emitting action.updated. */
    resolveApproval(approvalId: string, state: 'approved' | 'rejected') {
      const r = [...records.values()].find((x) => x.approval?.id === approvalId);
      if (!r?.approval || r.approval.state !== 'pending') return undefined;
      resolve(r.trace.trace_id, state);
      return structuredClone(r.approval);
    },
    approval(approvalId: string) {
      const r = [...records.values()].find((x) => x.approval?.id === approvalId);
      return r?.approval ? structuredClone(r.approval) : undefined;
    },
    setAgentState,
    perform,
  };
}

export type MockWorld = ReturnType<typeof createMockWorld>;
