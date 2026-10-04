from dataclasses import dataclass


@dataclass(frozen=True)
class Case:
    id: str
    asi: tuple[str, ...]
    outcomes: tuple[str, ...]
    title: str
    pending: str
    controls: tuple[str, ...] = ()


CASES = (
    Case("allowed_read", ("ASI02",), ("allow",), "Delegated CRM read executes", "F08/F09: action and audit contract"),
    Case("allowed_mcp", ("ASI02", "ASI04"), ("allow",), "Pinned MCP tool executes", "F12: real MCP connector"),
    Case("allowed_llm", ("ASI01",), ("allow",), "OpenAI-compatible HTTP connector executes", "F12: mock-llm service behind real HTTP adapter"),
    Case("capability_not_delegated", ("ASI02", "ASI03"), ("deny",), "Agent exceeds delegated capability", "F09: delegation intersection", ("CTL-CAP-001",)),
    Case("use_case_ceiling", ("ASI02",), ("reject",), "Human cannot delegate outside use-case capability ceiling", "F09: session creation controls"),
    Case("privileged_human_agent", ("ASI03",), ("deny",), "Maya's agent cannot inherit Maya's HR access", "F09: privileged-human seed and independent agent session", ("CTL-CAP-001",)),
    Case("human_via_agent", ("ASI03",), ("reject",), "Human cannot delegate a capability only the agent holds", "F09: human entitlement ceiling on session creation"),
    Case("human_direct_action", ("ASI03",), ("reject",), "Human token cannot impersonate an agent action", "F06/F08: separate principal types"),
    Case("information_tier", ("ASI02", "ASI03"), ("deny",), "Resource tier exceeds session ceiling", "F09: tier controls", ("CTL-TIER-001",)),
    Case("no_write_down", ("ASI01", "ASI06"), ("allow", "deny"), "Reading confidential data prevents public egress", "F09: session taint persists across actions", ("CTL-TIER-002",)),
    Case("catalog_taint", ("ASI02", "ASI06"), ("allow", "deny"), "Read taint uses the catalog tier despite a false connector label", "D9: isolated MCP output-tier mutation fixture", ("CTL-TIER-002",)),
    Case("a2a_receiver_taint", ("ASI06", "ASI07"), ("allow", "allow", "allow", "deny"), "An allowed message taints the receiver's session before egress", "D9: permitted peer fixture and independently active receiver session", ("CTL-TIER-002",)),
    Case("unsafe_command", ("ASI05",), ("deny",), "Command outside validated templates is blocked", "F09/F12: ops-runner command validation", ("CTL-EXEC-001",)),
    Case("analyzer_cannot_loosen", ("ASI01", "ASI06"), ("deny",), "Deterministic deny survives the analyzer stage", "F10: live analyzer skipped on hard deny; clean-verdict relaxation checked in pure crate", ("CTL-CAP-001",)),
    Case("analyzer_tightens", ("ASI01", "ASI06"), ("require_approval",), "Mock analyzer tightens allowed poisoned memory write", "F10: suspicious mock verdict and labelled trace", ("CTL-AI-001",)),
    Case("a2a_not_delegated", ("ASI07",), ("deny",), "A2A requires delegated agent.message", "F11: mediated messages", ("CTL-CAP-001",)),
    Case("a2a_untrusted_escalation", ("ASI07", "ASI08"), ("deny",), "Untrusted research-agent message cannot delegate payments", "F11: requested-capability provenance", ("CTL-A2A-003",)),
    Case("cascade_breaker", ("ASI08",), ("deny",), "Repeated messages trip the cascade breaker", "F11: isolated rate-limited session", ("CTL-RUN-002",)),
    Case("descriptor_drift", ("ASI04",), ("deny",), "Actual MCP descriptor differs from pinned hash", "F12/F14: controlled server descriptor mutation", ("CTL-TOOL-001",)),
    Case("approval_bypass", ("ASI09", "ASI03"), ("require_approval",), "48,000 EUR transfer cannot self-approve", "F13: approval is server-owned", ("CTL-APR-003",)),
    Case("step_up_bypass", ("ASI09", "ASI03"), ("require_approval", "step_up_required"), "Level-1 approver cannot execute a transfer that requires fresh OTP", "F07/F13: trusted step-up assertion", ("CTL-APR-003",)),
    Case("approved_transfer", ("ASI09", "ASI03"), ("require_approval", "step_up_required", "allow"), "Exact transfer executes only after approval and step-up", "F07/F13: Daniel approval and real Keycloak TOTP"),
    Case("approval_parameter_binding", ("ASI09",), ("require_approval", "step_up_required", "allow", "require_approval"), "Approval of one transfer cannot authorize changed parameters", "F13: approval bound to exact action"),
    Case("demo_runner_no_approval", ("ASI03", "ASI09"), ("reject",), "Demo-runner human token cannot approve transfers", "D7/F13: direct grant confined to session creation and demo endpoints"),
    Case("demo_runner_no_admin_write", ("ASI03",), ("reject",), "Demo-runner admin human token cannot change controls", "D7a/F09: direct-grant read access never enables admin writes"),
    Case("quarantined_agent", ("ASI10",), ("deny",), "Quarantined report-bot cannot act", "F09/F14: isolated quarantined agent", ("CTL-ID-002",)),
    Case("budget_exceeded", ("ASI10",), ("deny",), "Action over remaining session budget is blocked", "F09: server-owned budget accounting", ("CTL-RUN-001",)),
    Case("forged_session", ("ASI03",), ("deny",), "Nonexistent AgentSession is rejected", "F08: session lookup and identity binding", ("CTL-ID-001",)),
    Case("foreign_session", ("ASI03",), ("deny",), "Agent token cannot use another agent's session", "F08: D1 agent/session binding", ("CTL-ID-001",)),
    Case("missing_token", ("ASI03",), ("unauthorized",), "Missing bearer token is rejected", "F06/F08: authentication middleware"),
    Case("cookie_cannot_authenticate", ("ASI03",), ("unauthorized",), "A valid session token in a cookie cannot authenticate a human route", "D9: bearer-only routes, including SSE"),
    Case("route_principal_matrix", ("ASI03",), ("matrix",), "Route principal and role refusals match the architect's matrix", "D9: docs/security/route-matrix.md plus browser Maya token"),
    Case("expired_token", ("ASI03",), ("unauthorized",), "Expired correctly signed token is rejected", "F06/F08: expired signed token fixture"),
    Case("wrong_audience", ("ASI03",), ("unauthorized",), "Valid token for a different audience is rejected", "F06/F08: wrong-audience signed token fixture"),
    Case("forged_token", ("ASI03",), ("unauthorized",), "Tampered token signature is rejected", "F06/F08: token signature verification"),
    Case("audit_correlation", tuple(f"ASI{i:02}" for i in range(1, 11)), ("allow", "deny"), "Allowed and denied actions have matching audited correlation IDs", "F08: persisted security-event listing"),
    Case("llm_allowlisted_model_priced", ("ASI02", "ASI08"), ("allow",), "Allowlisted model call is priced from its token usage", "CTL-MODEL-001/CTL-RUN-005: guardrails.yaml models and budgets"),
    Case("llm_model_not_allowlisted", ("ASI02", "ASI04"), ("deny",), "Model switched off in guardrails.yaml is refused before any token", "CTL-MODEL-001: model allowlist", ("CTL-MODEL-001",)),
    Case("llm_token_budget_exceeded", ("ASI08", "ASI10"), ("deny",), "Model call whose worst case exceeds the session token budget is refused", "CTL-RUN-005: token budget", ("CTL-RUN-005",)),
    Case("llm_output_redacted", ("ASI01", "ASI06"), ("allow",), "Personal data a model returns is redacted before the agent sees it", "CTL-OUT-002: output filter under the balanced profile"),
    Case("llm_prompt_redacted", ("ASI01", "ASI06"), ("allow",), "Personal data in an agent's prompt is redacted before the model sees it", "CTL-IN-002: agent-to-model redaction"),
    Case("llm_output_exfil_link_removed", ("ASI01", "ASI02"), ("allow",), "A data-carrying markdown image in model output is removed", "CTL-OUT-002/CTL-SIG-001: SIG-EXFIL-001"),
    Case("llm_prompt_injection_review", ("ASI01", "ASI06"), ("require_approval",), "Polish injection in a model prompt needs a person", "CTL-AI-002: in-Gateway classifier", ("CTL-AI-001",)),
    Case("exploit_signature_blocked", ("ASI05", "ASI04"), ("deny",), "Ray Jobs API payload (ShadowRay) in tool data is blocked", "CTL-SIG-001: SIG-RAY-001", ("CTL-SIG-001",)),
    Case("model_load_pinned_allowed", ("ASI04",), ("allow",), "Pinned safetensors model from a trusted publisher is admitted", "CTL-SUP-001: model supply chain"),
    Case("model_load_typosquat_denied", ("ASI04",), ("deny",), "Model from a typosquatted publisher is refused", "CTL-SUP-001: typosquat distance", ("CTL-SUP-001",)),
    Case("model_load_pickle_denied", ("ASI04", "ASI05"), ("deny",), "Model shipping pickle weights on a branch with remote code is refused", "CTL-SUP-001: unsafe format, unpinned, trust_remote_code", ("CTL-SUP-001",)),
    Case("model_load_known_bad_denied", ("ASI04",), ("deny",), "Repository on the threat feed is refused", "CTL-SUP-001/CTL-SIG-001: SIG-HUB-001", ("CTL-SUP-001",)),
    Case("trace_id_reused", ("ASI03", "ASI08"), ("allow", "allow"), "Reused traceparent mints a fresh trace without overwriting evidence", "F08/v0.1: caller_trace_id and trace_id_reused security event"),
)
