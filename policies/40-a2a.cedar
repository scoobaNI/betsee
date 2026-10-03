// Agent-to-agent messages are actions of the sender, mediated by the Gateway.

@id("forbid-a2a-peer-not-allowed")
@reason("messages to {receiver} are not allowed in {useCase}")
@control("CTL-A2A-001")
forbid (
  principal,
  action == Betsee::Action::"agent.message",
  resource is Betsee::Agent
)
unless { context.session.useCase.peers.contains(resource) };

@id("forbid-a2a-receiver-not-active")
@reason("{receiver} is quarantined or suspended")
@control("CTL-A2A-001")
forbid (
  principal,
  action == Betsee::Action::"agent.message",
  resource is Betsee::Agent
)
unless { resource.state == "active" };

@id("forbid-a2a-receiver-below-session-taint")
@reason("{receiver} is cleared below the {session.taint} data this session holds")
@control("CTL-A2A-002")
forbid (
  principal,
  action == Betsee::Action::"agent.message",
  resource is Betsee::Agent
)
when { resource.clearance < context.session.taint };

// A message is not a delegation: the sender cannot ask for a capability outside its own
// effective capability set.
@id("forbid-a2a-capability-escalation")
@reason("the message asks for a capability the sender does not hold, and a message is not a delegation")
@control("CTL-A2A-003")
forbid (principal, action == Betsee::Action::"agent.message", resource)
unless {
  context has requestedCapability &&
  context.session.delegated.contains(context.requestedCapability) &&
  context.session.useCase.permitted.contains(context.requestedCapability)
};
