// Models: which ones an agent may call (CTL-MODEL-001) and which it may bring in (CTL-SUP-001).
// The allowlist and the supply-chain rules live in guardrails.yaml; the Gateway passes what it
// established and Cedar decides.

@id("forbid-model-not-allowlisted")
@reason("the model is not on the organization's model allowlist")
@control("CTL-MODEL-001")
forbid (principal, action == Betsee::Action::"llm.complete", resource)
when { context has modelAllowed && !context.modelAllowed };

@id("forbid-prompt-sensitive-data")
@reason("the prompt carries data this use case's profile does not let a model see")
@control("CTL-IN-001")
forbid (principal, action == Betsee::Action::"llm.complete", resource)
when { context has detected && !context.detected.isEmpty() };

@id("forbid-model-revision-not-pinned")
@reason("a model must be pinned to a full commit hash, not a branch or tag")
@control("CTL-SUP-001")
forbid (principal, action == Betsee::Action::"model.load", resource)
when { context has modelCheck && !context.modelCheck.pinned };

@id("forbid-model-remote-code")
@reason("loading a model must not run code from its repository (trust_remote_code)")
@control("CTL-SUP-001")
forbid (principal, action == Betsee::Action::"model.load", resource)
when { context has modelCheck && context.modelCheck.trustRemoteCode };

@id("forbid-model-unsafe-format")
@reason("the model ships weights in a format that can run code when loaded; use safetensors or GGUF")
@control("CTL-SUP-001")
forbid (principal, action == Betsee::Action::"model.load", resource)
when { context has modelCheck && context.modelCheck.unsafeFormat };

@id("forbid-model-org-typosquat")
@reason("the model's publisher name imitates a trusted publisher")
@control("CTL-SUP-001")
forbid (principal, action == Betsee::Action::"model.load", resource)
when { context has modelCheck && context.modelCheck.typosquat };

@id("forbid-model-org-not-allowed")
@reason("the model's publisher is not on the organization's list of trusted publishers")
@control("CTL-SUP-001")
forbid (principal, action == Betsee::Action::"model.load", resource)
when { context has modelCheck && !context.modelCheck.orgAllowed };

@id("forbid-model-known-bad")
@reason("the model repository is on the threat feed as malicious")
@control("CTL-SUP-001")
forbid (principal, action == Betsee::Action::"model.load", resource)
when { context has modelCheck && context.modelCheck.knownBad };

@id("forbid-model-load-without-check")
@reason("the Gateway could not check this model request")
@control("CTL-SUP-001")
forbid (principal, action == Betsee::Action::"model.load", resource)
unless { context has modelCheck };
