// Files crossing the agent workspace boundary (CTL-FILE-001). The Gateway scans every file from its
// bytes and passes the detected classes; Cedar decides. An upload lands in a catalogued folder of
// the agent runtime; a release hands a catalogued workspace file to the session's human.

@id("permit-file-transfer-by-session-human")
@reason("the file passed the Betsee file scan for {useCase}")
@control("CTL-FILE-001")
permit (
  principal is Betsee::Human,
  action in Betsee::Action::"file_transfer",
  resource is Betsee::Resource
)
when {
  context.session.human == principal &&
  resource in Betsee::Connector::"agent-runtime"
};

@id("forbid-file-not-session-human")
@reason("only the human who started this session can move files in or out of its workspace")
@control("CTL-FILE-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
unless { context.session.human == principal };

@id("forbid-file-outside-agent-runtime")
@reason("files move only in and out of the agent runtime workspace")
@control("CTL-FILE-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource is Betsee::Resource)
unless { resource in Betsee::Connector::"agent-runtime" };

@id("forbid-file-session-not-active")
@reason("the session is closed, revoked or expired")
@control("CTL-ID-003")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
unless {
  context.session.status == "active" &&
  context.now < context.session.expiresAt
};

@id("forbid-file-above-session-tier")
@reason("the file is labelled above the session ceiling of {session.tierCeiling}")
@control("CTL-TIER-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.tier > context.session.tierCeiling };

@id("forbid-file-payment-card")
@reason("the file contains a payment card number")
@control("CTL-IN-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("payment_card") };

@id("forbid-file-iban")
@reason("the file contains a bank account number (IBAN)")
@control("CTL-IN-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("iban") };

@id("forbid-file-pesel")
@reason("the file contains a PESEL national identification number")
@control("CTL-IN-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("pesel") };

@id("forbid-file-secret")
@reason("the file contains an API key or a private key")
@control("CTL-IN-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("secret") };

@id("forbid-file-resource-above-tier")
@reason("the file names a resource above the session ceiling of {session.tierCeiling}")
@control("CTL-IN-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("resource_above_tier") };

@id("forbid-file-executable")
@reason("the file is an executable or a script")
@control("CTL-FILE-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("executable") };

@id("forbid-file-malware-test")
@reason("the file carries the EICAR anti-malware test signature")
@control("CTL-FILE-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("malware_test") };

@id("forbid-file-unscannable")
@reason("the file has no text Betsee can scan, so it cannot be checked")
@control("CTL-FILE-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("unscannable") };

@id("forbid-file-type-not-allowed")
@reason("Betsee accepts text, PDF, Word and Excel files only")
@control("CTL-FILE-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("type_not_allowed") };

@id("forbid-file-oversize")
@reason("the file is larger than the 8 MiB Betsee scans")
@control("CTL-FILE-001")
forbid (principal, action in Betsee::Action::"file_transfer", resource)
when { context.detected.contains("oversize") };
