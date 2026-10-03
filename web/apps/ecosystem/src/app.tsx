import { Navigate, Route, Routes } from "react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { Shell } from "./layout";
const Home = lazy(() =>
  import("./pages/home").then((module) => ({ default: module.Home })),
);
const PolicyStudio = lazy(() =>
  import("./pages/policy-studio").then((module) => ({
    default: module.PolicyStudio,
  })),
);
const Identity = lazy(() =>
  import("./pages/identity").then((module) => ({ default: module.Identity })),
);
const Connect = lazy(() =>
  import("./pages/connect").then((module) => ({ default: module.Connect })),
);
const Approvals = lazy(() =>
  import("./pages/approvals").then((module) => ({ default: module.Approvals })),
);

function RouteLoading() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div aria-busy="true" aria-label="Loading product" className="min-h-48">
      {visible && <div className="bs-skeleton h-48 rounded-lg bg-surface-2" />}
    </div>
  );
}

export function App() {
  return (
    <Shell>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/auth/callback" element={<Navigate to="/" replace />} />
          <Route
            path="/policy-studio"
            element={<Navigate to="/policy-studio/controls" replace />}
          />
          <Route
            path="/policy-studio/:section/:id?"
            element={<PolicyStudio />}
          />
          <Route
            path="/identity"
            element={<Navigate to="/identity/agents" replace />}
          />
          <Route path="/identity/:section/:id?" element={<Identity />} />
          <Route
            path="/connect"
            element={<Navigate to="/connect/connectors" replace />}
          />
          <Route path="/connect/:section/:id?" element={<Connect />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route
            path="*"
            element={
              <div className="rounded-lg bg-surface-1 p-6">
                <h1 className="font-display text-3xl">Page not found</h1>
                <a href="/" className="mt-4 inline-block text-accent-text">
                  Return to Home
                </a>
              </div>
            }
          />
        </Routes>
      </Suspense>
    </Shell>
  );
}
