import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { niceCeiling, percentile, type Outcome, type Ranked, type TimeBucket } from '../domain/series.ts';
import { formatCount } from '../domain/format.ts';
import { EASE, TONE_COLOR } from './motion.tsx';
import type { Tone } from './ui.tsx';

export const OUTCOME_SERIES: { key: Outcome; label: string; tone: Tone }[] = [
  { key: 'allow', label: 'Allowed', tone: 'ok' },
  { key: 'approval', label: 'Approval', tone: 'wait' },
  { key: 'stepup', label: 'Step-up', tone: 'verify' },
  { key: 'deny', label: 'Denied', tone: 'bad' },
];

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
export const formatClock = (ms: number) => clock.format(new Date(ms));

/**
 * A monotone cubic curve through the points (Fritsch-Carlson): smooth like a spline, but it never
 * overshoots, so a count of zero never dips below the axis.
 */
export function smoothPath(points: readonly (readonly [number, number])[]): string {
  const n = points.length;
  if (!n) return '';
  if (n === 1) return `M ${points[0]![0]} ${points[0]![1]}`;
  const x = points.map((p) => p[0]);
  const y = points.map((p) => p[1]);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(x[i + 1]! - x[i]!);
    slope.push((y[i + 1]! - y[i]!) / (dx[i] || 1));
  }
  const tangent = [slope[0]!];
  for (let i = 1; i < n - 1; i++) tangent.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  tangent.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i]! / slope[i]!;
    const b = tangent[i + 1]! / slope[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      tangent[i] = tau * a * slope[i]!;
      tangent[i + 1] = tau * b * slope[i]!;
    }
  }
  let d = `M ${x[0]} ${y[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += ` C ${x[i]! + h} ${y[i]! + tangent[i]! * h}, ${x[i + 1]! - h} ${y[i + 1]! - tangent[i + 1]! * h}, ${x[i + 1]} ${y[i + 1]}`;
  }
  return d;
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * A small area chart that stretches to its container. Pointing at it reads the value under the
 * pointer; the newest point pulses so the line reads as live.
 */
export function Sparkline({
  values,
  tone,
  height = 64,
  className = '',
  readout,
  delay = 0,
  radius = 24,
}: {
  values: readonly number[];
  tone: Tone;
  height?: number;
  className?: string;
  /** Text for the value at an index, shown while pointing at the chart. */
  readout?: (index: number) => string;
  delay?: number;
  /** Bottom corner radius of the card the chart sits flush in, so the area never pokes out. */
  radius?: number;
}) {
  const id = safeId(useId());
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const color = TONE_COLOR[tone];
  const max = Math.max(1, ...values);
  const n = values.length;
  const top = 8;
  const floor = 12;
  const points = values.map((v, i) => [n === 1 ? 50 : (i / (n - 1)) * 100, height - floor - (v / max) * (height - top - floor)] as const);
  const line = smoothPath(points);
  const area = `${line} L 100 ${height} L 0 ${height} Z`;
  const last = points.at(-1);
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!readout || !box.current || n < 2) return;
    const rect = box.current.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((event.clientX - rect.left) / rect.width) * (n - 1)))));
  };
  const at = hover === null ? undefined : points[hover];
  return (
    <div ref={box} className={`relative ${className}`} style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <div className="absolute inset-0 overflow-hidden" style={{ borderBottomLeftRadius: radius, borderBottomRightRadius: radius }}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            <clipPath id={`${id}-reveal`}>
              <motion.rect x={-2} y={-20} height={height + 40} initial={{ width: reduce ? 104 : 0 }} animate={{ width: 104 }} transition={{ duration: 1.2, ease: EASE, delay }} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id}-reveal)`}>
            <motion.path d={area} fill={`url(#${id}-fill)`} initial={false} animate={{ d: area }} transition={{ duration: 0.7, ease: EASE }} />
            <motion.path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={false}
              animate={{ d: line }}
              transition={{ duration: 0.7, ease: EASE }}
            />
          </g>
        </svg>
      </div>
      {last && hover === null && (
        <span
          aria-hidden="true"
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-surface"
          style={{ left: `${last[0]}%`, top: `${(last[1] / height) * 100}%`, background: color, boxShadow: `0 0 10px ${color}` }}
        />
      )}
      {at && readout && hover !== null && (
        <>
          <span aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-ink/15" style={{ left: `${at[0]}%` }} />
          <span
            aria-hidden="true"
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-surface"
            style={{ left: `${at[0]}%`, top: `${(at[1] / height) * 100}%`, background: color }}
          />
          <span
            className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2 py-1 text-[11.5px] font-semibold whitespace-nowrap text-white shadow-lift"
            style={{ left: `${Math.min(88, Math.max(12, at[0]))}%` }}
          >
            {readout(hover)}
          </span>
        </>
      )}
    </div>
  );
}

