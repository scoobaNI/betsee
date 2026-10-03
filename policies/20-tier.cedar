// InformationTier ranks: 0 public, 1 internal, 2 confidential, 3 restricted.

@id("forbid-resource-above-session-tier")
@reason("the resource is {resource.tier}, the session ceiling is {session.tierCeiling}")
@control("CTL-TIER-001")
forbid (
  principal,
  action in Betsee::Action::"agent_action",
  resource is Betsee::Resource
)
when { resource.tier > context.session.tierCeiling };

// No write-down: once a session has read data at tier T, it may not write or send to a
// destination labelled below T. session.taint is the highest tier read so far.
@id("forbid-write-down")
@reason("the session has read {session.taint} data and the destination is {recipient.tier}")
@control("CTL-TIER-002")
forbid (
  principal,
  action in [Betsee::Action::"write", Betsee::Action::"egress"],
  resource is Betsee::Resource
)
when { resource.tier < context.session.taint };

@id("forbid-model-below-session-taint")
@reason("the session holds {session.taint} data, above this model's clearance")
@control("CTL-TIER-003")
forbid (
  principal,
  action == Betsee::Action::"llm.complete",
  resource is Betsee::Model
)
when { resource.maxTier < context.session.taint };
