import { useAgents, type ActionSummary } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { isObservation } from '../domain/decision.ts';
import { groupByTeam } from '../domain/feed.ts';
import { formatTime } from '../domain/format.ts';
import { useActions, useNow } from '../hooks.ts';
import { Icon } from './icon.tsx';
import { EASE, TONE_COLOR } from './motion.tsx';
import { ActionVerdict, AgentGlyph, AnimatedNumber, Avatar, Card, outcomeOf, Segmented, Skeleton, toneClass, type Tone } from './ui.tsx';

const WINDOWS = { '60': 60_000, '120': 120_000, '300': 300_000 } as const;
type WindowKey = keyof typeof WINDOWS;

const LEGEND: { tone: Tone; label: string }[] = [
  { tone: 'ok', label: 'Allowed' },
  { tone: 'wait', label: 'Waiting' },
  { tone: 'bad', label: 'Denied' },
  { tone: 'ai', label: 'AI tightened' },
];

function dotTone(action: ActionSummary): Tone {
  if (action.ai_tightened) return 'ai';
  return outcomeOf(action).tone;
}

const ticksFor = (ms: number) => {
  const s = ms / 1000;
  const label = (v: number) => (v >= 60 && v % 60 === 0 ? `${v / 60} min` : `${v} s`);
  return [label(s), label((s * 3) / 4), label(s / 2), label(s / 4), 'now'];
};

interface Hover {
  action: ActionSummary;
  x: number;
  y: number;
}

/**
 * One decision drifting from "now" on the right to the window's start on the left. The drift is a
 * single CSS animation whose negative delay is the action's age when the dot first rendered, so it
 * never needs a re-render to move.
 */
function LaneDot({ action, now, windowMs, onHover }: { action: ActionSummary; now: number; windowMs: number; onHover: (event: PointerEvent<HTMLElement> | null, action: ActionSummary) => void }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [age] = useState(() => Math.max(0, Date.now() - Date.parse(action.occurred_at)));
  const tone = dotTone(action);
  const outcome = outcomeOf(action);
  const loud = tone !== 'ok';
  const arrived = age < 2_000;
  const style = reduce
    ? { transform: `translateX(-${Math.min(100, ((now - Date.parse(action.occurred_at)) / windowMs) * 100)}%)`, animation: 'none' }
    : { animationName: 'lane-drift', animationDuration: `${windowMs}ms`, animationDelay: `-${age}ms` };
  return (
    <span className="lane-track" style={style}>
      <button
        type="button"
        onClick={() => navigate(`/traces/${encodeURIComponent(action.trace_id)}`)}
        onPointerEnter={(e) => onHover(e, action)}
        onPointerLeave={() => onHover(null, action)}
        aria-label={`${action.agent.id} ${action.capability}: ${outcome.label}`}
        className="group pointer-events-auto absolute top-1/2 right-0 flex h-8 w-8 translate-x-1/2 -translate-y-1/2 items-center justify-center"
      >
        {arrived && !reduce && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-1 rounded-full"
            style={{ boxShadow: `0 0 0 2.5px ${TONE_COLOR[tone]}` }}
            initial={{ scale: 0.4, opacity: 0.9 }}
            animate={{ scale: 2.8, opacity: 0 }}
            transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <motion.span
          initial={arrived && !reduce ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 16 }}
          className={`block rounded-full transition-transform duration-200 group-hover:scale-150 ${toneClass(tone).dot} ${loud ? 'h-[18px] w-[18px] ring-[3px] ring-surface' : 'h-3 w-3 opacity-75'} ${
            outcome.waiting ? 'waiting-ring' : ''
          }`}
          style={loud ? { boxShadow: `0 0 14px ${TONE_COLOR[tone]}` } : undefined}
        />
      </button>
    </span>
  );
}

