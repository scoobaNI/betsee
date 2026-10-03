export function approvalRequestReasons<T>(approval: {
  state: string;
  requested_reasons?: T[];
  action: { reasons: T[] };
}): T[] {
  return (
    approval.requested_reasons ??
    (approval.state === "pending" ? approval.action.reasons : [])
  );
}

export function gatewayField(
  provenance: Record<string, unknown>,
  field: string,
): boolean {
  const fields = provenance.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    return false;
  const entry = (fields as Record<string, unknown>)[field];
  return (
    entry === "gateway" ||
    (typeof entry === "object" &&
      entry !== null &&
      (entry as { source?: unknown }).source === "gateway")
  );
}

export function paymentAmount(
  parameters: Record<string, unknown>,
  provenance: Record<string, unknown>,
  gatewayFacts?: Record<string, unknown>,
): string | null {
  const resolved = gatewayFacts?.amount;
  const amount =
    resolved && typeof resolved === "object"
      ? (resolved as Record<string, unknown>)
      : undefined;
  const resolvedCents = amount?.cents ?? gatewayFacts?.amount_cents;
  const cents = resolvedCents ?? parameters.amount_cents;
  const currency = amount?.currency ?? gatewayFacts?.currency ?? "EUR";
  if (
    (resolvedCents === undefined &&
      !gatewayField(provenance, "amount_cents")) ||
    typeof cents !== "number" ||
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    typeof currency !== "string" ||
    currency !== "EUR"
  )
    return null;
  const major = Math.trunc(cents / 100);
  const minor = cents % 100;
  const grouped = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(major);
  return `${grouped}.${String(minor).padStart(2, "0")} ${currency}`;
}

export function unverifiedParameters(
  parameters: Record<string, unknown>,
  verifiedAmount: boolean,
): string[] {
  return Object.keys(parameters).filter(
    (key) => !verifiedAmount || key !== "amount_cents",
  );
}
