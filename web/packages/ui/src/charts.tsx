import { useState } from "react";
import type { DecisionBucket } from "./decision-buckets";

const SERIES = [
  { key: "allow", label: "Allowed", swatch: "bg-brand-600" },
  { key: "deny", label: "Denied", swatch: "bg-deny-fg" },
  { key: "approval", label: "Awaiting a human", swatch: "bs-hatch-approval" },
] as const;

/**
 * Stacked one-minute bars of Gateway decisions. Allowed sits on the baseline, then denied, then
 * awaiting a human (hatched, so it never relies on colour alone). Segments are separated by a
 * 2px surface gap; a legend with totals, a hover tooltip and a table for screen readers carry the
 * values.
 */
export function DecisionBars({
  buckets,
  height = 152,
}: {
  buckets: DecisionBucket[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = (b: DecisionBucket) => b.allow + b.deny + b.approval;
  const peak = Math.max(1, ...buckets.map(total));
  const ceiling = peak <= 4 ? 4 : Math.ceil(peak / 4) * 4;
  const sums = SERIES.map((series) =>
    buckets.reduce((sum, bucket) => sum + bucket[series.key], 0),
  );
  const active = hover === null ? null : buckets[hover];
  return (
    <figure className="m-0">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary">
        {SERIES.map((series, index) => (
          <span key={series.key} className="inline-flex items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 rounded-xs ${series.swatch}`}
              aria-hidden="true"
            />
            {series.label}
            <span className="font-mono text-fg-primary">{sums[index]}</span>
          </span>
        ))}
      </figcaption>
      <div className="relative mt-4" style={{ height }}>
        {[0, 0.5, 1].map((fraction) => (
          <div
            key={fraction}
            className="absolute inset-x-0 border-t border-viz-grid"
            style={{ bottom: `${fraction * 100}%` }}
            aria-hidden="true"
          >
            <span className="absolute -top-2 right-0 bg-surface-1 pl-1 font-mono text-2xs text-viz-axis">
              {Math.round(ceiling * fraction)}
            </span>
          </div>
        ))}
        <div
          className="absolute inset-0 right-8 flex items-end gap-1.5"
          aria-hidden="true"
        >
          {buckets.map((bucket, index) => (
            <div
              key={bucket.label}
              className="flex h-full flex-1 flex-col-reverse items-center"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className={`flex w-full max-w-5 flex-col-reverse gap-0.5 ${hover !== null && hover !== index ? "opacity-50" : ""}`}
                style={{ height: `${(total(bucket) / ceiling) * 100}%` }}
              >
                {SERIES.map(
                  (series) =>
                    bucket[series.key] > 0 && (
                      <div
                        key={series.key}
                        className={`${series.swatch} first:rounded-b-xs last:rounded-t-[4px]`}
                        style={{ flexGrow: bucket[series.key], minHeight: 3 }}
                      />
                    ),
                )}
              </div>
            </div>
          ))}
        </div>
        {active && hover !== null && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md bg-surface-3 px-3 py-2 text-xs shadow-e3"
            style={{
              left: `calc(${((hover + 0.5) / buckets.length) * 100}% - ${((hover + 0.5) / buckets.length) * 32}px)`,
            }}
          >
            <p className="font-mono text-fg-secondary">{active.label}</p>
            {SERIES.map((series) => (
              <p
                key={series.key}
                className="mt-1 flex items-center gap-1.5 whitespace-nowrap"
              >
                <span className={`h-2 w-2 rounded-xs ${series.swatch}`} />
                {series.label}
                <span className="ml-auto pl-3 font-mono">
                  {active[series.key]}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
      <div
        className="mr-8 mt-2 flex justify-between font-mono text-2xs text-viz-axis"
        aria-hidden="true"
      >
        <span>{buckets[0]?.label}</span>
        <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
      <table className="sr-only">
        <caption>Gateway decisions per minute</caption>
        <thead>
          <tr>
            <th scope="col">Minute</th>
            {SERIES.map((series) => (
              <th key={series.key} scope="col">
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.label}>
              <th scope="row">{bucket.label}</th>
              {SERIES.map((series) => (
                <td key={series.key}>{bucket[series.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * Semicircle budget meter. The fill turns to the approval hue from 80% and to deny when the
 * budget is exhausted, the same thresholds as the Director's agent meter.
 */
export function BudgetGauge({
  used,
  limit,
  label,
  size = 120,
}: {
  used: number;
  limit: number;
  /** Formatted limit, for example "50.00 EUR". */
  label: string;
  size?: number;
}) {
  const share = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 1;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const length = Math.PI * radius;
  const tone =
    share >= 1
      ? "text-deny-fg"
      : share >= 0.8
        ? "text-approval-fg"
        : "text-brand-500";
  const arc = `M ${stroke / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${size / 2}`;
  return (
    <figure
      className="m-0 inline-flex flex-col items-center"
      aria-label={`Budget used ${Math.round(share * 100)} percent of ${label}`}
    >
      <svg
        width={size}
        height={size / 2 + stroke / 2}
        viewBox={`0 0 ${size} ${size / 2 + stroke / 2}`}
        aria-hidden="true"
      >
        <path
          d={arc}
          fill="none"
          stroke="var(--bs-color-surface-inset)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {share > 0 && (
          <path
            d={arc}
            fill="none"
            className={tone}
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${share * length} ${length}`}
          />
        )}
      </svg>
      <figcaption className="-mt-6 text-center">
        <span className="block font-display text-2xl font-semibold tabular-nums">
          {Math.round(share * 100)}%
        </span>
        <span className="block text-xs text-fg-secondary">of {label}</span>
      </figcaption>
    </figure>
  );
}
