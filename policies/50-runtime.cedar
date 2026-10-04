@id("forbid-budget-exceeded")
@reason("this action would exceed the session budget")
@control("CTL-RUN-001")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when { context.session.spentCents + context.costCents > context.session.budgetCents };

@id("forbid-token-budget-exceeded")
@reason("this model call could exceed the session's token budget")
@control("CTL-RUN-005")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when {
  context has tokens &&
  context.session has tokenBudget &&
  context.session has tokensUsed &&
  context.session.tokensUsed + context.tokens > context.session.tokenBudget
};

@id("forbid-rate-exceeded")
@reason("the agent exceeded the action rate allowed for {useCase}")
@control("CTL-RUN-002")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when { context.actionsLastMinute > context.session.useCase.maxActionsPerMinute };
