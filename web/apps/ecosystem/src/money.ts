export function centsLabel(cents: number, currency = "EUR"): string {
  if (!Number.isSafeInteger(cents)) return "Amount unavailable";
  const integer = Math.trunc(Math.abs(cents) / 100);
  const fraction = String(Math.abs(cents) % 100).padStart(2, "0");
  const grouped = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(integer);
  return `${cents < 0 ? "-" : ""}${grouped}.${fraction} ${currency}`;
}
