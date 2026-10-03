import { useApprovals, useSecurityEvents, useStreamStatus, useTraces, type ActionSummary } from '@betsee/api';
import { DecisionChip, Icon, TierBadge } from '@betsee/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatch } from 'react-router';
import { decisionLabel, isObservation, isVoided, outcomeTone, resolutionOf, withApprovalState } from '../domain/decision.ts';
import { GatewayMark, ObservedPill, VoidedChip } from './chips.tsx';
import { groupBursts, type FeedEntry } from '../domain/feed.ts';
import { formatDateTime, formatTime } from '../domain/format.ts';
import { EmptyState, ErrorCard, Skeleton } from './states.tsx';

const entryKey = (entry: FeedEntry) => entry.traceIds.at(-1)!;

// JetBrains Mono advances 0.6em, so a 13px agent id is exactly 7.8px per character; chip labels
// (12px semibold) average about 7px. The row picks the split chip only when the id stays whole.
const MONO_13 = 7.8;
const CHIP_CHAR = 7;
const CHIP_SEGMENT = 20 + 14 + 6; // padding, icon, gap
const LG_QUERY = '(min-width: 1440px)';

function useWideFeed() {
  const [wide, setWide] = useState(() => window.matchMedia(LG_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(LG_QUERY);
    const onChange = () => setWide(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}

export function splitChipFits(action: ActionSummary, count: number, rowWidth: number): boolean {
  const resolution = resolutionOf(action);
  const label = resolution ? resolution.length : decisionLabel[action.decision].length;
  const id = action.agent.id.length * MONO_13 + (count > 1 ? 8 + 12 + String(count).length * MONO_13 : 0);
  const chip = CHIP_SEGMENT + label * CHIP_CHAR + (action.ai_tightened ? CHIP_SEGMENT + 'AI-tightened'.length * CHIP_CHAR : 0);
  return id + 8 + chip <= rowWidth;
}

const RESOLVED_TINT = {
  allow: 'var(--bs-color-decision-allow-bg)',
  deny: 'var(--bs-color-decision-deny-bg)',
  approval: 'var(--bs-color-decision-approval-bg)',
  stepup: 'var(--bs-color-decision-stepup-bg)',
} as const;

export function chipHistory(action: ActionSummary): string | undefined {
  const resolution = resolutionOf(action);
  if (!resolution) return undefined;
  const from = action.decision === 'require_step_up' ? 'Awaiting step-up' : 'Awaiting approval';
  return `${from} -> ${resolution[0]!.toUpperCase()}${resolution.slice(1)}`;
}

function FeedRow({
  entry,
  selected,
  flash,
  rowWidth,
  severity,
}: {
  entry: FeedEntry;
  selected: boolean;
  flash: boolean;
  rowWidth: number;
  severity: string | undefined;
}) {
  const { action, count } = entry;
  const variant = splitChipFits(action, count, rowWidth) ? 'chip' : 'compact';
  const observation = isObservation(action);
  const deny = !observation && outcomeTone(action) === 'deny';
  const chip = {
    decision: action.decision,
    resolution: resolutionOf(action),
    aiTightened: action.ai_tightened,
    modelLabel: action.analyzer.model_label,
    controlIds: action.control_ids,
    history: chipHistory(action),
    size: 'sm' as const,
  };
  return (
    <Link
      to={`/traces/${encodeURIComponent(action.trace_id)}`}
      title={formatDateTime(action.occurred_at)}
      style={flash ? ({ '--dir-resolved-tint': RESOLVED_TINT[outcomeTone(action)] } as React.CSSProperties) : undefined}
      className={`relative flex min-h-14 flex-col justify-center gap-1 rounded-md px-3 py-2 hover:bg-surface-2 ${
        selected ? 'bg-surface-2' : ''
      } ${flash ? 'dir-row-resolved' : ''}`}
    >
      {deny && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-pill bg-deny-fg" />}
      <span className="flex items-center gap-2">
        {observation ? (
          <span className="flex shrink-0 items-center gap-2 text-sm font-medium">
            <GatewayMark />
            Gateway
          </span>
        ) : (
          <span className="shrink-0 font-mono text-sm font-medium">{action.agent.id}</span>
        )}
        {count > 1 && (
          <span className="rounded-xs border border-line-default px-1 font-mono text-2xs tabular-nums text-fg-secondary">x{count}</span>
        )}
        <span className="ml-auto flex shrink-0">
          {observation ? <ObservedPill severity={severity} /> : isVoided(action) ? <VoidedChip /> : <DecisionChip {...chip} variant={variant} />}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-fg-secondary">
        <time dateTime={action.occurred_at} className="shrink-0 font-mono text-2xs tabular-nums text-fg-tertiary">
          {formatTime(action.occurred_at)}
        </time>
        <span className="shrink-0 font-mono text-fg-primary">{action.capability}</span>
        <span className="min-w-0 truncate">{action.resource.id}</span>
        <TierBadge tier={action.resource.tier} className="ml-auto shrink-0" />
      </span>
    </Link>
  );
}

function useAnnouncement(actions: readonly ActionSummary[] | undefined) {
  const known = useRef<Set<string> | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!actions) return;
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

export function LiveFeed() {
  const traces = useTraces();
  const approvals = useApprovals();
  const securityEvents = useSecurityEvents();
  const status = useStreamStatus();
  const reduceMotion = useReducedMotion();
  const match = useMatch('/traces/:traceId');
  const scroller = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);
  const [snapshot, setSnapshot] = useState<Set<string> | null>(null);
  const seenPending = useRef(new Set<string>());
  const announcement = useAnnouncement(traces.data);
  // Feed panel 384 (>= 1440) or 320, minus list and row padding.
  const rowWidth = (useWideFeed() ? 384 : 320) - 40;

  // The approval record is authoritative; a trace's own approval_state can be stale (FAIL-1).
  const recordState = useMemo(() => new Map((approvals.data ?? []).map((a) => [a.trace_id, a.state as string])), [approvals.data]);
  const severityByTrace = useMemo(() => new Map((securityEvents.data ?? []).map((e) => [e.trace_id, e.severity as string])), [securityEvents.data]);
  const actions = useMemo(() => (traces.data ?? []).map((a) => withApprovalState(a, recordState)), [traces.data, recordState]);
  const entries = useMemo(() => groupBursts(actions), [actions]);
  const frozen = hovered || scrolledAway;

  useEffect(() => {
    if (frozen && !snapshot) setSnapshot(new Set(entries.map(entryKey)));
    if (!frozen && snapshot) setSnapshot(null);
  }, [frozen, snapshot, entries]);

  const visible = snapshot ? entries.filter((e) => snapshot.has(entryKey(e))) : entries;
  const queued = snapshot ? entries.length - visible.length : 0;

  const flashes = new Set<string>();
  for (const { action } of entries) {
    if (action.approval_state === 'pending') seenPending.current.add(action.trace_id);
    else if (action.approval_state !== 'none' && seenPending.current.has(action.trace_id)) flashes.add(action.trace_id);
  }

  const showQueued = () => {
    scroller.current?.scrollTo({ top: 0 });
    setScrolledAway(false);
    setSnapshot(null);
  };

  return (
    <section className="dir-overlay flex h-full flex-col rounded-xl border border-line-subtle shadow-e3">
      <header className="flex items-center gap-2 px-4 pb-2 pt-4">
        <h2 className="text-lg font-semibold">Live feed</h2>
        {status === 'live' && (
          <span className="inline-flex h-5 items-center gap-1.5 rounded-pill bg-accent-tint px-2 text-2xs font-semibold text-accent-text">
            <span className="bs-live-pulse h-1.5 w-1.5 rounded-pill bg-accent shadow-live" />
            Live
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {queued > 0 && (
            <button
              type="button"
              onClick={showQueued}
              className="rounded-pill bg-accent px-2.5 py-0.5 text-xs font-semibold text-fg-on-accent hover:bg-accent-hover"
            >
              {queued} new
            </button>
          )}
          <span className="text-xs tabular-nums text-fg-tertiary">{traces.data ? `${traces.data.length} actions` : ''}</span>
        </span>
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onScroll={(e) => setScrolledAway(e.currentTarget.scrollTop > 8)}
          className="h-full overflow-y-auto px-2 pb-3"
        >
          {traces.isPending && (
            <div className="space-y-2 px-1 pt-1">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-md" />
              ))}
            </div>
          )}
          {traces.isError && !traces.data && <ErrorCard title="Could not load the feed" error={traces.error} onRetry={() => void traces.refetch()} />}
          {traces.data && entries.length === 0 && (
            <EmptyState icon="streamline-flex:wave-signal-circle" title="No agent has acted yet" body="Launch Act 1 from the scenario dock, or start an agent." />
          )}
          <ul className="space-y-0.5">
            <AnimatePresence initial={false}>
              {visible.map((entry) => (
                <motion.li
                  key={entryKey(entry)}
                  layout={reduceMotion ? false : 'position'}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0.12 : 0.2, ease: [0, 0, 0, 1] }}
                >
                  <FeedRow
                    entry={entry}
                    severity={severityByTrace.get(entry.action.trace_id)}
                    rowWidth={rowWidth}
                    selected={entry.traceIds.includes(match?.params.traceId ?? '')}
                    flash={flashes.has(entry.action.trace_id)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </div>
      <footer className="flex items-center gap-2 border-t border-line-subtle px-4 py-2 text-2xs text-fg-tertiary">
        <Icon name="streamline-flex:information-circle" size={12} />
        Every row is a request the Gateway decided or an event it observed.
      </footer>
    </section>
  );
}
