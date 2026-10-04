import { eventHub, useMe, useStreamStatus, useTraces } from '@betsee/api';
import {
  AnimatePresence,
  motion,
  useAnimate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useSignOut } from '../auth.tsx';
import { formatTime, initials } from '../domain/format.ts';
import { personByName, photoOf } from '../domain/people.ts';
import { useKpis } from '../hooks.ts';
import { markActivitySeen, useUnseenActivity } from '../live.ts';
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from '../nav.ts';
import { CommandPalette, useCommandPalette } from './command.tsx';
import { Icon, LogoMark, type IconName } from './icon.tsx';
import { EASE, SPRING } from './motion.tsx';
import { LiveToasts } from './toasts.tsx';
import { Avatar, ECOSYSTEM_URL } from './ui.tsx';

// Dock geometry, after the macOS Dock: tiles rest at BASE and swell to PEAK under the pointer,
// neighbours within REACH swelling less. The dock is a fixed strip; swollen tiles grow out of it.
const BASE = 54;
const PEAK = 86;
const REACH = 150;
const PAD = 14;
const DOCK_W = BASE + PAD * 2;
// Left margin + dock + gap before the page, read by Shell and the full-bleed canvases.
const RAIL = 16 + DOCK_W + 28;

const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

/** How big a tile is right now, from how far the pointer is from its centre along the dock. */
function useMagnify(pointer: MotionValue<number>) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const distance = useTransform(pointer, (y) => {
    const box = ref.current?.getBoundingClientRect();
    return box ? y - (box.top + box.height / 2) : Infinity;
  });
  const target = useTransform(distance, [-REACH, 0, REACH], reduce ? [BASE, BASE, BASE] : [BASE, PEAK, BASE]);
  const size = useSpring(target, { mass: 0.1, stiffness: 190, damping: 14 });
  return { ref, size };
}

/** A rounded, glossy app tile with a glyph that scales with it. */
function Tile({ size, tint, icon, children }: { size: MotionValue<number>; tint: [string, string]; icon?: IconName; children?: ReactNode }) {
  return (
    <motion.span
      style={{ width: size, height: size, background: `linear-gradient(160deg, ${tint[0]}, ${tint[1]})` }}
      className="relative flex shrink-0 items-center justify-center rounded-[27%] text-white shadow-[0_8px_18px_-6px_rgb(16_24_40/0.45),0_2px_4px_rgb(16_24_40/0.12),inset_0_1px_0_rgb(255_255_255/0.35),inset_0_-1px_0_rgb(0_0_0/0.15)]"
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/30 via-white/5 to-transparent" />
      {icon && <Icon name={icon} size={28} className="relative h-[48%] w-[48%] drop-shadow-[0_1px_1px_rgb(0_0_0/0.25)]" />}
      {children}
    </motion.span>
  );
}

