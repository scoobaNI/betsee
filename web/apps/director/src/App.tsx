import { useLiveSync, useMe } from '@betsee/api';
import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { DemoDock } from './components/demo-dock.tsx';
import { ErrorBoundary } from './components/error-boundary.tsx';
import { Shell } from './components/shell.tsx';
import { ECOSYSTEM_URL, ErrorCard, FullPageMessage } from './components/ui.tsx';
import { ActivityPage } from './pages/activity.tsx';
import { AgentPage } from './pages/agent.tsx';
import { AgentsPage } from './pages/agents.tsx';
import { CoveragePage } from './pages/coverage.tsx';
import { GraphPage } from './pages/graph.tsx';
import { OverviewPage } from './pages/overview.tsx';
import { TracePage } from './pages/trace.tsx';

const DIRECTOR_ROLES = ['security-officer', 'org-admin'];

const TITLES: [RegExp, string][] = [
  [/^\/agents\/./, 'Agent'],
  [/^\/agents/, 'Agents'],
  [/^\/activity/, 'Activity'],
  [/^\/graph/, 'Graph'],
  [/^\/coverage/, 'Coverage'],
];

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname.startsWith('/traces/')) return; // the trace page names its own id
    const page = TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Overview';
    document.title = `${page} - Director - Betsee`;
  }, [pathname]);
}

function Director() {
  useLiveSync();
  useDocumentTitle();
  const { pathname } = useLocation();
  return (
    <Shell dock={<DemoDock />}>
      <ErrorBoundary key={pathname}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:agentId" element={<AgentPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/traces/:traceId" element={<TracePage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/coverage" element={<CoveragePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </Shell>
  );
}

/** Admits security officers and org admins only (D8); everything else is the Forbidden page. */
export function App() {
  const me = useMe();
  if (me.isPending) return <FullPageMessage title="Opening the Director" body="Checking who you are with the Gateway." />;
  if (me.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
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
