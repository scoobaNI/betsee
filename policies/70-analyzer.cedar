// AI security analysis may only tighten (CTL-AI-001). Only forbid policies read context.analysis;
// a permit that reads it is a review blocker. The Gateway also composes the analyzed decision with
// the deterministic one by taking the stricter (see the ADR).

@id("analyzer-malicious")
@reason("semantic analysis judged the request malicious")
@control("CTL-AI-001")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when { context has analysis && context.analysis.verdict == "malicious" };

@id("analyzer-suspicious")
@reason("semantic analysis found instructions inside the request's data; a person must look first")
@control("CTL-AI-001")
@outcome("require_approval")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when { context has analysis && context.analysis.verdict == "suspicious" }
unless { context.approval.granted };
