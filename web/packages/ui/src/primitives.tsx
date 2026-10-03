import type { ReactNode } from "react";
import { Icon } from "./icon";

export type Decision =
  "allow" | "deny" | "require_approval" | "require_step_up";
export type Tier = "public" | "internal" | "confidential" | "restricted";
const decisions = {
  allow: {
    label: "Allowed",
    icon: "streamline:check",
    className: "bg-allow-bg border-allow-border text-allow-fg",
    tick: "bg-brand-700",
  },
  deny: {
    label: "Denied",
    icon: "streamline-flex:block-2",
    className: "bg-deny-bg border-deny-border text-deny-fg",
    tick: "bg-deny-fg",
  },
  require_approval: {
    label: "Awaiting approval",
    icon: "streamline-flex:hourglass",
    className:
      "bg-approval-bg border-approval-border text-approval-fg border-dashed",
    tick: "bg-approval-fg",
  },
  require_step_up: {
    label: "Awaiting step-up",
    icon: "streamline-flex:fingerprint-1",
    className: "bg-stepup-bg border-stepup-border text-stepup-fg border-dashed",
    tick: "bg-stepup-fg",
  },
};

export interface DecisionChipProps {
  decision: Decision;
  resolution?: "approved" | "rejected" | "verified" | "failed" | null;
  aiTightened?: boolean;
  size?: "sm" | "md";
  variant?: "chip" | "compact" | "tick";
  modelLabel?: string;
  controlIds?: string[];
  history?: string;
  className?: string;
}

export function DecisionChip({
  decision,
  resolution,
  aiTightened = false,
  size = "md",
  variant = "chip",
  modelLabel = "mock model (demo)",
  controlIds = [],
  history,
  className = "",
}: DecisionChipProps) {
  const resolved = resolution
    ? ["approved", "verified"].includes(resolution)
      ? "allow"
      : "deny"
    : decision;
  const item = decisions[resolved];
  const label = resolution
    ? resolution[0].toUpperCase() + resolution.slice(1)
    : item.label;
  const title = [
    decision,
    ...controlIds,
    history,
    aiTightened
      ? `AI-tightened: the analyzer raised the deterministic verdict to ${decisions[decision].label.toLowerCase()}. Model: ${modelLabel}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (variant === "tick")
    return (
      <span
        title={title}
        role="img"
        aria-label={`${label}${aiTightened ? ", AI-tightened" : ""}`}
        className={`relative inline-block h-3.5 w-1 overflow-hidden rounded-xs ${item.tick} ${className}`}
      >
        {aiTightened && (
          <span className="absolute inset-x-0 top-0 h-0.5 bg-tightened-fg" />
        )}
      </span>
    );
  return (
    <span
      title={title}
      className={`relative inline-flex shrink-0 items-center overflow-visible rounded-pill border text-xs font-semibold ${size === "sm" ? "h-5" : "h-6"} ${item.className} ${className}`}
    >
      <span className="inline-flex items-center gap-1.5 px-2.5">
        <Icon name={item.icon} size={14} />
        {label}
      </span>
      {aiTightened && variant === "chip" && (
        <span className="inline-flex h-full items-center gap-1.5 rounded-r-pill border-l border-tightened-border bg-tightened-bg px-2 text-tightened-fg">
          <Icon name="streamline:ai-chip-spark" size={14} />
          AI-tightened
        </span>
      )}
      {aiTightened && variant === "compact" && (
        <span
          aria-label={`AI-tightened, ${modelLabel}`}
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-pill bg-tightened-fg"
        />
      )}
    </span>
  );
}

export function LifecycleBadge({
  state,
  className = "",
}: {
  state: "active" | "quarantined" | "suspended";
  className?: string;
}) {
  const styles = {
    active: "text-allow-fg border-allow-border bg-allow-bg",
    quarantined:
      "text-quarantined-fg border-quarantined-border bg-quarantined-bg bs-quarantine",
    suspended: "text-suspended-fg border-suspended-border bg-surface-2",
  };
  return (
    <span
      className={`inline-flex h-5 items-center gap-1.5 rounded-pill border px-2 text-xs font-semibold ${styles[state]} ${className}`}
    >
      {state === "active" ? (
        <span className="h-1.5 w-1.5 rounded-pill bg-active" />
      ) : (
        <Icon
          name={
            state === "quarantined"
              ? "streamline-flex:padlock-square-1"
              : "streamline-flex:button-pause-circle"
          }
          size={12}
        />
      )}
      {state[0].toUpperCase() + state.slice(1)}
    </span>
  );
}

export function TierBadge({
  tier,
  className = "",
}: {
  tier: Tier;
  className?: string;
}) {
  const level =
    ["public", "internal", "confidential", "restricted"].indexOf(tier) + 1;
  return (
    <span
      className={`inline-flex items-center gap-2 text-xs font-medium text-fg-secondary ${className}`}
    >
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={`h-2.5 w-0.75 rounded-xs ${n <= level ? (tier === "restricted" ? "bg-fg-primary" : "bg-fg-secondary") : "bg-line-default"}`}
          />
        ))}
      </span>
      {tier[0].toUpperCase() + tier.slice(1)}
    </span>
  );
}

export function IdToken({
  children,
  id,
  href,
  className = "",
  copy = true,
}: {
  children?: ReactNode;
  id?: string;
  href?: string;
  className?: string;
  copy?: boolean;
}) {
  const value = id ?? (typeof children === "string" ? children : "");
  return (
    <span
      className={`group inline-flex max-w-full items-center gap-1 rounded-xs bg-surface-3 px-1.5 py-0.5 font-mono text-xs ${className}`}
    >
      {href ? (
        <a href={href} className="truncate hover:text-accent-text">
          {children ?? id}
        </a>
      ) : (
        <span className="truncate">{children ?? id}</span>
      )}
      {copy && value && (
        <button
          type="button"
          className="opacity-0 focus:opacity-100 group-hover:opacity-100"
          title={`Copy ${value}`}
          aria-label={`Copy ${value}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
          }}
        >
          <Icon name="streamline:copy-paste" size={12} />
        </button>
      )}
    </span>
  );
}

