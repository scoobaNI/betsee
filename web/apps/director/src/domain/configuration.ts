import type { AgentSession, UseCase } from '@betsee/api';

export interface CapabilityRule {
  capability: string;
  approval: boolean;
  stepUp: boolean;
}

/** What a use case permits, each capability with the human checks it carries, in the Gateway's order. */
export function capabilityRules(useCase: Pick<UseCase, 'permitted' | 'approval_required' | 'step_up_required'>): CapabilityRule[] {
  const approval = new Set(useCase.approval_required);
  const stepUp = new Set(useCase.step_up_required);
  return useCase.permitted.map((capability) => ({ capability, approval: approval.has(capability), stepUp: stepUp.has(capability) }));
}

export interface Delegation {
  /** Delegated and permitted by the use case: what the agent can actually ask for. */
  effective: string[];
  /** Delegated by the person but outside the use case: the Gateway denies these (CTL-CAP-001). */
  blocked: string[];
}

/** A session's delegation split by what the Gateway resolved as effective. */
export function delegationOf(session: Pick<AgentSession, 'delegated' | 'effective'>): Delegation {
  const effective = new Set(session.effective);
  return {
    effective: session.delegated.filter((c) => effective.has(c)),
    blocked: session.delegated.filter((c) => !effective.has(c)),
  };
}
