import {
  createContext,
  useContext,
  useRef,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { AuthProvider, useAuth } from "react-oidc-context";
import { WebStorageStateStore } from "oidc-client-ts";
import { configureApi } from "@betsee/api/client";
import { Icon, MockBadge } from "@betsee/ui";

export const mockMode = import.meta.env.VITE_BETSEE_MOCK === "1";
interface SessionAuth {
  name: string;
  acr: string;
  mock: boolean;
  signOut: () => void;
  stepUp: (approvalId: string) => Promise<void>;
}
const Session = createContext<SessionAuth | null>(null);
export function useSessionAuth() {
  const value = useContext(Session);
  if (!value) throw new Error("Session auth is missing");
  return value;
}

function LiveSession({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const accessToken = useRef(auth.user?.access_token);
  accessToken.current = auth.user?.access_token;
  useLayoutEffect(() => {
    configureApi({ getAccessToken: () => accessToken.current });
  }, []);
  if (auth.isLoading)
    return (
      <main className="mx-auto max-w-lg p-8">
        <p role="status">Connecting to Identity…</p>
      </main>
    );
  if (auth.error || !auth.isAuthenticated)
    return (
      <main className="mx-auto mt-24 max-w-lg rounded-xl border border-line-default bg-surface-1 p-8">
        <Icon name="streamline-flex:shield-2" size={28} />
        <p className="mt-6 font-display text-xl">Betsee</p>
        <h1 className="mt-2 font-display text-3xl">See every agent.</h1>
        <p className="mt-4 text-md text-fg-secondary">
          Sign in to Acme Logistics to see, govern and safely operate your
          agents.
        </p>
        {auth.error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            Sign-in failed: {auth.error.message}
          </p>
        )}
        <button
          className="mt-6 h-11 rounded-md bg-accent px-5 font-semibold text-fg-on-accent"
          onClick={() => {
            void auth.signinRedirect({
              state: { returnTo: location.pathname + location.search },
            });
          }}
        >
          Sign in with Identity
        </button>
      </main>
    );
  const value: SessionAuth = {
    name: String(
      auth.user?.profile.name ??
        auth.user?.profile.preferred_username ??
        "Human",
    ),
    acr: String(auth.user?.profile.acr ?? "1"),
    mock: false,
    signOut: () => {
      void auth.signoutRedirect();
    },
    stepUp: async (id) => {
      sessionStorage.setItem("betsee-step-up-approval", id);
      await auth.signinRedirect({
        acr_values: "2",
        prompt: "login",
        max_age: 0,
        state: { returnTo: "/approvals" },
      });
    },
  };
  return <Session.Provider value={value}>{children}</Session.Provider>;
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  if (mockMode)
    return (
      <Session.Provider
        value={{
          name: "Daniel Ortiz",
          acr: "1",
          mock: true,
          signOut: () => {},
          stepUp: async () => {
            throw new Error(
              "Mock data cannot verify MFA. Run the live stack and sign in with Identity to approve this transfer.",
            );
          },
        }}
      >
        {children}
      </Session.Provider>
    );
  return (
    <AuthProvider
      authority={
        import.meta.env.VITE_OIDC_AUTHORITY ??
        "http://auth.betsee.localhost/realms/betsee"
      }
      client_id="betsee-ecosystem"
      redirect_uri={`${location.origin}/auth/callback`}
      post_logout_redirect_uri={location.origin}
      response_type="code"
      scope="openid profile email"
      userStore={new WebStorageStateStore({ store: sessionStorage })}
      onSigninCallback={(user) => {
        const destination = (user?.state as { returnTo?: string } | undefined)
          ?.returnTo;
        history.replaceState(
          {},
          document.title,
          destination?.startsWith("/") && !destination.startsWith("//")
            ? destination
            : "/",
        );
      }}
    >
      <LiveSession>{children}</LiveSession>
    </AuthProvider>
  );
}

export function IdentityStatus() {
  const auth = useSessionAuth();
  return (
    <div className="flex items-center gap-3">
      {auth.mock && <MockBadge />}
      <span
        className="inline-flex h-8 w-8 items-center justify-center rounded-pill bg-surface-3 font-display text-sm"
        aria-hidden="true"
      >
        {auth.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </span>
      <span className="hidden text-sm lg:inline">{auth.name}</span>
      {!auth.mock && (
        <button title="Sign out" aria-label="Sign out" onClick={auth.signOut}>
          <Icon name="streamline:logout-1" />
        </button>
      )}
    </div>
  );
}
