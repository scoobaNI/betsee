import { configureApi } from '@betsee/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { User } from 'oidc-client-ts';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.tsx';
import { DirectorAuthProvider, RequireSignIn, SignOutProvider, oidcConfig } from './auth.tsx';
import { ErrorBoundary } from './components/error-boundary.tsx';
import { MockModeProvider } from './mock-mode.tsx';
import './director.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

async function boot(): Promise<ReactNode> {
  if (import.meta.env.VITE_BETSEE_MOCK === '1') {
    // Dynamic so that real builds leave the whole mock world out of the bundle.
    const { createMockWorld, createMockFetch } = await import('@betsee/api/mock');
    const world = createMockWorld({ seed: 7, variety: true, chats: true });
    world.start();
    configureApi({ fetch: createMockFetch(world), mock: true });
    return (
      <MockModeProvider value>
        <App />
      </MockModeProvider>
    );
  }

  const storageKey = `oidc.user:${oidcConfig.authority}:${oidcConfig.client_id}`;
  configureApi({
    getAccessToken: () => {
      const stored = window.sessionStorage.getItem(storageKey);
      return stored ? User.fromStorageString(stored).access_token : undefined;
    },
  });
  return (
    <DirectorAuthProvider>
      <RequireSignIn>
        <SignOutProvider>
          <MockModeProvider value={false}>
            <App />
          </MockModeProvider>
        </SignOutProvider>
      </RequireSignIn>
    </DirectorAuthProvider>
  );
}

void boot().then((app) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>{app}</BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
});