export function MockBadge({
  modelLabel,
  label,
  children,
  className = "",
}: {
  modelLabel?: string;
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill border border-dashed border-mock-border px-2 py-0.5 text-2xs font-semibold text-mock-fg ${className}`}
    >
      <Icon name="streamline-flex:erlenmeyer-flask" size={12} />
      {children ?? modelLabel ?? label ?? "Mock data"}
    </span>
  );
}

export type StreamState =
  "connecting" | "live" | "reconnecting" | "stale" | "offline";
export function StreamStatus({
  status,
  state,
  className = "",
}: {
  status?: StreamState;
  state?: StreamState;
  className?: string;
}) {
  const value = status ?? state ?? "connecting";
  const styles = {
    connecting: "bg-info",
    live: "bg-accent shadow-live",
    reconnecting: "bg-warning",
    stale: "bg-warning",
    offline: "bg-danger",
  };
  return (
    <span
      role="status"
      className={`inline-flex h-7 items-center gap-2 rounded-pill border border-line-default bg-surface-1 px-2.5 text-xs font-semibold ${className}`}
    >
      <span
        className={`h-2 w-2 rounded-pill ${styles[value]} ${["connecting", "live", "reconnecting"].includes(value) ? "bs-live-pulse" : ""}`}
      />
      {value[0].toUpperCase() + value.slice(1)}
    </span>
  );
}

export function SeverityBadge({
  severity,
}: {
  severity: "info" | "low" | "medium" | "high" | "critical";
}) {
  const styles = {
    info: "text-fg-secondary",
    low: "text-viz-neutral-1",
    medium: "text-approval-fg",
    high: "text-quarantined-fg",
    critical: "text-deny-fg",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-xs border border-current px-1.5 py-0.5 text-xs ${styles[severity]}`}
    >
      <span className="h-2 w-2 bg-current" />
      {severity[0].toUpperCase() + severity.slice(1)}
    </span>
  );
}

export function KpiTile({
  label,
  value,
  delta,
  detail,
  href,
  feature = false,
  compact = false,
  className = "",
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  detail?: string;
  href?: string;
  feature?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <article
      className={`relative rounded-lg ${compact ? "p-3" : "p-5"} ${feature ? "bs-feature text-fg-on-feature" : "bg-surface-1 shadow-e1"} ${className}`}
    >
      <p
        className={`text-sm ${feature ? "text-fg-on-feature" : "text-fg-secondary"}`}
      >
        {label}
      </p>
      <div
        className={`${compact ? "text-3xl" : "text-4xl"} mt-3 font-display font-semibold tabular-nums`}
      >
        {value}
      </div>
      {(delta || detail) && (
        <p
          className={`mt-2 text-xs ${feature ? "text-fg-on-feature" : "text-fg-secondary"}`}
        >
          {delta ?? detail}
        </p>
      )}
      {href && (
        <a
          href={href}
          title={`Open ${label}`}
          aria-label={`Open ${label}`}
          className={`absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-pill ${feature ? "bg-fg-on-feature text-brand-900" : "border border-line-default text-fg-secondary hover:text-fg-primary"}`}
        >
          <Icon
            name={
              /^https?:\/\//.test(href)
                ? "streamline-flex:arrow-expand"
                : "streamline:interface-arrows-upright-corner-arrow-up-right-upright-corner"
            }
            size={14}
          />
        </a>
      )}
    </article>
  );
}
