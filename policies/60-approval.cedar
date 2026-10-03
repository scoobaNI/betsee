// Obligations. A forbid annotated @outcome is lifted by an approval of this exact ActionRequest;
// the Gateway turns it into require_approval / require_step_up instead of deny (see the ADR,
// "Mapping Cedar to Betsee decisions"). A forbid without @outcome is a hard deny.

@id("approval-required-by-use-case")
@reason("approval is required for {capability} in {useCase}")
@control("CTL-APR-001")
@outcome("require_approval")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when { context.session.useCase.approvalRequired.contains(context.capability) }
unless { context.approval.granted };

@id("step-up-required-by-use-case")
@reason("{capability} in {useCase} needs an approver with a fresh OTP")
@control("CTL-APR-002")
@outcome("require_step_up")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when { context.session.useCase.stepUpRequired.contains(context.capability) }
unless { context.approval.stepUp };

@id("forbid-payment-without-amount")
@reason("the transfer request carries no valid amount")
@control("CTL-APR-003")
forbid (principal, action == Betsee::Action::"payments.transfer", resource)
unless { context has amountCents && context.amountCents > 0 };

@id("approval-payment-above-threshold")
@reason("the transfer of {amount} is above the {threshold} approval threshold")
@control("CTL-APR-003")
@outcome("require_approval")
forbid (principal, action == Betsee::Action::"payments.transfer", resource)
when {
  context has amountCents &&
  context.amountCents > context.session.useCase.approvalThresholdCents
}
unless { context.approval.granted };

@id("step-up-payment-above-threshold")
@reason("a transfer above {threshold} needs an approver with a fresh OTP")
@control("CTL-APR-003")
@outcome("require_step_up")
forbid (principal, action == Betsee::Action::"payments.transfer", resource)
when {
  context has amountCents &&
  context.amountCents > context.session.useCase.approvalThresholdCents
}
unless { context.approval.stepUp };

// After a session ingested untrusted content (an inbound ticket, another agent's message), a
// high-impact action needs a human.
@id("approval-high-impact-after-untrusted-input")
@reason("the session has read untrusted input, so {capability} needs a human")
@control("CTL-PROV-001")
@outcome("require_approval")
forbid (principal, action in Betsee::Action::"high_impact", resource)
when { context.session.untrustedInput }
unless { context.approval.granted };
