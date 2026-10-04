import type { GuardrailProfile } from '@betsee/api';

export interface MarkedRun {
  text: string;
  /** A token the Gateway put in place of what it took out; null for the text around it. */
  marker: { kind: 'redacted' | 'removed'; id: string } | null;
}

const MARKER = /\[(REDACTED|REMOVED):([A-Za-z0-9_-]+)\]/g;

/** Splits text the Gateway rewrote into plain runs and its [REDACTED:CLASS] and [REMOVED:SIG-ID] tokens. */
export function splitMarkers(text: string): MarkedRun[] {
  const runs: MarkedRun[] = [];
  let at = 0;
  for (const match of text.matchAll(MARKER)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index), marker: null });
    runs.push({ text: match[0], marker: { kind: match[1] === 'REDACTED' ? 'redacted' : 'removed', id: match[2]! } });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), marker: null });
  return runs;
}

const CLASS_LABEL: Record<string, string> = {
  payment_card: 'Payment card',
  iban: 'IBAN',
  pesel: 'PESEL',
  secret: 'Secret or API key',
  email: 'Email address',
  phone: 'Phone number',
  resource_above_tier: 'Resource above the session tier',
};

const CLASS_ORDER = Object.keys(CLASS_LABEL);

export const classLabel = (cls: string) => CLASS_LABEL[cls.toLowerCase()] ?? cls.replace(/_/g, ' ');

/** The detector classes the profiles name on one side, known classes first in their usual order. */
export function profileClasses(profiles: Record<string, GuardrailProfile>, side: 'input' | 'output'): string[] {
  const named = new Set(Object.values(profiles).flatMap((p) => Object.keys(p[side])));
  const rank = (cls: string) => (CLASS_ORDER.includes(cls) ? CLASS_ORDER.indexOf(cls) : CLASS_ORDER.length);
  return [...named].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** What a profile does with a class it does not name: the Gateway blocks on input and redacts on output. */
export const actionFor = (profile: GuardrailProfile, side: 'input' | 'output', cls: string) => profile[side][cls] ?? (side === 'input' ? 'block' : 'redact');

export const shortSha = (sha: string, length = 12) => sha.replace(/^sha256:/, '').slice(0, length);

export const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

const fractional = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

/** Model prices are fractions of a cent per 1,000 tokens; keep up to three decimals. */
export const formatPriceCents = (cents: number) => `${fractional.format(cents)} ct`;

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
