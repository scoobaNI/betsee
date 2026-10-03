export function capabilityIntersection(
  delegated: readonly string[],
  permitted: readonly string[],
): string[] {
  const allowed = new Set(permitted);
  return [...new Set(delegated)].filter((capability) =>
    allowed.has(capability),
  );
}
