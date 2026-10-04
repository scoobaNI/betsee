import type { ActionSummary } from '@betsee/api';
import { isObservation, outcomeTone } from './decision.ts';

export type Outcome = ReturnType<typeof outcomeTone>;

export interface TimeBucket {
  /** Start of the bucket, epoch milliseconds. */
  start: number;
  allow: number;
  approval: number;
  stepup: number;
  deny: number;
  total: number;
  /** Gateway decision times in the bucket, milliseconds. */
  latencies: number[];
}

/**
 * Decided actions in `count` equal buckets, oldest first, the last one holding `now`. Bucket edges
 * sit on whole multiples of the bucket size, so they stay put between renders and a chart keyed
 * by bucket start only gains a bar when a new bucket begins. Observations are left out.
 */
export function bucketize(actions: readonly ActionSummary[], now: number, windowMs: number, count: number): TimeBucket[] {
  const size = windowMs / count;
  const end = (Math.floor(now / size) + 1) * size;
  const from = end - windowMs;
  const out: TimeBucket[] = Array.from({ length: count }, (_, i) => ({ start: from + i * size, allow: 0, approval: 0, stepup: 0, deny: 0, total: 0, latencies: [] }));
  for (const a of actions) {
    if (isObservation(a)) continue;
    const at = Date.parse(a.occurred_at);
    if (at < from || at >= end) continue;
    const bucket = out[Math.min(count - 1, Math.floor((at - from) / size))]!;
    bucket[outcomeTone(a)]++;
    bucket.total++;
    bucket.latencies.push(a.latency_ms);
  }
  return out;
}

/** How many approvals were waiting for a person at the end of each bucket, oldest first. */
export function pendingSeries(approvals: readonly { created_at: string; decided_at: string | null }[], now: number, windowMs: number, count: number): number[] {
  const size = windowMs / count;
  const end = (Math.floor(now / size) + 1) * size;
  const from = end - windowMs;
  return Array.from({ length: count }, (_, i) => {
    // The current bucket has not ended yet; it reads as of now.
    const t = Math.min(now, from + (i + 1) * size);
    return approvals.filter((a) => Date.parse(a.created_at) <= t && (!a.decided_at || Date.parse(a.decided_at) > t)).length;
  });
}

/** The p-th percentile (0 to 100) by nearest rank; 0 for no values. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export interface Ranked {
  key: string;
  total: number;
  /** Counted by outcome, for a bar split by colour. */
  byOutcome: Record<Outcome, number>;
}

/** The n most frequent values of `key` among decided actions, most frequent first. */
export function rankBy(actions: readonly ActionSummary[], key: (a: ActionSummary) => string, n: number): Ranked[] {
  const map = new Map<string, Ranked>();
  for (const a of actions) {
    if (isObservation(a)) continue;
    const k = key(a);
    const entry = map.get(k) ?? { key: k, total: 0, byOutcome: { allow: 0, approval: 0, stepup: 0, deny: 0 } };
    entry.total++;
    entry.byOutcome[outcomeTone(a)]++;
    map.set(k, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)).slice(0, n);
}

/** A round number at or above `value` for an axis top: 1, 2, 5 times a power of ten. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}
