// Delegated execution (CTL-RT-001). For the agent-runtime connector the Gateway decides and audits
// every tool call, and the runtime (Claude Code under its PreToolUse hook) executes after allow.
// The Gateway sets context.runtime itself, from the resource's catalogue position.

@id("forbid-delegated-execution-mismatch")
@reason("delegated execution applies only to resources the agent runtime reaches")
@control("CTL-RT-001")
forbid (
  principal,
  action in Betsee::Action::"agent_action",
  resource is Betsee::Resource
)
when { (context has runtime) != (resource in Betsee::Connector::"agent-runtime") };

@id("forbid-agent-runtime-egress")
@reason("the agent runtime has no network egress, so {capability} is denied")
@control("CTL-RT-001")
forbid (principal, action in Betsee::Action::"egress", resource)
when { context has runtime };

@id("forbid-runtime-unmapped-tool")
@reason("this runtime tool maps to no Betsee capability, so it is denied by default")
@control("CTL-RT-001")
forbid (principal, action == Betsee::Action::"runtime.unmapped", resource);

// A command or a folder search can read more than its named resource; the Gateway resolves that
// scope to the highest tier it covers.
@id("forbid-scope-above-session-tier")
@reason("the request reads {scope.tier} content, the session ceiling is {session.tierCeiling}")
@control("CTL-TIER-001")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when { context has scopeTier && context.scopeTier > context.session.tierCeiling };
