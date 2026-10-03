import { Icon, SeverityBadge } from '@betsee/ui';
import { atLeastMedium } from '../domain/decision.ts';

/** D22: deny styling, its own words; DecisionChip has no 'voided' resolution. */
export function VoidedChip() {
  return (
    <span title="The session ended before a human decided; the approval was voided." className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-pill border border-deny-border bg-deny-bg px-2.5 text-xs font-semibold text-deny-fg">
      <Icon name="streamline-flex:block-2" size={14} />
      Voided (session ended)
    </span>
  );
}

/** FAIL-3 (components.md, Observation row): a Gateway observation, never a decision chip. */
export function ObservedPill({ severity }: { severity?: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-line-default px-2.5 text-xs font-semibold text-fg-secondary">
        <Icon name="streamline-flex:wave-signal-circle" size={14} />
        Observed
      </span>
      {atLeastMedium(severity) && <SeverityBadge severity={severity} />}
    </span>
  );
}

export function GatewayMark() {
  return (
    <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface-3 text-accent-text">
      <Icon name="streamline-flex:shield-2" size={14} />
    </span>
  );
}
