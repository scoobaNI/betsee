import { subscribeToEvents, useAgents, type ActionSummary } from '@betsee/api';
import { animate, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isObservation, outcomeTone } from '../domain/decision.ts';
import type { Bucket, DeterminismStats } from '../domain/determinism.ts';
import { groupByTeam } from '../domain/feed.ts';
import { Icon } from './icon.tsx';
import { Burst, TONE_COLOR } from './motion.tsx';
import { AgentGlyph, AnimatedNumber, type Tone } from './ui.tsx';

// Drawn on a 1000 x 360 grid; the HTML cards sit on the same grid by percentage.
const VW = 1000;
const VH = 360;
const MID = VH / 2;
const WAVE_FROM = 190;
const GATE_IN = 372;
const GATE_OUT = 548;
const AI_IN = 610;
const AI_OUT = 742;
const BUCKET_X = 842;

const BUCKETS: { key: Bucket; label: string; tone: Tone; y: number }[] = [
  { key: 'allow', label: 'Allowed', tone: 'ok', y: 60 },
  { key: 'approval', label: 'Approval', tone: 'wait', y: 140 },
  { key: 'stepup', label: 'Step-up', tone: 'verify', y: 220 },
  { key: 'deny', label: 'Denied', tone: 'bad', y: 300 },
];

const TONE_OF: Record<Bucket, Tone> = { allow: 'ok', approval: 'wait', stepup: 'verify', deny: 'bad' };
const DET_TONE = (a: ActionSummary): Tone => TONE_OF[outcomeTone({ decision: a.deterministic_decision, approval_state: 'none' })];

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** A line that wanders, then settles as it nears the gate: a model's output before policy decides. */
function wavePath(y0: number, phase: number) {
  const points: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const x = WAVE_FROM + (GATE_IN - WAVE_FROM) * t;
    const ease = t * t * (3 - 2 * t);
    const base = y0 + (MID - y0) * ease;
    const amp = 11 * (1 - t) ** 1.3;
    const y = base + amp * Math.sin(t * 22 + phase) + amp * 0.45 * Math.sin(t * 47 + phase * 1.7);
    points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return points.join(' ');
}

const fanPath = (y: number) => `M ${AI_OUT} ${MID} C ${AI_OUT + 50} ${MID}, ${BUCKET_X - 50} ${y}, ${BUCKET_X} ${y}`;
const STRAIGHT = `M ${GATE_OUT} ${MID} L ${AI_IN} ${MID} M ${AI_OUT} ${MID}`;

interface Flight {
  id: string;
  lane: number;
  det: Tone;
  final: Tone;
  bucket: Bucket;
}

const WAVE_S = 1.0;
const MIDDLE_S = 0.55;
const FAN_S = 0.6;

/** One request crossing the boundary: grey while a model's, coloured once the controls decide. */
function Particle({ flight, lanes }: { flight: Flight; lanes: number[] }) {
  const y0 = lanes[flight.lane] ?? MID;
  const bucket = BUCKETS.find((b) => b.key === flight.bucket)!;
  const segments = useMemo(
    () => [
      { d: wavePath(y0, 0), color: 'var(--color-ink-3)', duration: WAVE_S },
      { d: `M ${GATE_OUT} ${MID} L ${AI_OUT} ${MID}`, color: TONE_COLOR[flight.det], duration: MIDDLE_S },
      { d: fanPath(bucket.y), color: TONE_COLOR[flight.final], duration: FAN_S },
    ],
    [y0, flight.det, flight.final, bucket.y],
  );
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const dot = useRef<SVGCircleElement>(null);
  useEffect(() => {
    let stopped = false;
    let current: { stop: () => void } | undefined;
    const run = async () => {
      for (const [i, segment] of segments.entries()) {
        const path = paths.current[i];
        const circle = dot.current;
        if (!path || !circle || stopped) return;
        const length = path.getTotalLength();
        circle.setAttribute('fill', segment.color);
        circle.style.filter = `drop-shadow(0 0 6px ${segment.color})`;
        circle.setAttribute('opacity', '1');
        const controls = animate(0, 1, {
          duration: segment.duration,
          ease: [0.45, 0, 0.2, 1],
          onUpdate: (t) => {
            const point = path.getPointAtLength(t * length);
            circle.setAttribute('cx', String(point.x));
            circle.setAttribute('cy', String(point.y));
          },
        });
        current = controls;
        await controls;
      }
      dot.current?.setAttribute('opacity', '0');
    };
    void run();
    return () => {
      stopped = true;
      current?.stop();
    };
  }, [segments]);
  return (
    <g>
      {segments.map((segment, i) => (
        <path key={i} ref={(el) => void (paths.current[i] = el)} d={segment.d} fill="none" stroke="none" />
      ))}
      <circle ref={dot} r={6} opacity={0} />
    </g>
  );
}