function Label({ text, show }: { text: string; show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          role="tooltip"
          className="pointer-events-none absolute top-1/2 left-full z-50 ml-5 -translate-y-1/2 rounded-[10px] bg-ink/85 px-3 py-1.5 text-[13.5px] font-semibold whitespace-nowrap text-white shadow-lift backdrop-blur-md"
          initial={{ opacity: 0, x: -8, scale: 0.94 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -6, scale: 0.96, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 520, damping: 32 }}
        >
          <span aria-hidden="true" className="absolute top-1/2 -left-1 h-2.5 w-2.5 -translate-y-1/2 rotate-45 rounded-[2px] bg-ink/85" />
          {text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function Badge({ count, tone }: { count: number; tone: 'accent' | 'wait' }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          key="badge"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 18 }}
          className={`absolute -top-1.5 -right-1.5 z-10 flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11.5px] font-bold text-white tabular-nums ring-[2.5px] ring-white/90 ${
            tone === 'wait' ? 'bg-wait' : 'bg-accent'
          }`}
        >
          <motion.span key={count} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            {count > 99 ? '99+' : count}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** One place in the dock: the tile, the running dot when it is the current page, a bounce on click. */
function DockLink({ item, pointer, badge }: { item: NavItem; pointer: MotionValue<number>; badge?: number }) {
  const { pathname } = useLocation();
  const reduce = useReducedMotion();
  const { ref, size } = useMagnify(pointer);
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const [hover, setHover] = useState(false);
  const active = item.match.test(pathname);
  return (
    <motion.div ref={ref} style={{ height: size }} className="relative flex w-full items-center">
      {active && (
        <motion.span
          layoutId="dock-dot"
          className="absolute -left-[10px] h-[5px] w-[5px] rounded-full bg-ink/70"
          transition={reduce ? { duration: 0 } : SPRING}
        />
      )}
      <NavLink
        to={item.to}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onClick={() => {
          if (!reduce && scope.current) void animate(scope.current, { x: [0, 16, 0, 7, 0] }, { duration: 0.6, ease: 'easeOut' });
        }}
        className="relative block rounded-[27%]"
      >
        <span ref={scope} className="relative block">
          <Tile size={size} tint={item.tint} icon={item.icon} />
          {badge !== undefined && <Badge count={badge} tone="accent" />}
        </span>
        <Label text={item.label} show={hover} />
      </NavLink>
    </motion.div>
  );
}

function DockButton({ label, pointer, tint, icon, onClick, href, badge, children }: {
  label: string;
  pointer: MotionValue<number>;
  tint: [string, string];
  icon?: IconName;
  onClick?: () => void;
  href?: string;
  badge?: number;
  children?: ReactNode;
}) {
  const { ref, size } = useMagnify(pointer);
  const [hover, setHover] = useState(false);
  const inner = (
    <>
      <span className="relative block">
        <Tile size={size} tint={tint} icon={icon}>
          {children}
        </Tile>
        {badge !== undefined && <Badge count={badge} tone="wait" />}
      </span>
      <Label text={label} show={hover} />
    </>
  );
  const common = {
    'aria-label': label,
    onPointerEnter: () => setHover(true),
    onPointerLeave: () => setHover(false),
    className: 'relative block rounded-[27%]',
  };
  return (
    <motion.div ref={ref} style={{ height: size }} className="relative flex w-full items-center">
      {href ? (
        <a href={href} {...common}>
          {inner}
        </a>
      ) : (
        <button type="button" onClick={onClick} {...common}>
          {inner}
        </button>
      )}
    </motion.div>
  );
}

function Separator() {
  return <span aria-hidden="true" className="my-1 h-px w-[70%] shrink-0 self-center bg-ink/12" />;
}

function AccountMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const signOut = useSignOut();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) onClose();
    };
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', close);
      window.addEventListener('keydown', close);
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open, onClose]);
  if (!me.data) return null;
  const name = me.data.human.display_name;
  const title = personByName(name)?.title ?? me.data.roles.filter((r) => r === 'security-officer' || r === 'org-admin').join(', ');
  const organization = (me.data.organization as { name?: string } | undefined)?.name;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, x: -10, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -10, scale: 0.97 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="glass absolute bottom-0 left-full z-50 ml-5 w-72 origin-bottom-left rounded-[20px] p-2"
        >
          <div className="flex items-center gap-3 px-3 pt-3 pb-4">
            <Avatar name={name} size={44} />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-ink">{name}</p>
              <p className="truncate text-[12.5px] text-ink-3">{[title, organization].filter(Boolean).join(', ')}</p>
            </div>
          </div>
          <a href={ECOSYSTEM_URL} className="flex h-11 items-center gap-3 rounded-xl px-3 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-ink/[0.05] hover:text-ink">
            <Icon name="home" size={18} />
            Betsee ecosystem
          </a>
          {signOut && (
            <button type="button" onClick={signOut} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-ink/[0.05] hover:text-ink">
              <Icon name="log-out" size={18} />
              Sign out
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The account as the last item in the dock: the person's photo, magnifying like the tiles. */
function DockAccount({ pointer }: { pointer: MotionValue<number> }) {
  const me = useMe();
  const { ref, size } = useMagnify(pointer);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  if (!me.data) return null;
  const name = me.data.human.display_name;
  const person = personByName(name);
  return (
    <motion.div ref={ref} style={{ height: size }} className="relative flex w-full items-center">
      <button
        type="button"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        className="relative block rounded-full"
      >
        <motion.span
          style={{ width: size, height: size }}
          className="flex items-center justify-center overflow-hidden rounded-full bg-sunken text-[17px] font-bold text-ink-2 shadow-[0_8px_18px_-6px_rgb(16_24_40/0.45)] ring-[3px] ring-white"
        >
          {person ? <img src={photoOf(person)} alt="" draggable={false} className="h-full w-full object-cover" /> : initials(name)}
        </motion.span>
        <Label text={name} show={hover && !open} />
      </button>
      <AccountMenu open={open} onClose={() => setOpen(false)} />
    </motion.div>
  );
}

/**
 * The Director's navigation as a macOS-style dock on the left edge: app tiles that swell under the
 * pointer, labels beside them, a dot at the current place, and badges for what is new or waiting.
 */
function Dock({ onSearch }: { onSearch: () => void }) {
  const pointer = useMotionValue(Infinity);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { kpis } = useKpis();
  const unseen = useUnseenActivity();
  const onActivity = /^\/(activity|traces)/.test(pathname);
  useEffect(() => {
    if (onActivity) markActivitySeen();
  }, [onActivity, unseen]);
  return (
    <motion.nav
      aria-label="Director"
      onPointerMove={(e) => pointer.set(e.clientY)}
      onPointerLeave={() => pointer.set(Infinity)}
      initial={{ opacity: 0, x: -40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28, delay: 0.1 }}
      style={{ width: DOCK_W, paddingInline: PAD }}
      className="glass fixed top-1/2 left-4 z-40 hidden max-h-[calc(100vh-32px)] -translate-y-1/2 flex-col items-start gap-2.5 rounded-[30px] py-4 lg:flex"
    >
      <DockButton label="Director" pointer={pointer} tint={['#2b3646', '#0b111d']} onClick={() => navigate('/')}>
        <LogoMark size={28} className="relative h-[58%] w-[58%] drop-shadow-[0_1px_1px_rgb(0_0_0/0.25)]" />
      </DockButton>
      <Separator />
      {NAV_GROUPS.map((group, i) => (
        <div key={group.label} className="contents">
          {i > 0 && <Separator />}
          {group.items.map((item) => (
            <DockLink key={item.to} item={item} pointer={pointer} badge={item.to === '/activity' && !onActivity ? unseen : undefined} />
          ))}
        </div>
      ))}
      <Separator />
      <DockButton label={`Search (${SHORTCUT})`} pointer={pointer} tint={['#f4f6fb', '#d9dfea']} onClick={onSearch}>
        <Icon name="search" size={28} className="relative h-[46%] w-[46%] text-ink-2" />
      </DockButton>
      <DockButton
        label={kpis.awaitingHuman ? `${kpis.awaitingHuman} awaiting a human` : 'Approvals inbox'}
        pointer={pointer}
        tint={['#ffffff', '#e9edf4']}
        href={`${ECOSYSTEM_URL}/approvals`}
        badge={kpis.awaitingHuman}
      >
        <Icon name="inbox" size={28} className={`relative h-[46%] w-[46%] ${kpis.awaitingHuman ? 'text-wait' : 'text-ink-3'}`} />
      </DockButton>
      <DockAccount pointer={pointer} />
    </motion.nav>
  );
}

/** Below the large breakpoint the dock moves to the bottom edge, still as app tiles. */
function MobileDock({ onSearch }: { onSearch: () => void }) {
  const { pathname } = useLocation();
  const reduce = useReducedMotion();
  return (
    <nav aria-label="Director" className="glass fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[24px] px-2 py-2.5 lg:hidden">
      {NAV_ITEMS.map((item) => {
        const active = item.match.test(pathname);
        return (
          <NavLink key={item.to} to={item.to} aria-label={item.label} className="relative flex flex-col items-center">
            <motion.span
              whileTap={reduce ? undefined : { scale: 0.85 }}
              style={{ background: `linear-gradient(160deg, ${item.tint[0]}, ${item.tint[1]})` }}
              className="relative flex h-11 w-11 items-center justify-center rounded-[13px] text-white shadow-[0_6px_14px_-6px_rgb(16_24_40/0.5),inset_0_1px_0_rgb(255_255_255/0.35)]"
            >
              <Icon name={item.icon} size={21} />
            </motion.span>
            {active && <motion.span layoutId="mobile-dock-dot" className="absolute -bottom-2 h-1 w-1 rounded-full bg-ink/70" transition={reduce ? { duration: 0 } : SPRING} />}
          </NavLink>
        );
      })}
      <button type="button" aria-label="Search" onClick={onSearch} className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-surface text-ink-2 shadow-card">
        <Icon name="search" size={21} />
      </button>
    </nav>
  );
}

function OfflineBanner() {
  const traces = useTraces();
  const since = traces.dataUpdatedAt ? formatTime(new Date(traces.dataUpdatedAt).toISOString()) : undefined;
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="mb-8 flex items-center gap-3 rounded-2xl border border-bad/20 bg-bad-soft px-5 py-3.5 text-[14px] text-bad-ink"
    >
      <Icon name="alert" size={18} />
      <span className="flex-1">Gateway unreachable. {since ? `Showing data as of ${since}.` : 'Live updates are paused.'}</span>
      <button type="button" onClick={eventHub.retry} className="font-semibold underline-offset-4 hover:underline">
        Try again
      </button>
    </motion.div>
  );
}

/** The dock on the left and a roomy centred page. */
export function Shell({ children }: { children: ReactNode }) {
  const status = useStreamStatus();
  const palette = useCommandPalette();
  return (
    <div style={{ ['--rail' as string]: `${RAIL}px` }} className="min-h-screen overflow-x-clip text-ink">
      <Dock onSearch={palette.open} />
      <MobileDock onSearch={palette.open} />
      <div className="lg:pl-[var(--rail)]">
        <main className="mx-auto max-w-[1360px] px-5 pt-8 pb-44 sm:px-8 sm:pt-12 lg:px-12 lg:pt-14">
          <AnimatePresence>{status === 'offline' && <OfflineBanner />}</AnimatePresence>
          {children}
        </main>
      </div>
      <LiveToasts />
      <CommandPalette state={palette} />
    </div>
  );
}
