import type { components } from './schema.ts';

type Schemas = components['schemas'];

export type Decision = Schemas['Decision'];
export type Tier = Schemas['Tier'];
export type ApprovalState = Schemas['ApprovalState'];
export type Budget = Schemas['Budget'];
export type Human = Schemas['Human'];
export type AgentRef = Schemas['AgentRef'];
export type UseCaseRef = Schemas['UseCaseRef'];
export type Resource = Schemas['Resource'];
export type ToolRef = Schemas['ToolRef'];
export type Analyzer = Schemas['Analyzer'];
export type AnalyzerVerdict = Analyzer['verdict'];
export type ActionSummary = Schemas['ActionSummary'];
export type Span = Schemas['Span'];
export type StageId = Span['stage'];
export type SpanStatus = Span['status'];
export type Trace = Schemas['Trace'];
export type AgentSession = Schemas['AgentSession'];
export type Agent = Schemas['Agent'];
export type LifecycleState = Agent['state'];
export type UseCase = Schemas['UseCase'];
export type Approval = Schemas['Approval'];
export type Primitive = Schemas['Primitive'];
export type Control = Schemas['Control'];
export type Policy = Schemas['Policy'];
export type Connector = Schemas['Connector'];
export type AgentMessage = Schemas['AgentMessage'];
export type Coverage = Schemas['Coverage'];
export type Me = Schemas['Me'];
export type ApiError = Schemas['Error'];
export type AgentStateChanged = Schemas['AgentStateChanged'];
export type Summary = Schemas['Summary'];
export type SecurityEvent = Schemas['SecurityEvent'];
export type ToolDescriptorChanged = Schemas['ToolDescriptorChanged'];

export interface ListOf<T> {
  items: T[];
}

export type StreamEvent =
  | { type: 'action.decided'; data: ActionSummary }
  | { type: 'action.updated'; data: ActionSummary }
  | { type: 'agent.state_changed'; data: AgentStateChanged }
  | { type: 'message.mediated'; data: AgentMessage }
  | { type: 'session.started'; data: AgentSession }
  | { type: 'session.ended'; data: AgentSession }
  | { type: 'tool.descriptor_changed'; data: ToolDescriptorChanged }
  | { type: 'security.event'; data: SecurityEvent };

export type StreamEventType = StreamEvent['type'];

// Demo runner (security-architect's demo-runner service, board posts p-47 and p-114). It is not
// part of the Gateway contract; Caddy routes /api/v1/demo/* to it.
export interface ScenarioStep {
  step_id: string;
  kind: 'action' | 'agent_message' | 'await_human' | 'tool_drift' | (string & {});
  agent: string;
  human: string;
  capability: string;
  resource: string;
  repeat: number;
  expected_decision: Decision;
  narration: string;
}

export interface Scenario {
  id: string;
  act: number;
  title: string;
  asi: string[];
  summary: string;
  steps: ScenarioStep[];
}

export interface ScenarioRunStep {
  step_id: string;
  /** Repetition number for steps that repeat (bursts, retries). */
  n: number;
  trace_id: string | null;
  expected_decision: Decision;
  actual_decision: Decision | null;
  control_ids: string[];
  ok: boolean | null;
  error?: string;
}

export interface ScenarioRun {
  run_id: string;
  scenario_id: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  steps: ScenarioRunStep[];
}

export interface DemoReset {
  reset_at: string;
  results: unknown[];
}
