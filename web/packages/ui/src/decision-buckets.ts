export interface DecisionBucket {
  /** Start of the minute, local HH:MM. */
  label: string;
  allow: number;
  deny: number;
  approval: number;
}

interface DecidedAction {
  occurred_at: string;
  decision: string;
  approval_state?: string;
  record_type?: string | null;
}

/**
 * Per-minute decision counts for the last `minutes` minutes, oldest first. An approved action
 * counts as allowed and a rejected or voided one as denied; one still awaiting a human counts as
 * approval. Gateway observations (record_type set) are not decisions and are left out.
 */
export function decisionBuckets(
  actions: DecidedAction[],
  now: number,
  minutes = 15,
): DecisionBucket[] {
  const end = Math.floor(now / 60_000) * 60_000 + 60_000;
  const start = end - minutes * 60_000;
  const buckets: DecisionBucket[] = Array.from(
    { length: minutes },
    (_, index) => {
      const at = new Date(start + index * 60_000);
      return {
        label: at.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        allow: 0,
        deny: 0,
        approval: 0,
      };
    },
  );
  for (const action of actions) {
    if (action.record_type) continue;
    const time = Date.parse(action.occurred_at);
    if (!(time >= start && time < end)) continue;
    const bucket = buckets[Math.floor((time - start) / 60_000)];
    const state = action.approval_state;
    if (
      action.decision === "deny" ||
      state === "rejected" ||
      state === "voided"
    )
      bucket.deny++;
    else if (action.decision === "allow" || state === "approved")
      bucket.allow++;
    else bucket.approval++;
  }
  return buckets;
}
