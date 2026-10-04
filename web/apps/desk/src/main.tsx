import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApi } from "@betsee/api";
import { App } from "./app";
import { bootstrap, configure, deskFetch, openExternal } from "./bridge";
import "@betsee/ui/styles.css";
import "./styles.css";

const connection = await bootstrap();
configure(connection);
// Chat calls go to the embedded governing service with the desk token, never a Keycloak token.
configureApi({ fetch: deskFetch, getAccessToken: () => null });

// Links to Betsee products open in the system browser, not inside the app window.
document.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement | null)?.closest("a");
  if (
    link &&
    /^https?:\/\//.test(link.href) &&
    !link.href.startsWith(location.origin)
  ) {
    event.preventDefault();
    void openExternal(link.href);
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
