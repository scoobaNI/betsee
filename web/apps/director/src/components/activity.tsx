import { useSecurityEvents, type ActionSummary } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useMatch } from 'react-router';
import { atLeastMedium, isObservation } from '../domain/decision.ts';
import { groupBursts, type FeedEntry } from '../domain/feed.ts';
import { formatDateTime, formatTime } from '../domain/format.ts';
import { Icon } from './icon.tsx';
import { TONE_COLOR, TONE_SOFT } from './motion.tsx';
import { ActionVerdict, AgentGlyph, Avatar, EASE, outcomeOf } from './ui.tsx';

const entryKey = (entry: FeedEntry) => entry.traceIds.at(-1)!;

function Mark({ action }: { action: ActionSummary }) {
  if (isObservation(action)) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-2">
        <Icon name="shield" size={18} />
      </span>
    );
  }
  return <AgentGlyph size={40} agentId={action.agent.id} />;
}

export function ActivityRow({
  entry,
  severity,
  flash,
  arrived,
  selected,
  hideAgent = false,
}: {
  entry: FeedEntry;
  severity?: string;
  /** A human just resolved this row's wait. */
  flash?: boolean;
  /** The row arrived while the list was on screen. */
  arrived?: boolean;
  selected?: boolean;
  hideAgent?: boolean;
}) {
  const { action, count } = entry;
  const outcome = outcomeOf(action);
  // Rows still waiting for a person read as tinted cards, so the eye finds them in a busy feed.
  const waiting = outcome.waiting && !isObservation(action);
  const observation = isObservation(action);
  // On an agent's own page its name adds nothing; the capability becomes the headline instead.
  const headline = observation ? 'Gateway' : hideAgent ? action.capability : action.agent.id;
  const person = !observation && action.human ? action.human.display_name : undefined;
  return (
    <Link
      to={`/traces/${encodeURIComponent(action.trace_id)}`}
      title={formatDateTime(action.occurred_at)}
      style={{ ['--flash' as string]: TONE_SOFT[outcome.tone], ['--edge' as string]: TONE_COLOR[outcome.tone] }}
      className={`group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-2xl px-3.5 py-3.5 transition-[background-color,box-shadow] duration-500 sm:grid-cols-[64px_40px_minmax(0,1fr)_auto_18px] sm:px-5 lg:grid-cols-[64px_40px_minmax(0,1fr)_200px_auto_18px] ${
        waiting ? 'my-1 bg-wait-soft/70 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-wait)_28%,transparent)] hover:bg-wait-soft' : 'row-hover'
      } ${selected ? 'bg-hover' : ''} ${flash || arrived ? 'flash-in' : ''}`}
    >
      {(arrived || flash) && <span key={`${flash}`} aria-hidden="true" className="arrive-edge" />}
      <time dateTime={action.occurred_at} className="hidden font-mono text-[12.5px] text-ink-3 tabular-nums sm:block">
        {formatTime(action.occurred_at)}
      </time>
      <span className="hidden sm:block">
        <Mark action={action} />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`truncate text-[15.5px] font-semibold text-ink ${hideAgent && !observation ? 'font-mono text-[14px]' : ''}`}>{headline}</span>
          {count > 1 && <span className="shrink-0 rounded-lg bg-sunken px-2 py-0.5 text-[12px] font-bold text-ink-2 tabular-nums">x{count}</span>}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[13.5px] text-ink-3">
          {!(hideAgent && !observation) && (
            <>
              <span className="shrink-0 font-mono text-[12.5px] text-ink-2">{action.capability}</span>
              <Icon name="arrow-right" size={13} className="text-ink-4" />
            </>
          )}
          <span className="truncate">{action.resource.id}</span>
        </span>
      </span>
      <span className="hidden min-w-0 items-center gap-2.5 lg:flex">
        {person && (
          <>
            <Avatar name={person} size={28} />
            <span className="truncate text-[13.5px] font-medium text-ink-2">{person}</span>
          </>
        )}
      </span>
      <span className="flex items-center gap-2">
        {observation && atLeastMedium(severity) && <span className="text-[12.5px] font-semibold text-bad-ink capitalize">{severity}</span>}
        <ActionVerdict action={action} size="sm" />
      </span>
      <Icon name="chevron-right" size={18} className="hidden text-ink-4 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-ink-2 sm:block" />
    </Link>
  );
}

function useAnnouncement(actions: readonly ActionSummary[]) {
  const known = useRef<Set<string> | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!known.current) {
      known.current = new Set(actions.map((a) => a.trace_id));
      return;
    }
    const fresh = actions.filter((a) => !known.current!.has(a.trace_id));
    for (const a of fresh) known.current.add(a.trace_id);
    if (!fresh.length) return;
    const denied = fresh.filter((a) => a.decision === 'deny').length;
    setMessage(`${fresh.length} new ${fresh.length === 1 ? 'action' : 'actions'}${denied ? `, ${denied} denied` : ''}`);
  }, [actions]);
  return message;
}

/**
 * Newest first, bursts folded into one row. While the pointer rests on the list, new rows wait
 * behind a "new" pill so nothing moves under the reader's hand.
 */
