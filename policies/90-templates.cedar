// Templates are how scope-based controls attach to a team or an agent: the Gateway links the
// template with ?principal = Betsee::Team::"<id>" or Betsee::Agent::"<id>" and stores the link
// (control attachment) in PostgreSQL.

@id("tpl-suspend-high-impact")
@reason("high-impact capabilities are suspended for this team or agent")
@control("CTL-RUN-004")
forbid (principal in ?principal, action in Betsee::Action::"high_impact", resource);