/** Decisions per time bucket, stacked by outcome, with an axis, hover details and series toggles. */
export function StackedBars({ buckets, height = 240, bucketMs }: { buckets: readonly TimeBucket[]; height?: number; bucketMs: number }) {
  const reduce = useReducedMotion();
  const [hidden, setHidden] = useState<Set<Outcome>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const shown = OUTCOME_SERIES.filter((s) => !hidden.has(s.key));
  const totals = buckets.map((b) => shown.reduce((sum, s) => sum + b[s.key], 0));
  const top = niceCeiling(Math.max(...totals, 1));
  const ticks = [0, top / 2, top];
  const hovered = hover === null ? undefined : buckets[hover];
  const toggle = (key: Outcome) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (shown.length > 1) next.add(key);
      return next;
    });
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {OUTCOME_SERIES.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={!off}
              onClick={() => toggle(s.key)}
              className={`press inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] font-semibold transition-all ${
                off ? 'border-line bg-surface text-ink-4' : 'border-transparent bg-sunken text-ink-2'
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full transition-opacity" style={{ background: TONE_COLOR[s.tone], opacity: off ? 0.3 : 1 }} />
              {s.label}
            </button>
          );
        })}
      </div>
      <div className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-3">
        <div className="relative" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 text-[11.5px] font-medium text-ink-3 tabular-nums" style={{ top: `${100 - (t / top) * 100}%` }}>
              {formatCount(t)}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height }} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <span key={t} aria-hidden="true" className={`absolute inset-x-0 h-px ${t === 0 ? 'bg-line-strong' : 'border-t border-dashed border-line'}`} style={{ top: `${100 - (t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {buckets.map((bucket, i) => (
              <div
                key={bucket.start}
                onPointerEnter={() => setHover(i)}
                className="relative flex h-full flex-1 cursor-default flex-col-reverse transition-opacity duration-200"
                style={{ opacity: hover === null || hover === i ? 1 : 0.45 }}
              >
                {shown.map((s, j) => (
                  <motion.span
                    key={s.key}
                    className={`block w-full ${j === shown.length - 1 || shown.slice(j + 1).every((x) => !bucket[x.key]) ? 'rounded-t-[4px]' : ''}`}
                    style={{ background: TONE_COLOR[s.tone], opacity: s.key === 'allow' ? 0.75 : 1 }}
                    initial={reduce ? false : { height: 0 }}
                    animate={{ height: `${(bucket[s.key] / top) * 100}%` }}
                    transition={{ duration: 0.6, ease: EASE, delay: reduce ? 0 : i * 0.012 }}
                  />
                ))}
              </div>
            ))}
          </div>
          <AnimatePresence>
            {hovered && hover !== null && (
              <motion.div
                key="tip"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, left: `${((hover + 0.5) / buckets.length) * 100}%` }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="glass pointer-events-none absolute -top-3 z-10 w-[200px] -translate-x-1/2 -translate-y-full rounded-2xl p-3.5"
                style={{ left: `${((hover + 0.5) / buckets.length) * 100}%` }}
              >
                <p className="text-[12px] font-semibold text-ink-3 tabular-nums">
                  {formatClock(hovered.start)} to {formatClock(hovered.start + bucketMs)}
                </p>
                <p className="mt-1 text-[20px] leading-none font-bold text-ink tabular-nums">
                  {formatCount(hovered.total)} <span className="text-[12.5px] font-semibold text-ink-3">decisions</span>
                </p>
                <ul className="mt-3 space-y-1.5">
                  {OUTCOME_SERIES.map((s) => (
                    <li key={s.key} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: TONE_COLOR[s.tone] }} />
                      {s.label}
                      <span className="ml-auto font-semibold text-ink tabular-nums">{hovered[s.key]}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <span />
        <div className="flex justify-between text-[11.5px] font-medium text-ink-3 tabular-nums">
          <span>{buckets[0] ? formatClock(buckets[0].start) : ''}</span>
          <span>{buckets.length > 2 ? formatClock(buckets[Math.floor(buckets.length / 2)]!.start) : ''}</span>
          <span>now</span>
        </div>
      </div>
    </div>
  );
}

export interface DonutPart {
  key: string;
  label: string;
  value: number;
  tone: Tone;
}

/** Shares of a whole as a ring; pointing at a segment names it in the middle. */
export function Donut({ parts, size = 200, thickness = 24, centre }: { parts: readonly DonutPart[]; size?: number; thickness?: number; centre: { value: number; label: string } }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  // The first draw sweeps the ring in segment by segment; later updates just glide, quickly.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDrawn(true), 1_400);
    return () => clearTimeout(timer);
  }, []);
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const r = (size - thickness - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = total && parts.filter((p) => p.value).length > 1 ? 3 : 0;
  let offset = 0;
  const active = parts.find((p) => p.key === hover);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-sunken)" strokeWidth={thickness} />
        {total > 0 &&
          parts.map((p, i) => {
            const length = (p.value / total) * circumference;
            const dash = Math.max(0, length - gap);
            const start = offset;
            offset += length;
            if (!p.value) return null;
            return (
              <motion.circle
                key={p.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={TONE_COLOR[p.tone]}
                strokeLinecap="butt"
                onPointerEnter={() => setHover(p.key)}
                onPointerLeave={() => setHover(null)}
                initial={reduce ? false : { strokeDasharray: `0 ${circumference}`, strokeDashoffset: -start }}
                animate={{
                  strokeDasharray: `${dash} ${circumference - dash}`,
                  strokeDashoffset: -start,
                  strokeWidth: hover === p.key ? thickness + 8 : thickness,
                  opacity: hover && hover !== p.key ? 0.4 : p.tone === 'ok' ? 0.85 : 1,
                }}
                transition={{
                  duration: drawn ? 0.35 : 0.9,
                  ease: EASE,
                  delay: reduce || drawn ? 0 : 0.15 + i * 0.12,
                  strokeWidth: { duration: 0.2 },
                  opacity: { duration: 0.2 },
                }}
                className="cursor-default"
              />
            );
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={active?.key ?? 'total'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            <p className="text-[34px] leading-none font-bold tracking-[-0.03em] text-ink tabular-nums">{formatCount(active ? active.value : centre.value)}</p>
            <p className="mt-1.5 text-[12.5px] font-semibold" style={{ color: active ? TONE_COLOR[active.tone] : 'var(--color-ink-3)' }}>
              {active ? `${active.label}, ${total ? Math.round((active.value / total) * 100) : 0}%` : centre.label}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** A ranked list with bars split by outcome, longest first. */
export function RankBars({ items, label }: { items: readonly Ranked[]; label: (key: string) => ReactNode }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...items.map((i) => i.total));
  return (
    <ul className="space-y-4">
      {items.map((item, i) => (
        <li key={item.key}>
          <div className="mb-2 flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate">{label(item.key)}</span>
            <span className="text-[14px] font-bold text-ink tabular-nums">{formatCount(item.total)}</span>
            {item.byOutcome.deny > 0 && <span className="text-[12.5px] font-semibold text-bad-ink tabular-nums">{item.byOutcome.deny} denied</span>}
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
            <motion.div
              className="flex h-full gap-[2px] overflow-hidden rounded-full"
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${(item.total / max) * 100}%` }}
              transition={{ duration: 0.8, ease: EASE, delay: reduce ? 0 : 0.1 + i * 0.06 }}
            >
              {OUTCOME_SERIES.map((s) =>
                item.byOutcome[s.key] ? (
                  <span key={s.key} style={{ flexGrow: item.byOutcome[s.key], background: TONE_COLOR[s.tone], opacity: s.key === 'allow' ? 0.75 : 1 }} />
                ) : null,
              )}
            </motion.div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Gateway decision time per bucket: the median and the 95th percentile as two lines. */
export function LatencyChart({ buckets, height = 200 }: { buckets: readonly TimeBucket[]; height?: number }) {
  const id = safeId(useId());
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(
    () =>
      buckets
        .map((b, i) => ({ i, start: b.start, p50: percentile(b.latencies, 50), p95: percentile(b.latencies, 95), n: b.latencies.length }))
        .filter((p) => p.n > 0),
    [buckets],
  );
  const top = niceCeiling(Math.max(1, ...series.map((p) => p.p95)));
  const maxCount = niceCeiling(Math.max(1, ...buckets.map((b) => b.total)));
  const n = buckets.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => height - 2 - (v / top) * (height - 12);
  const p50 = smoothPath(series.map((p) => [x(p.i), y(p.p50)] as const));
  const p95 = smoothPath(series.map((p) => [x(p.i), y(p.p95)] as const));
  const area = series.length ? `${p50} L ${x(series.at(-1)!.i)} ${height} L ${x(series[0]!.i)} ${height} Z` : '';
  const near = hover === null ? undefined : series.reduce<(typeof series)[number] | undefined>((best, p) => (!best || Math.abs(p.i - hover) < Math.abs(best.i - hover) ? p : best), undefined);
  if (!series.length) return <p className="py-16 text-center text-[14px] text-ink-3">No decision in this window yet.</p>;
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-3">
      <div className="relative" style={{ height }}>
        {[0, top / 2, top].map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2 text-[11.5px] font-medium text-ink-3 tabular-nums" style={{ top: y(t) }}>
            {t} ms
          </span>
        ))}
      </div>
      <div
        ref={box}
        className="relative"
        style={{ height }}
        onPointerMove={(e) => {
          const rect = box.current!.getBoundingClientRect();
          setHover(Math.round(((e.clientX - rect.left) / rect.width) * (n - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[0, top / 2, top].map((t) => (
          <span key={t} aria-hidden="true" className={`absolute inset-x-0 h-px ${t === 0 ? 'bg-line-strong' : 'border-t border-dashed border-line'}`} style={{ top: y(t) }} />
        ))}
        {/* Throughput behind the lines, on its own scale, so load and decision time read together. */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex items-end gap-[3px]" style={{ height: height * 0.45 }}>
          {buckets.map((b, i) => (
            <motion.span
              key={b.start}
              className="flex-1 rounded-t-[3px] bg-accent/[0.13]"
              initial={reduce ? false : { height: 0 }}
              animate={{ height: `${(b.total / maxCount) * 100}%` }}
              transition={{ duration: 0.6, ease: EASE, delay: reduce ? 0 : i * 0.01 }}
            />
          ))}
        </div>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
            <clipPath id={`${id}-reveal`}>
              <motion.rect x={-2} y={-20} height={height + 40} initial={{ width: reduce ? 104 : 0 }} animate={{ width: 104 }} transition={{ duration: 1.3, ease: EASE }} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id}-reveal)`}>
            <path d={area} fill={`url(#${id}-fill)`} />
            <path d={p95} fill="none" stroke="var(--color-accent)" strokeOpacity={0.45} strokeWidth={2} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
            <path d={p50} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
        {near && (
          <>
            <span aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-ink/15" style={{ left: `${x(near.i)}%` }} />
            <span aria-hidden="true" className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-[3px] ring-surface" style={{ left: `${x(near.i)}%`, top: y(near.p50) }} />
            <div
              className="glass pointer-events-none absolute top-0 z-10 w-[170px] -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-2xl p-3"
              style={{ left: `${Math.min(85, Math.max(15, x(near.i)))}%` }}
            >
              <p className="text-[12px] font-semibold text-ink-3 tabular-nums">{formatClock(near.start)}</p>
              <p className="mt-1.5 flex justify-between text-[13px] text-ink-2">
                Median <span className="font-bold text-ink tabular-nums">{near.p50} ms</span>
              </p>
              <p className="mt-1 flex justify-between text-[13px] text-ink-2">
                95th percentile <span className="font-bold text-ink tabular-nums">{near.p95} ms</span>
              </p>
              <p className="mt-1 flex justify-between text-[13px] text-ink-2">
                Decisions <span className="font-bold text-ink tabular-nums">{near.n}</span>
              </p>
            </div>
          </>
        )}
      </div>
      <span />
      <div className="flex justify-between text-[11.5px] font-medium text-ink-3 tabular-nums">
        <span>{buckets[0] ? formatClock(buckets[0].start) : ''}</span>
        <span>now</span>
      </div>
    </div>
  );
}