interface ItemProps {
  entry: FeedEntry;
  severity?: string;
  selected: boolean;
  flash: boolean;
  arrived: boolean;
  hideAgent?: boolean;
  reduce: boolean;
}

const sameItem = (a: ItemProps, b: ItemProps) =>
  a.entry.traceIds.length === b.entry.traceIds.length &&
  a.entry.action.trace_id === b.entry.action.trace_id &&
  a.entry.action.approval_state === b.entry.action.approval_state &&
  a.entry.action.decision === b.entry.action.decision &&
  a.severity === b.severity &&
  a.selected === b.selected &&
  a.flash === b.flash &&
  a.arrived === b.arrived &&
  a.hideAgent === b.hideAgent &&
  a.reduce === b.reduce;

/**
 * One row with its enter and exit motion. Memoised on what the row shows, so an event that adds
 * one row does not re-render the hundreds already on screen.
 */
const Item = memo(function Item({ entry, severity, selected, flash, arrived, hideAgent, reduce }: ItemProps) {
  return (
    <motion.li
      className="overflow-hidden"
      initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.42, ease: EASE }}
    >
      <motion.div
        initial={reduce ? false : { x: -14, filter: 'blur(4px)' }}
        animate={{ x: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <ActivityRow entry={entry} severity={severity} selected={selected} flash={flash} arrived={arrived} hideAgent={hideAgent} />
      </motion.div>
    </motion.li>
  );
}, sameItem);

const PAGE = 60;

export function ActivityList({ actions, limit, empty, hideAgent }: { actions: readonly ActionSummary[]; limit?: number; empty?: ReactNode; hideAgent?: boolean }) {
  const securityEvents = useSecurityEvents();
  const reduce = useReducedMotion();
  const match = useMatch('/traces/:traceId');
  const [hovered, setHovered] = useState(false);
  const [snapshot, setSnapshot] = useState<Set<string> | null>(null);
  // Without a fixed limit the list pages, so a long feed never renders hundreds of rows at once.
  const [pages, setPages] = useState(1);
  const seenPending = useRef(new Set<string>());
  const announcement = useAnnouncement(actions);
  // Rows on screen at first paint are history; anything keyed later arrived live.
  const atMount = useRef<Set<string> | null>(null);

  const severityByTrace = useMemo(() => new Map((securityEvents.data ?? []).map((e) => [e.trace_id, e.severity as string])), [securityEvents.data]);
  const all = useMemo(() => groupBursts(actions), [actions]);
  const cap = limit ?? pages * PAGE;
  const entries = useMemo(() => all.slice(0, cap), [all, cap]);
  const more = limit ? 0 : all.length - entries.length;

  useEffect(() => {
    if (hovered && !snapshot) setSnapshot(new Set(entries.map(entryKey)));
    if (!hovered && snapshot) setSnapshot(null);
  }, [hovered, snapshot, entries]);

  if (!atMount.current && entries.length) atMount.current = new Set(entries.map(entryKey));
  const visible = snapshot ? entries.filter((e) => snapshot.has(entryKey(e))) : entries;
  const queued = snapshot ? entries.length - visible.length : 0;

  const flashes = new Set<string>();
  for (const { action } of entries) {
    if (action.approval_state === 'pending') seenPending.current.add(action.trace_id);
    else if (action.approval_state !== 'none' && seenPending.current.has(action.trace_id)) flashes.add(action.trace_id);
  }

  if (!entries.length) return <>{empty}</>;

  return (
    <div className="relative" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <AnimatePresence>
        {queued > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="pointer-events-none sticky top-20 z-10 -mb-9 flex h-9 justify-center"
          >
            <motion.button
              type="button"
              onClick={() => setSnapshot(null)}
              whileHover={reduce ? undefined : { scale: 1.05 }}
              whileTap={reduce ? undefined : { scale: 0.95 }}
              className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-white shadow-lift"
            >
              <motion.span animate={reduce ? undefined : { y: [0, -2, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}>
                <Icon name="chevron-up" size={14} />
              </motion.span>
              <motion.span key={queued} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="tabular-nums">
                {queued}
              </motion.span>
              new
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      <ul className="divide-y divide-line/70">
        <AnimatePresence initial={false}>
          {visible.map((entry) => (
            <Item
              key={entryKey(entry)}
              entry={entry}
              severity={severityByTrace.get(entry.action.trace_id)}
              selected={entry.traceIds.includes(match?.params.traceId ?? '')}
              flash={flashes.has(entry.action.trace_id)}
              arrived={Boolean(atMount.current && !atMount.current.has(entryKey(entry)))}
              hideAgent={hideAgent}
              reduce={Boolean(reduce)}
            />
          ))}
        </AnimatePresence>
      </ul>
      {more > 0 && (
        <button
          type="button"
          onClick={() => setPages((p) => p + 1)}
          className="press mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-semibold text-ink-2 transition-colors hover:bg-hover hover:text-ink"
        >
          <Icon name="chevron-down" size={16} />
          Show {Math.min(PAGE, more)} more of {more}
        </button>
      )}
    </div>
  );
}
