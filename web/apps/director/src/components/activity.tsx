import { useSecurityEvents, type ActionSummary } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useMatch } from 'react-router';
import { atLeastMedium, isObservation } from '../domain/decision.ts';
import { groupBursts, type FeedEntry } from '../domain/feed.ts';
import { formatDateTime, formatTime } from '../domain/format.ts';
import { Icon } from './icon.tsx';
import { ActionVerdict, EASE } from './ui.tsx';

const entryKey = (entry: FeedEntry) => entry.traceIds.at(-1)!;

function Actor({ action }: { action: ActionSummary }) {
  if (isObservation(action)) {
    return (
      <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-sunken text-ink-2">
          <Icon name="shield" size={12} />
        </span>
        Gateway
      </span>
    );
  }
  return <span className="truncate text-[14px] font-medium text-ink">{action.agent.id}</span>;
}

export function ActivityRow({
  entry,
  severity,
  flash,
  selected,
  hideAgent = false,
}: {
  entry: FeedEntry;
  severity?: string;
  flash?: boolean;
  selected?: boolean;
  hideAgent?: boolean;
}) {
  const { action, count } = entry;
  // On an agent's own page its name adds nothing; the capability becomes the headline instead.
  const headline = hideAgent && !isObservation(action) ? <span className="truncate text-[14px] font-medium text-ink">{action.capability}</span> : <Actor action={action} />;
  return (
    <Link
      to={`/traces/${encodeURIComponent(action.trace_id)}`}
      title={formatDateTime(action.occurred_at)}
      className={`group row-hover grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 sm:grid-cols-[56px_minmax(0,1fr)_auto_16px] sm:gap-4 sm:px-4 ${selected ? 'bg-hover' : ''} ${flash ? 'flash-in' : ''}`}
    >
      <time dateTime={action.occurred_at} className="hidden font-mono text-[12px] text-ink-3 tabular-nums sm:block">
        {formatTime(action.occurred_at)}
      </time>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          {headline}
          {count > 1 && <span className="shrink-0 rounded-md bg-sunken px-1.5 text-[12px] font-medium text-ink-2 tabular-nums">x{count}</span>}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-3">
          {!(hideAgent && !isObservation(action)) && (
            <>
              <span className="shrink-0 text-ink-2">{action.capability}</span>
              <Icon name="arrow-right" size={12} className="text-ink-4" />
            </>
          )}
          <span className="truncate">{action.resource.id}</span>
        </span>
      </span>
      <span className="flex items-center gap-2">
        {isObservation(action) && atLeastMedium(severity) && (
          <span className="text-[12px] font-medium text-bad-ink capitalize">{severity}</span>
        )}
        <ActionVerdict action={action} size="sm" />
      </span>
      <Icon name="chevron-right" size={16} className="hidden text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 sm:block" />
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
export function ActivityList({ actions, limit, empty, hideAgent }: { actions: readonly ActionSummary[]; limit?: number; empty?: ReactNode; hideAgent?: boolean }) {
  const securityEvents = useSecurityEvents();
  const reduce = useReducedMotion();
  const match = useMatch('/traces/:traceId');
  const [hovered, setHovered] = useState(false);
  const [snapshot, setSnapshot] = useState<Set<string> | null>(null);
  const seenPending = useRef(new Set<string>());
  const announcement = useAnnouncement(actions);

  const severityByTrace = useMemo(() => new Map((securityEvents.data ?? []).map((e) => [e.trace_id, e.severity as string])), [securityEvents.data]);
  const entries = useMemo(() => {
    const all = groupBursts(actions);
    return limit ? all.slice(0, limit) : all;
  }, [actions, limit]);

  useEffect(() => {
    if (hovered && !snapshot) setSnapshot(new Set(entries.map(entryKey)));
    if (!hovered && snapshot) setSnapshot(null);
  }, [hovered, snapshot, entries]);

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
            <button
              type="button"
              onClick={() => setSnapshot(null)}
              className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-white shadow-lift"
            >
              <Icon name="chevron-up" size={14} />
              {queued} new
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <ul className="divide-y divide-line/70">
        <AnimatePresence initial={false}>
          {visible.map((entry) => (
            <motion.li
              key={entryKey(entry)}
              layout={reduce ? false : 'position'}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
            >
              <ActivityRow
                entry={entry}
                severity={severityByTrace.get(entry.action.trace_id)}
                selected={entry.traceIds.includes(match?.params.traceId ?? '')}
                flash={flashes.has(entry.action.trace_id)}
                hideAgent={hideAgent}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
