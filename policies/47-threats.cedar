// Known-exploit signatures (CTL-SIG-001). The Gateway matches the request, the message or the file
// against the baseline signatures and the external threat feed and passes whether a blocking or a
// reviewing signature matched; the signature ids and references are in the trace.

@id("forbid-known-exploit-signature")
@reason("the request matches a signature of a known exploit")
@control("CTL-SIG-001")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when { context has threat && context.threat.block };

@id("review-exploit-signature")
@reason("the request matches a signature that needs a person to review it")
@control("CTL-SIG-001")
@outcome("require_approval")
forbid (principal, action in Betsee::Action::"agent_action", resource)
when { context has threat && context.threat.review }
unless { context.approval.granted };

@id("forbid-input-exploit-signature")
@reason("the message matches a signature of a known exploit")
@control("CTL-SIG-001")
forbid (principal, action == Betsee::Action::"input.submit", resource)
when { context has threat && context.threat.block };

@id("forbid-file-exploit-signature")
@reason("the file matches a signature of a known exploit")
@control("CTL-SIG-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context has threat && context.threat.block };

@id("forbid-file-unsafe-deserialization")
@reason("the file is a pickle that would run code when loaded")
@control("CTL-FILE-002")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("unsafe_deserialization") };

@id("forbid-file-model-code-execution")
@reason("the file is a model whose metadata or layers would run code when loaded")
@control("CTL-FILE-002")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("model_code_execution") };
