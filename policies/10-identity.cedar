// Decision D1: an agent acts only inside an AgentSession a human created for that same agent.

@id("forbid-session-not-bound-to-agent")
@control("CTL-ID-001")
forbid (principal, action in Betsee::Action::"agent_action", resource)
unless { context.session.agent == principal };

@id("forbid-agent-not-active")
@control("CTL-ID-002")
forbid (principal is Betsee::Agent, action in Betsee::Action::"agent_action", resource)
unless { principal.state == "active" };

@id("forbid-session-not-active")
@control("CTL-ID-003")
forbid (principal, action in Betsee::Action::"agent_action", resource)
unless {
  context.session.status == "active" &&
  context.now < context.session.expiresAt
};

@id("forbid-session-human-not-active")
@control("CTL-ID-004")
forbid (principal, action in Betsee::Action::"agent_action", resource)
unless { context.session.human.active };
