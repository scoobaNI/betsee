import { WebStorageStateStore, type User } from 'oidc-client-ts';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { AuthProvider, useAuth } from 'react-oidc-context';
import { FullPageMessage } from './components/ui.tsx';

const authority = import.meta.env.VITE_OIDC_AUTHORITY ?? 'http://auth.betsee.localhost/realms/betsee';

export const oidcConfig = {
  authority,
  client_id: 'betsee-director',
  redirect_uri: `${window.location.origin}/`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'openid profile',
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  // Return to the page the sign-in started from, e.g. a trace link opened from Approvals.
  onSigninCallback: (user: User | void) => {
    const target = typeof user?.state === 'string' && user.state.startsWith('/') ? user.state : '/';
    window.history.replaceState({}, document.title, target);
    // The router only follows popstate; without it a deep link opened in a fresh tab lands on Live.
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
};

export function DirectorAuthProvider({ children }: { children: ReactNode }) {
  return <AuthProvider {...oidcConfig}>{children}</AuthProvider>;
}

/** Renders children once a human is signed in; otherwise starts the Keycloak redirect. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const shouldRedirect = !auth.isLoading && !auth.isAuthenticated && !auth.error && !auth.activeNavigator;

  useEffect(() => {
    if (shouldRedirect) {
      void auth.signinRedirect({ state: window.location.pathname + window.location.search });
    }
  }, [shouldRedirect, auth]);

  if (auth.error) {
    return (
      <FullPageMessage
        title="Sign-in did not complete"
        body={`Keycloak answered: ${auth.error.message}. The Director needs a signed-in security officer or org admin.`}
        action={{ label: 'Sign in again', onClick: () => void auth.signinRedirect() }}
      />
    );
  }
  if (!auth.isAuthenticated) return <FullPageMessage title="Signing in" body="Redirecting to Keycloak." />;
  return <>{children}</>;
}

// Mock mode renders without an AuthProvider, so sign-out comes through context instead of useAuth.
const SignOut = createContext<(() => void) | undefined>(undefined);

export function SignOutProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  return <SignOut.Provider value={auth.isAuthenticated ? () => void auth.signoutRedirect() : undefined}>{children}</SignOut.Provider>;
}

export const useSignOut = () => useContext(SignOut);