/** Every decision of the last minutes, one lane per agent, drifting left as time passes. */
export function LiveLanes() {
  const agents = useAgents();
  const { actions } = useActions();
  const now = useNow(5_000);
  const reduce = useReducedMotion();
  const [windowKey, setWindowKey] = useState<WindowKey>('120');
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const windowMs = WINDOWS[windowKey];
  const lanes = useMemo(() => groupByTeam(agents.data ?? []).flatMap(([, list]) => list), [agents.data]);
  const byAgent = useMemo(() => {
    const out = new Map<string, ActionSummary[]>();
    for (const action of actions) {
      if (isObservation(action) || now - Date.parse(action.occurred_at) > windowMs) continue;
      out.set(action.agent.id, [...(out.get(action.agent.id) ?? []), action]);
    }
    return out;
  }, [actions, now, windowMs]);
  const total = [...byAgent.values()].reduce((sum, list) => sum + list.length, 0);
  const ticks = ticksFor(windowMs);

  const onHover = (event: PointerEvent<HTMLElement> | null, action: ActionSummary) => {
    if (!event || !area.current) {
      setHover((h) => (h?.action.trace_id === action.trace_id ? null : h));
      return;
    }
    const box = area.current.getBoundingClientRect();
    const dot = event.currentTarget.getBoundingClientRect();
    setHover({ action, x: dot.left + dot.width / 2 - box.left, y: dot.top - box.top });
  };

  if (agents.isPending) return <Skeleton className="h-80" />;
  if (!lanes.length) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-7 pt-7 pb-3 sm:px-8">
        <div className="min-w-0">
          <h2 className="flex items-center gap-3 text-[21px] font-bold tracking-[-0.02em] text-ink">
            <span className="relative flex h-3 w-3">
              <span className={`absolute inset-0 rounded-full bg-ok ${paused ? '' : 'animate-ping opacity-60'}`} />
              <span className={`relative h-3 w-3 rounded-full ${paused ? 'bg-ink-4' : 'bg-ok'}`} />
            </span>
            Live traffic
          </h2>
          <p className="mt-1.5 text-[14px] text-ink-3">
            <span className="font-semibold text-ink-2">
              <AnimatedNumber value={total} />
            </span>{' '}
            decisions in the window
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label="Window"
            value={windowKey}
            onChange={setWindowKey}
            options={[
              { value: '60', label: '1 min' },
              { value: '120', label: '2 min' },
              { value: '300', label: '5 min' },
            ]}
          />
          {!reduce && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              className={`press inline-flex h-12 items-center gap-2 rounded-[14px] border px-4 text-[14px] font-semibold transition-colors ${
                paused ? 'border-accent/40 bg-accent-soft text-accent-ink' : 'border-line bg-surface text-ink-2 hover:text-ink'
              }`}
            >
              <Icon name={paused ? 'play' : 'pause'} size={16} />
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 px-7 pb-2 text-[13px] font-medium text-ink-2 sm:px-8">
        {LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${toneClass(item.tone).dot}`} />
            {item.label}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[minmax(0,170px)_minmax(0,1fr)] px-7 pt-4 pb-7 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)] sm:px-8">
        <div>
          {lanes.map((agent) => (
            <Link key={agent.id} to={`/agents/${encodeURIComponent(agent.id)}`} className="group flex h-16 min-w-0 items-center gap-3 pr-5">
              <AgentGlyph state={agent.state} size={40} agentId={agent.id} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-ink transition-colors group-hover:text-accent-ink">{agent.id}</span>
                {agent.current_session && (
                  <span className="mt-0.5 hidden items-center gap-1.5 text-[12.5px] text-ink-3 sm:flex">
                    <Avatar name={agent.current_session.human.display_name} size={18} />
                    <span className="truncate">{agent.current_session.human.display_name}</span>
                  </span>
                )}
              </span>
              <span className="text-[14px] font-bold text-ink-2 tabular-nums">{byAgent.get(agent.id)?.length ?? 0}</span>
            </Link>
          ))}
        </div>
        <div ref={area} className={`relative ${paused ? 'lanes-paused' : ''}`}>
          {[25, 50, 75].map((x) => (
            <span key={x} aria-hidden="true" style={{ left: `${x}%` }} className="absolute top-0 h-[calc(100%-28px)] w-px border-l border-dashed border-line" />
          ))}
          <span aria-hidden="true" className="absolute top-0 right-0 h-[calc(100%-28px)] w-[2px] rounded-full bg-gradient-to-b from-ok via-ok/50 to-transparent" />
          <span aria-hidden="true" className="absolute top-0 right-0 h-[calc(100%-28px)] w-16 bg-gradient-to-l from-ok/[0.07] to-transparent" />
          {lanes.map((agent, i) => (
            <div key={agent.id} className={`relative h-16 overflow-visible ${i % 2 ? '' : 'bg-sunken/40'} rounded-l-xl`}>
              <span aria-hidden="true" className={`absolute inset-x-0 top-1/2 h-px ${agent.state === 'active' ? 'bg-line-strong/70' : 'bg-quar/30'}`} />
              {(byAgent.get(agent.id) ?? []).map((action) => (
                <LaneDot key={`${windowKey}:${action.trace_id}`} action={action} now={now} windowMs={windowMs} onHover={onHover} />
              ))}
            </div>
          ))}
          <div className="relative mt-3 h-4 text-[12px] font-medium text-ink-3">
            {ticks.map((label, i) => (
              <span
                key={label}
                style={{ left: `${i * 25}%` }}
                className={`absolute top-0 whitespace-nowrap tabular-nums ${i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full font-bold text-ok-ink' : '-translate-x-1/2'}`}
              >
                {label}
              </span>
            ))}
          </div>
          <AnimatePresence>
            {hover && (
              <motion.div
                key={hover.action.trace_id}
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97, transition: { duration: 0.12 } }}
                transition={{ duration: 0.18, ease: EASE }}
                style={{ left: Math.max(150, Math.min(hover.x, (area.current?.clientWidth ?? 0) - 150)), top: hover.y - 12 }}
                className="glass pointer-events-none absolute z-20 w-[300px] -translate-x-1/2 -translate-y-full rounded-[18px] p-4"
              >
                <div className="flex items-center gap-3">
                  <AgentGlyph size={36} agentId={hover.action.agent.id} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-bold text-ink">{hover.action.agent.id}</p>
                    <p className="truncate font-mono text-[12px] text-ink-3">{hover.action.capability}</p>
                  </div>
                  <ActionVerdict action={hover.action} size="sm" />
                </div>
                <p className="mt-3 truncate text-[13px] text-ink-2">on {hover.action.resource.id}</p>
                <div className="mt-3 flex items-center gap-2 border-t border-line/70 pt-3 text-[12.5px] text-ink-3">
                  {hover.action.human && <Avatar name={hover.action.human.display_name} size={20} />}
                  <span className="truncate">{hover.action.human?.display_name ?? 'No session'}</span>
                  <span className="ml-auto font-mono tabular-nums">{formatTime(hover.action.occurred_at)}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
}
