import { eventHub, useMe, useStreamStatus, useTraces, type StreamStatus } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useSignOut } from '../auth.tsx';
import { formatTime } from '../domain/format.ts';
import { useKpis } from '../hooks.ts';
import { useOrgPulse } from '../live.ts';
import { useMockMode } from '../mock-mode.tsx';
import { Icon, type IconName } from './icon.tsx';
import { Burst, TONE_COLOR, usePop } from './motion.tsx';
import { LiveToasts } from './toasts.tsx';
import { Avatar, EASE, ECOSYSTEM_URL, outcomeOf, Wordmark } from './ui.tsx';

const NAV: { to: string; label: string; icon: IconName; match: RegExp }[] = [
  { to: '/', label: 'Overview', icon: 'overview', match: /^\/$/ },
  { to: '/agents', label: 'Agents', icon: 'bot', match: /^\/agents/ },
  { to: '/activity', label: 'Activity', icon: 'activity', match: /^\/(activity|traces)/ },
  { to: '/graph', label: 'Graph', icon: 'map', match: /^\/graph/ },
  { to: '/coverage', label: 'Coverage', icon: 'shield', match: /^\/coverage/ },
];

function Nav() {
  const { pathname } = useLocation();
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState<string | null>(null);
  const spring = reduce ? { duration: 0 } : ({ type: 'spring', stiffness: 500, damping: 42 } as const);
  return (
    <nav aria-label="Director" onPointerLeave={() => setHovered(null)} className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
      {NAV.map((item) => {
        const active = item.match.test(pathname);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onPointerEnter={() => setHovered(item.to)}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
            className={`press relative inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-[14px] font-medium transition-colors ${
              active ? 'text-ink' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {hovered === item.to && !active && (
              <motion.span layoutId="nav-hover" className="absolute inset-0 rounded-xl bg-hover" transition={spring} />
            )}
            {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-sunken shadow-[inset_0_0_0_1px_var(--color-line)]" transition={spring} />}
            <motion.span className="relative" animate={active && !reduce ? { rotate: [0, -8, 0], scale: [1, 1.15, 1] } : {}} transition={{ duration: 0.4 }}>
              <Icon name={item.icon} size={16} />
            </motion.span>
            <span className="relative hidden sm:inline">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

const STREAM: Record<StreamStatus, { label: string; dot: string; live?: boolean }> = {
  connecting: { label: 'Connecting', dot: 'bg-ink-4' },
  live: { label: 'Live', dot: 'bg-ok', live: true },
  stale: { label: 'Quiet', dot: 'bg-wait' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-wait' },
  offline: { label: 'Offline', dot: 'bg-bad' },
};

/** The stream state; while live, the dot beats once for every event the Gateway sends. */
function StreamIndicator() {
  const status = useStreamStatus();
  const { pulse } = useOrgPulse();
  const beat = usePop<HTMLSpanElement>(pulse.seq, 1.6);
  const s = STREAM[status];
  const tone = pulse.action ? outcomeOf(pulse.action).tone : 'ok';
  const title =
    status === 'stale' ? 'No event from the Gateway for 20 s; reconnecting soon.' : status === 'live' ? 'Receiving events from the Gateway as they happen.' : undefined;
  return (
    <span title={title} className="inline-flex h-8 items-center gap-2 rounded-full px-1 text-[13px] font-medium text-ink-2">
      <span className="relative flex h-2 w-2">
        {s.live && <Burst trigger={pulse.seq} color={TONE_COLOR[tone]} strength={3.2} />}
        <span ref={beat} className={`h-2 w-2 rounded-full transition-colors duration-500 ${s.dot} ${s.live ? 'live-dot' : ''}`} />
      </span>
      <span className="hidden md:inline">{s.label}</span>
    </span>
  );
}

function AwaitingPill() {
  const { kpis } = useKpis();
  const count = kpis.awaitingHuman;
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.a
          href={`${ECOSYSTEM_URL}/approvals`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.25, ease: EASE }}
          title="Open the approvals inbox in the Betsee ecosystem"
          className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-wait-soft px-3 text-[13px] font-medium text-wait-ink transition-colors hover:bg-[#fdecd0]"
        >
          <span className="waiting-ring h-1.5 w-1.5 rounded-full bg-wait" />
          <span className="inline-grid">
            <AnimatePresence initial={false}>
              <motion.span
                key={count}
                className="col-start-1 row-start-1 tabular-nums"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                {count}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="hidden sm:inline">awaiting a human</span>
        </motion.a>
      )}
    </AnimatePresence>
  );
}

function UserMenu() {
  const me = useMe();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  if (!me.data) return null;
  const organization = (me.data.organization as { name?: string } | undefined)?.name;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center rounded-full transition-shadow hover:ring-4 hover:ring-sunken"
      >
        <Avatar name={me.data.human.display_name} size={32} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="absolute top-11 right-0 z-50 w-64 origin-top-right rounded-2xl border border-line bg-surface p-2 shadow-pop"
          >
            <div className="px-3 pt-2 pb-3">
              <p className="text-[14px] font-semibold text-ink">{me.data.human.display_name}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">{[organization, me.data.roles.filter((r) => r === 'security-officer' || r === 'org-admin').join(', ')].filter(Boolean).join(' - ')}</p>
            </div>
            <a href={ECOSYSTEM_URL} className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-[14px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink">
              <Icon name="home" size={15} />
              Betsee ecosystem
            </a>
            {signOut && (
              <button type="button" onClick={signOut} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[14px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink">
                <Icon name="log-out" size={15} />
                Sign out
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function OfflineBanner() {
  const traces = useTraces();
  const since = traces.dataUpdatedAt ? formatTime(new Date(traces.dataUpdatedAt).toISOString()) : undefined;
  return (
    <motion.div
      role="alert"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="overflow-hidden border-b border-line bg-bad-soft"
    >
      <div className="mx-auto flex max-w-[1160px] items-center gap-3 px-6 py-2.5 text-[14px] text-bad-ink md:px-10">
        <Icon name="alert" size={16} />
        <span className="flex-1">Gateway unreachable. {since ? `Showing data as of ${since}.` : 'Live updates are paused.'}</span>
        <button type="button" onClick={eventHub.retry} className="font-medium underline-offset-4 hover:underline">
          Try again
        </button>
      </div>
    </motion.div>
  );
}

/** One calm column: a slim header with the five places, the page, and the demo dock floating below. */
export function Shell({ dock, children }: { dock: ReactNode; children: ReactNode }) {
  const status = useStreamStatus();
  const mock = useMockMode();
  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-[1160px] items-center gap-3 px-4 sm:gap-6 sm:px-6 md:px-10">
          <NavLink to="/" aria-label="Director overview" className="shrink-0">
            <Wordmark compact />
          </NavLink>
          <span aria-hidden="true" className="hidden h-6 w-px bg-line md:block" />
          <Nav />
          <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-4">
            {mock && <span className="hidden rounded-full bg-sunken px-2.5 py-1 text-[12px] font-medium text-ink-3 lg:inline">Mock data</span>}
            <AwaitingPill />
            <StreamIndicator />
            <UserMenu />
          </div>
        </div>
      </header>
      <AnimatePresence>{status === 'offline' && <OfflineBanner />}</AnimatePresence>
      <main className="mx-auto max-w-[1160px] px-4 pt-8 pb-36 sm:px-6 sm:pt-10 md:px-10 md:pt-14">{children}</main>
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center overflow-hidden px-4">
        <div className="pointer-events-auto">{dock}</div>
      </div>
      <LiveToasts />
    </div>
  );
}
