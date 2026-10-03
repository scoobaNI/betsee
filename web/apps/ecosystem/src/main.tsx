import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { IdentityProvider } from "./auth";
import { mockMode } from "./auth";
import { configureApi } from "@betsee/api";
import { App } from "./app";
import "@betsee/ui/styles.css";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
  },
});
if (mockMode) {
  const { createMockWorld, createMockFetch } = await import("@betsee/api/mock");
  const world = createMockWorld({ autoResolveApprovals: false });
  configureApi({ fetch: createMockFetch(world), mock: true });
  world.start();
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IdentityProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </IdentityProvider>
    </QueryClientProvider>
  </StrictMode>,
);
