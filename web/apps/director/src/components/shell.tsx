import { eventHub, useApprovals, useMe, useStreamStatus, useTraces } from '@betsee/api';
import { Icon, MockBadge, StreamStatus } from '@betsee/ui';
import { useMemo, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useSignOut } from '../auth.tsx';
import { isAwaitingHuman } from '../domain/decision.ts';
import { useMockMode } from '../mock-mode.tsx';
import { HumanAvatar } from './marks.tsx';
import { OfflineBanner } from './states.tsx';

export const ECOSYSTEM_URL = 'http://betsee.localhost';

const NAV = [
  { to: '/', label: 'Live', icon: 'streamline-flex:wave-signal-circle', end: true },
  { to: '/graph', label: 'Graph', icon: 'streamline-flex:hierarchy-2', end: false },
  { to: '/coverage', label: 'Coverage', icon: 'streamline-flex:shield-1', end: false },
];

function NavRail() {
  return (
    <nav aria-label="Director" className="flex w-(--bs-layout-dir-nav-rail) shrink-0 flex-col items-center gap-2 border-r border-line-subtle bg-surface-1 py-3">
      <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-sm bg-surface-3 text-accent-text" title="Director">
        <Icon name="streamline:eye-optic" size={16} />
      </span>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          title={item.label}
          aria-label={item.label}
          className={({ isActive }) =>
            `relative flex h-10 w-10 items-center justify-center rounded-md text-fg-secondary hover:bg-surface-2 hover:text-fg-primary ${
              isActive ? 'bg-surface-2 text-fg-primary before:absolute before:-left-3 before:top-2 before:h-6 before:w-0.5 before:rounded-pill before:bg-accent' : ''
            }`
          }
        >
          <Icon name={item.icon} size={20} />
        </NavLink>
      ))}
      <a
        href={ECOSYSTEM_URL}
        title="Betsee ecosystem"
        aria-label="Betsee ecosystem"
        className="mt-auto flex h-10 w-10 items-center justify-center rounded-md text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
      >
        <Icon name="streamline-flex:home-2" size={20} />
      </a>
    </nav>
  );
}

function AwaitingHuman() {
  const approvals = useApprovals();
  const traces = useTraces();
  // The Approvals list is authoritative; the feed covers the moment before it refetches.
  const count = useMemo(() => {
    const ids = new Set<string>();
    for (const a of approvals.data ?? []) if (a.state === 'pending') ids.add(a.trace_id);
    for (const t of traces.data ?? []) if (isAwaitingHuman(t)) ids.add(t.trace_id);
    return ids.size;
  }, [approvals.data, traces.data]);
  return (
    <a
      href={`${ECOSYSTEM_URL}/approvals`}
      className={`inline-flex h-7 items-center gap-2 rounded-pill border px-2.5 text-xs font-semibold ${
        count > 0 ? 'border-approval-border bg-approval-bg text-approval-fg' : 'border-line-default text-fg-secondary hover:border-line-strong'
      }`}
    >
      <Icon name="streamline-flex:inbox" size={14} />
      Awaiting human
      <span className="tabular-nums">{count}</span>
    </a>
  );
}

function TopBar({ onToggleFeed }: { onToggleFeed: () => void }) {
  const me = useMe();
  const status = useStreamStatus();
  const mock = useMockMode();
  const signOut = useSignOut();
  const organization = (me.data?.organization as { name?: string } | undefined)?.name ?? 'Acme Logistics';
  return (
    <header className="flex h-(--bs-layout-dir-topbar) shrink-0 items-center gap-3 border-b border-line-subtle px-5">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="font-display text-lg font-semibold">Director</span>
        <span className="truncate text-sm text-fg-secondary">{organization}</span>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {mock && <MockBadge label="Mock data" />}
        <StreamStatus status={status} />
        <AwaitingHuman />
        <button
          type="button"
          onClick={onToggleFeed}
          className="inline-flex h-7 items-center gap-2 rounded-pill border border-line-default px-2.5 text-xs font-semibold md:hidden"
        >
          <Icon name="streamline-flex:wave-signal-circle" size={14} />
          Feed
        </button>
        {me.data && (
          <span className="flex items-center gap-2 text-sm">
            <HumanAvatar name={me.data.human.display_name} size="sm" />
            <span className="hidden lg:inline">{me.data.human.display_name}</span>
          </span>
        )}
        {signOut && (
          <button type="button" onClick={signOut} title="Sign out" aria-label="Sign out" className="text-fg-secondary hover:text-fg-primary">
            <Icon name="streamline:logout-1" size={16} />
          </button>
        )}
      </div>
    </header>
  );
}

/**
 * Full-bleed operations room (contract 8.2): nav rail, top bar, content on the dot grid, the live
 * feed as a floating panel on the right, and the scenario dock floating over the content.
 */
export function Shell({ feed, dock, children }: { feed: ReactNode; dock: ReactNode; children: ReactNode }) {
  const [feedOpen, setFeedOpen] = useState(false);
  const status = useStreamStatus();
  const traces = useTraces();
  return (
    <div className="flex h-screen overflow-hidden bg-app text-fg-primary">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onToggleFeed={() => setFeedOpen((open) => !open)} />
        {status === 'offline' && (
          <OfflineBanner since={traces.dataUpdatedAt ? new Date(traces.dataUpdatedAt).toISOString() : undefined} onRetry={eventHub.retry} />
        )}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <main className="dir-canvas absolute inset-0 overflow-y-auto">
              <div className="px-6 pb-[calc(var(--bs-layout-dir-dock)+64px)] pt-5">{children}</div>
            </main>
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-(--bs-z-dock) flex justify-center">
              <div className="pointer-events-auto">{dock}</div>
            </div>
          </div>
          <aside
            aria-label="Live feed"
            className={`absolute inset-y-3 right-3 z-(--bs-z-rail) w-(--bs-layout-dir-feed) max-w-[calc(100%-24px)] md:static md:my-3 md:mr-3 md:block md:w-80 lg:w-(--bs-layout-dir-feed) ${
              feedOpen ? 'block' : 'hidden'
            }`}
          >
            {feed}
          </aside>
        </div>
      </div>
    </div>
  );
}
