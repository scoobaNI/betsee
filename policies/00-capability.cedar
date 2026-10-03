// Effective capability = AgentSession.delegated ∩ UseCase.permitted (CTL-CAP-001).
// This is the only permit for agent actions; every other agent policy is a forbid.
// The two forbids repeat the intersection so a deny names which side failed.

@id("permit-effective-capability")
@reason("{capability} is delegated in this session and permitted for {useCase}")
@control("CTL-CAP-001")
permit (
  principal is Betsee::Agent,
  action in Betsee::Action::"agent_action",
  resource
)
when {
  context.session.delegated.contains(context.capability) &&
  context.session.useCase.permitted.contains(context.capability)
};

@id("forbid-capability-not-delegated")
@reason("{capability} was not delegated to the agent in this session")
@control("CTL-CAP-001")
forbid (principal, action in Betsee::Action::"agent_action", resource)
unless { context.session.delegated.contains(context.capability) };

@id("forbid-capability-not-permitted-for-use-case")
@reason("organization policy does not permit {capability} for {useCase}")
@control("CTL-CAP-001")
forbid (principal, action in Betsee::Action::"agent_action", resource)
unless { context.session.useCase.permitted.contains(context.capability) };

// Fails closed if the Gateway ever builds a request whose action and capability disagree.
@id("forbid-capability-action-mismatch")
@reason("the requested action does not match the capability being checked")
@control("CTL-POL-002")
forbid (principal, action in Betsee::Action::"agent_action", resource)
unless {
  (action == Betsee::Action::"crm.read" && context.capability == Betsee::Capability::"crm.read") ||
  (action == Betsee::Action::"tickets.read" && context.capability == Betsee::Capability::"tickets.read") ||
  (action == Betsee::Action::"files.read" && context.capability == Betsee::Capability::"files.read") ||
  (action == Betsee::Action::"tickets.write" && context.capability == Betsee::Capability::"tickets.write") ||
  (action == Betsee::Action::"memory.write" && context.capability == Betsee::Capability::"memory.write") ||
  (action == Betsee::Action::"email.send" && context.capability == Betsee::Capability::"email.send") ||
  (action == Betsee::Action::"payments.transfer" && context.capability == Betsee::Capability::"payments.transfer") ||
  (action == Betsee::Action::"shell.exec" && context.capability == Betsee::Capability::"shell.exec") ||
  (action == Betsee::Action::"agent.message" && context.capability == Betsee::Capability::"agent.message") ||
  (action == Betsee::Action::"llm.complete" && context.capability == Betsee::Capability::"llm.complete")
};
