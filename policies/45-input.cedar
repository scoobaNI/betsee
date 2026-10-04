// Content filter on what people type (CTL-IN-001). The Gateway's detectors validate each match
// (Luhn, IBAN mod-97, PESEL checksum, key formats, catalogued resource names, email and phone
// formats) and pass the classes the use case's guardrail profile marks as blocking; Cedar decides.
// Classes the profile redacts are masked before the agent sees the text (CTL-IN-002). Semantic
// analysis may only add a deny.

@id("permit-input-from-session-human")
@reason("the message passed the input filter for {useCase}")
@control("CTL-IN-001")
permit (
  principal is Betsee::Human,
  action == Betsee::Action::"input.submit",
  resource is Betsee::AgentSession
)
when { resource.human == principal };

@id("forbid-input-not-session-human")
@reason("only the human who started this session can write to its agent")
@control("CTL-IN-001")
forbid (principal, action == Betsee::Action::"input.submit", resource is Betsee::AgentSession)
unless { resource.human == principal };

@id("forbid-input-session-not-active")
@reason("the session is closed, revoked or expired")
@control("CTL-ID-003")
forbid (principal, action == Betsee::Action::"input.submit", resource is Betsee::AgentSession)
unless { resource.status == "active" && context.now < resource.expiresAt };

@id("forbid-input-human-not-active")
@reason("the human is no longer active")
@control("CTL-ID-004")
forbid (principal is Betsee::Human, action == Betsee::Action::"input.submit", resource)
unless { principal.active };

@id("forbid-input-payment-card")
@reason("the message contains a payment card number")
@control("CTL-IN-001")
forbid (principal, action == Betsee::Action::"input.submit", resource)
when { context.detected.contains("payment_card") };

@id("forbid-input-iban")
@reason("the message contains a bank account number (IBAN)")
@control("CTL-IN-001")
forbid (principal, action == Betsee::Action::"input.submit", resource)
when { context.detected.contains("iban") };

@id("forbid-input-pesel")
@reason("the message contains a PESEL national identification number")
@control("CTL-IN-001")
forbid (principal, action == Betsee::Action::"input.submit", resource)
when { context.detected.contains("pesel") };

@id("forbid-input-secret")
@reason("the message contains an API key or a private key")
@control("CTL-IN-001")
forbid (principal, action == Betsee::Action::"input.submit", resource)
when { context.detected.contains("secret") };

@id("forbid-input-email")
@reason("the message contains an email address, which this use case's profile blocks")
@control("CTL-IN-001")
forbid (principal, action == Betsee::Action::"input.submit", resource)
when { context.detected.contains("email") };

@id("forbid-input-phone")
@reason("the message contains a phone number, which this use case's profile blocks")
@control("CTL-IN-001")
forbid (principal, action == Betsee::Action::"input.submit", resource)
when { context.detected.contains("phone") };

@id("forbid-input-resource-above-tier")
@reason("the message names a resource above the session ceiling of {session.tierCeiling}")
@control("CTL-IN-001")
forbid (principal, action == Betsee::Action::"input.submit", resource)
when { context.detected.contains("resource_above_tier") };

@id("analyzer-input-malicious")
@reason("semantic analysis judged the message an injection or jailbreak attempt")
@control("CTL-AI-001")
forbid (principal, action == Betsee::Action::"input.submit", resource)
when { context has analysis && context.analysis.verdict == "malicious" };
