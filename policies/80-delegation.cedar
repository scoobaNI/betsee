// session.create: a human delegates to an agent only capabilities the human holds and the use case
// permits, at a tier no higher than the human's clearance, the use case ceiling or the agent's
// clearance (CTL-DEL-001, CTL-DEL-002).

@id("permit-session-delegation-within-entitlements")
@control("CTL-DEL-001")
permit (
  principal is Betsee::Human,
  action == Betsee::Action::"session.create",
  resource is Betsee::Agent
)
when {
  principal.active &&
  principal.entitlements.containsAll(context.delegated) &&
  context.useCase.permitted.containsAll(context.delegated)
};

@id("forbid-session-tier-above-ceiling")
@control("CTL-DEL-002")
forbid (
  principal is Betsee::Human,
  action == Betsee::Action::"session.create",
  resource is Betsee::Agent
)
when {
  context.tierCeiling > principal.clearance ||
  context.tierCeiling > context.useCase.tierCeiling ||
  context.tierCeiling > resource.clearance
};

@id("forbid-session-agent-not-registered-for-use-case")
@control("CTL-DEL-003")
forbid (principal, action == Betsee::Action::"session.create", resource is Betsee::Agent)
unless { context.useCase.agents.contains(resource) };

@id("forbid-session-for-inactive-agent")
@control("CTL-ID-002")
forbid (principal, action == Betsee::Action::"session.create", resource is Betsee::Agent)
unless { resource.state == "active" };

// Mirrors of the permit so a refused delegation names the side that failed.
@id("forbid-session-delegation-exceeds-human-entitlements")
@control("CTL-DEL-001")
forbid (principal is Betsee::Human, action == Betsee::Action::"session.create", resource)
unless { principal.entitlements.containsAll(context.delegated) };

@id("forbid-session-delegation-exceeds-use-case")
@control("CTL-DEL-001")
forbid (principal, action == Betsee::Action::"session.create", resource)
unless { context.useCase.permitted.containsAll(context.delegated) };

@id("forbid-session-create-human-not-active")
@control("CTL-ID-004")
forbid (principal is Betsee::Human, action == Betsee::Action::"session.create", resource)
unless { principal.active };
