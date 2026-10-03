// Every MCP tool call names the tool it goes through and the descriptor hash the Gateway observes
// now; a descriptor that differs from the pinned one blocks the call (rug pull, tool poisoning).

@id("forbid-mcp-call-without-tool")
@reason("the call does not name a pinned MCP tool")
@control("CTL-TOOL-001")
forbid (principal, action in Betsee::Action::"mcp", resource)
unless { context has toolCall };

@id("forbid-tool-descriptor-drift")
@reason("the descriptor of {tool} no longer matches its reviewed pin")
@control("CTL-TOOL-001")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when {
  context has toolCall &&
  context.toolCall.tool.pinnedDescriptorHash != context.toolCall.observedDescriptorHash
};

@id("forbid-command-not-validated")
@reason("the command matches no validated template")
@control("CTL-EXEC-001")
forbid (principal, action == Betsee::Action::"shell.exec", resource)
unless { context has command && context.command.valid };
