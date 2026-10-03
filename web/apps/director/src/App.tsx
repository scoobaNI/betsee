import { useLiveSync, useMe } from '@betsee/api';
import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { LiveFeed } from './components/feed.tsx';
import { ErrorBoundary } from './components/error-boundary.tsx';
import { ScenarioDock } from './components/scenario-dock.tsx';
import { ECOSYSTEM_URL, Shell } from './components/shell.tsx';
import { ErrorCard, FullPageMessage } from './components/states.tsx';
import { AgentDrawer } from './pages/agent-drawer.tsx';
import { CoveragePage } from './pages/coverage.tsx';
import { GraphPage } from './pages/graph.tsx';
import { LivePage } from './pages/live.tsx';
import { TracePage } from './pages/trace.tsx';

const DIRECTOR_ROLES = ['security-officer', 'org-admin'];

const TITLES: [RegExp, string][] = [
  [/^\/traces\//, 'Trace'],
  [/^\/graph/, 'Graph'],
  [/^\/coverage/, 'Coverage'],
  [/^\/agents\//, 'Agent'],
];

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname.startsWith('/traces/')) return; // the trace page names its own id
    const page = TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Live';
    document.title = `${page} - Director - Betsee`;
  }, [pathname]);
}

function Director() {
  useLiveSync();
  useDocumentTitle();
  const { pathname } = useLocation();
  return (
    <Shell feed={<LiveFeed />} dock={<ScenarioDock />}>
      <ErrorBoundary key={pathname}>
      <Routes>
        <Route path="/" element={<LivePage />} />
        <Route path="/agents/:agentId" element={<LivePage />} />
        <Route path="/traces/:traceId" element={<TracePage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/coverage" element={<CoveragePage />} />
        <Route path="*" element={<LivePage />} />
      </Routes>
      </ErrorBoundary>
      <Routes>
        <Route path="/agents/:agentId" element={<AgentDrawer />} />
        <Route path="*" element={null} />
      </Routes>
    </Shell>
  );
}

/** Admits security officers and org admins only (D8); everything else is the Forbidden page. */
export function App() {
  const me = useMe();
  if (me.isPending) return <FullPageMessage title="Opening the Director" body="Checking who you are with the Gateway." />;
  if (me.isError) {
    return (
      <main className="dir-canvas flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <ErrorCard title="Could not reach the Gateway" error={me.error} onRetry={() => void me.refetch()} />
        </div>
      </main>
    );
  }
  if (!me.data.roles.some((role) => DIRECTOR_ROLES.includes(role))) {
    return (
      <FullPageMessage
        title="This needs another role"
        body="You need the security-officer or org-admin role to open the Director."
        action={{ label: 'Go to the Betsee ecosystem', href: ECOSYSTEM_URL }}
      />
    );
  }
  return <Director />;
}