function Wave({ y0, index }: { y0: number; index: number }) {
  const reduce = useReducedMotion();
  const a = useMemo(() => wavePath(y0, index * 1.3), [y0, index]);
  const b = useMemo(() => wavePath(y0, index * 1.3 + Math.PI), [y0, index]);
  return (
    <motion.path
      d={a}
      fill="none"
      stroke="var(--color-ink-4)"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeDasharray="2 5"
      // Explicit, or it inherits the page's "hidden" variant on navigation and loses its path.
      initial={false}
      animate={reduce ? undefined : { d: [a, b, a] }}
      transition={{ duration: 3.2 + index * 0.4, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

/**
 * The deterministic boundary, live: agents' requests arrive as wandering lines (a model can phrase
 * anything), meet the deterministic controls, pass AI analysis that can only tighten, and land in
 * one of four outcomes. Each request that arrives while the page is open crosses as a particle.
 */
export function BoundaryVisual({ stats }: { stats: DeterminismStats }) {
  const agents = useAgents();
  const reduce = useReducedMotion();
  const list = useMemo(() => groupByTeam(agents.data ?? []).flatMap(([, l]) => l), [agents.data]);
  const lanes = useMemo(() => list.map((_, i) => (list.length === 1 ? MID : 40 + (i * (VH - 80)) / (list.length - 1))), [list]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [gatePulse, setGatePulse] = useState(0);
  const [aiPulse, setAiPulse] = useState(0);
  const listRef = useRef(list);
  listRef.current = list;

  useEffect(() => {
    if (reduce) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const unsubscribe = subscribeToEvents((event) => {
      if (event.type !== 'action.decided' || isObservation(event.data)) return;
      const a = event.data;
      const lane = listRef.current.findIndex((x) => x.id === a.agent.id);
      if (lane < 0) return;
      const flight: Flight = { id: a.trace_id, lane, det: DET_TONE(a), final: TONE_OF[outcomeTone(a)], bucket: outcomeTone(a) };
      setFlights((prev) => [...prev.slice(-10), flight]);
      later(WAVE_S * 1000, () => setGatePulse((n) => n + 1));
      later((WAVE_S + MIDDLE_S) * 1000, () => setAiPulse((n) => n + 1));
      later((WAVE_S + MIDDLE_S + FAN_S + 0.4) * 1000, () => setFlights((prev) => prev.filter((f) => f.id !== flight.id)));
    });
    return () => {
      unsubscribe();
      for (const t of timers) clearTimeout(t);
    };
  }, [reduce]);

  const share = stats.total ? Math.round(((stats.total - stats.loosened) / stats.total) * 100) : 100;

  return (
    <div className="relative w-full" style={{ aspectRatio: `${VW} / ${VH}` }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {lanes.map((y, i) => (
          <Wave key={list[i]!.id} y0={y} index={i} />
        ))}
        <path d={STRAIGHT} stroke="var(--color-line-strong)" strokeWidth={2.5} strokeLinecap="round" fill="none" />
        {BUCKETS.map((b) => (
          <path key={b.key} d={fanPath(b.y)} stroke={TONE_COLOR[b.tone]} strokeOpacity={0.45} strokeWidth={2.5} strokeLinecap="round" fill="none" />
        ))}
        {flights.map((f) => (
          <Particle key={f.id} flight={f} lanes={lanes} />
        ))}
      </svg>

      {list.map((agent, i) => (
        <div key={agent.id} className="absolute left-0 flex -translate-y-1/2 items-center gap-2.5" style={{ top: pct(lanes[i]!, VH), width: pct(WAVE_FROM - 12, VW) }}>
          <AgentGlyph state={agent.state} size={34} agentId={agent.id} />
          <span className="min-w-0 truncate text-[13px] font-semibold text-ink-2">{agent.id}</span>
        </div>
      ))}

      <div
        className="absolute flex flex-col items-center justify-center rounded-[22px] border border-accent/20 bg-gradient-to-b from-accent-soft to-surface px-4 text-center text-ink shadow-lift"
        style={{ left: pct(GATE_IN, VW), width: pct(GATE_OUT - GATE_IN, VW), top: '8%', bottom: '8%' }}
      >
        <Burst trigger={gatePulse || undefined} color="var(--color-accent)" radius="22px" strength={1.06} />
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white shadow-card">
          <Icon name="scale" size={22} />
        </span>
        <span className="mt-3 text-[15px] leading-tight font-bold">Deterministic controls</span>
        <span className="mt-1.5 text-[12px] leading-snug text-ink-3">Cedar policies and controls. Same request, same answer.</span>
        <span className="mt-4 text-[26px] leading-none font-bold tracking-[-0.02em] text-accent-ink">{share}%</span>
        <span className="mt-1 text-[11px] text-ink-3">of decisions held by policy</span>
      </div>

      <div
        className="absolute flex flex-col items-center justify-center rounded-[18px] border border-ai/25 bg-ai-soft px-3 text-center shadow-card"
        style={{ left: pct(AI_IN, VW), width: pct(AI_OUT - AI_IN, VW), top: pct(MID - 62, VH), height: pct(124, VH) }}
      >
        <Burst trigger={aiPulse || undefined} color="var(--color-ai)" radius="18px" strength={1.08} />
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-ai-ink">
          <Icon name="sparkles" size={15} />
          AI analysis
        </span>
        <span className="mt-1 text-[11.5px] leading-snug text-ai-ink/80">May only tighten</span>
        <span className="mt-2 text-[12px] font-semibold text-ink tabular-nums">
          <AnimatedNumber value={stats.tightened} /> tightened - <AnimatedNumber value={stats.loosened} /> loosened
        </span>
      </div>

      {BUCKETS.map((b) => (
        <div
          key={b.key}
          className="absolute flex -translate-y-1/2 items-center gap-3 rounded-[16px] border border-line bg-surface px-3.5 py-2.5 shadow-card"
          style={{ left: pct(BUCKET_X + 6, VW), top: pct(b.y, VH), width: pct(VW - BUCKET_X - 6, VW) }}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE_COLOR[b.tone] }} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-2">{b.label}</span>
          <span className="text-[18px] font-bold tracking-[-0.02em] text-ink">
            <AnimatedNumber value={stats.final[b.key]} />
          </span>
        </div>
      ))}
    </div>
  );
}
