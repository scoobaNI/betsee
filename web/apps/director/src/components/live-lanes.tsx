import { useAgents, type ActionSummary } from '@betsee/api';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { isObservation } from '../domain/decision.ts';
import { groupByTeam } from '../domain/feed.ts';
import { formatTime } from '../domain/format.ts';
import { useActions, useNow } from '../hooks.ts';
import { TONE_COLOR } from './motion.tsx';
import { AgentGlyph, AnimatedNumber, Card, outcomeOf, Skeleton, toneClass, type Tone } from './ui.tsx';

const WINDOW_MS = 120_000;
const TICKS = ['2 min', '90 s', '60 s', '30 s', 'now'];

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

/**
 * One decision drifting from "now" on the right to the window's start on the left. The drift is a
 * single CSS animation whose negative delay is the action's age when the dot first rendered, so it
 * never needs a re-render to move.
 */
function LaneDot({ action, now }: { action: ActionSummary; now: number }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [age] = useState(() => Math.max(0, Date.now() - Date.parse(action.occurred_at)));
  const tone = dotTone(action);
  const outcome = outcomeOf(action);
  const loud = tone !== 'ok';
  const arrived = age < 2_000;
  const style = reduce
    ? { transform: `translateX(-${Math.min(100, ((now - Date.parse(action.occurred_at)) / WINDOW_MS) * 100)}%)` }
    : { animationName: 'lane-drift', animationDuration: `${WINDOW_MS}ms`, animationDelay: `-${age}ms` };
  return (
    <span className="lane-track" style={reduce ? { ...style, animation: 'none' } : style}>
      <button
        type="button"
        onClick={() => navigate(`/traces/${encodeURIComponent(action.trace_id)}`)}
        title={`${formatTime(action.occurred_at)}  ${action.capability} on ${action.resource.id}: ${outcome.label}`}
        aria-label={`${action.agent.id} ${action.capability}: ${outcome.label}`}
        className="group pointer-events-auto absolute top-1/2 right-0 flex h-5 w-5 translate-x-1/2 -translate-y-1/2 items-center justify-center"
      >
        {arrived && !reduce && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 2px ${TONE_COLOR[tone]}` }}
            initial={{ scale: 0.4, opacity: 0.9 }}
            animate={{ scale: 2.6, opacity: 0 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <motion.span
          initial={arrived && !reduce ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 18 }}
          className={`block rounded-full transition-transform duration-200 group-hover:scale-150 ${toneClass(tone).dot} ${
            loud ? 'h-3 w-3 ring-2 ring-surface' : 'h-2 w-2 opacity-70'
          } ${outcome.waiting ? 'waiting-ring' : ''}`}
          style={loud ? { boxShadow: `0 0 10px ${TONE_COLOR[tone]}` } : undefined}
        />
      </button>
    </span>
  );
}

/** Every decision of the last two minutes, one lane per agent, drifting left as time passes. */
export function LiveLanes() {
  const agents = useAgents();
  const { actions } = useActions();
  const now = useNow(5_000);
  const lanes = useMemo(() => groupByTeam(agents.data ?? []).flatMap(([, list]) => list), [agents.data]);
  const byAgent = useMemo(() => {
    const out = new Map<string, ActionSummary[]>();
    for (const action of actions) {
      if (isObservation(action) || now - Date.parse(action.occurred_at) > WINDOW_MS) continue;
      out.set(action.agent.id, [...(out.get(action.agent.id) ?? []), action]);
    }
    return out;
  }, [actions, now]);
  const total = [...byAgent.values()].reduce((sum, list) => sum + list.length, 0);

  if (agents.isPending) return <Skeleton className="h-64" />;
  if (!lanes.length) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 pt-5 pb-2">
        <span className="flex items-center gap-2.5">
          <span className="live-dot h-2 w-2 rounded-full bg-ok" />
          <span className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Live traffic</span>
        </span>
        <span className="text-[13px] text-ink-3">
          <AnimatedNumber value={total} /> decisions in the last 2 minutes. Each dot is one; click it for its trace.
        </span>
        <ul className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${toneClass(item.tone).dot}`} />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-[minmax(0,148px)_minmax(0,1fr)] px-6 pt-3 pb-5 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
        <div>
          {lanes.map((agent) => (
            <Link
              key={agent.id}
              to={`/agents/${encodeURIComponent(agent.id)}`}
              className="group flex h-10 min-w-0 items-center gap-2.5 pr-4 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
            >
              <AgentGlyph state={agent.state} size={24} agentId={agent.id} />
              <span className="truncate">{agent.id}</span>
              <span className="ml-auto text-[12px] font-normal text-ink-3 tabular-nums">{byAgent.get(agent.id)?.length ?? 0}</span>
            </Link>
          ))}
        </div>
        <div className="relative">
          {[25, 50, 75].map((x) => (
            <span key={x} aria-hidden="true" style={{ left: `${x}%` }} className="absolute top-0 h-full w-px border-l border-dashed border-line" />
          ))}
          <span aria-hidden="true" className="absolute top-0 right-0 h-full w-px bg-gradient-to-b from-ok/70 to-ok/10" />
          <span aria-hidden="true" className="live-dot absolute -top-1 right-0 h-2 w-2 translate-x-1/2 rounded-full bg-ok" />
          {lanes.map((agent) => (
            <div key={agent.id} className="relative h-10 overflow-visible">
              <span aria-hidden="true" className={`absolute inset-x-0 top-1/2 h-px ${agent.state === 'active' ? 'bg-line' : 'bg-quar/30'}`} />
              {(byAgent.get(agent.id) ?? []).map((action) => (
                <LaneDot key={action.trace_id} action={action} now={now} />
              ))}
            </div>
          ))}
          <div className="relative mt-2 h-4 text-[11px] text-ink-3">
            {TICKS.map((label, i) => (
              <span
                key={label}
                style={{ left: `${i * 25}%` }}
                className={`absolute top-0 whitespace-nowrap tabular-nums ${i === 0 ? '' : i === TICKS.length - 1 ? '-translate-x-full font-medium text-ok-ink' : '-translate-x-1/2'}`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
