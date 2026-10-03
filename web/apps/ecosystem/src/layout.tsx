import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Icon, StreamStatus } from "@betsee/ui";
import { IdentityStatus } from "./auth";
import { useLiveSync, useStreamStatus } from "@betsee/api";
import { useApprovals, useEcosystemMe } from "@betsee/api/resources/ecosystem";

const navigation = [
  { href: "/", label: "Home", icon: "streamline-flex:home-2", end: true },
  {
    href: "/chat",
    label: "Chat",
    icon: "streamline-flex:chat-bubble-typing-oval",
  },
  { href: "/approvals", label: "Approvals", icon: "streamline-flex:inbox" },
  {
    href: "/policy-studio",
    label: "Policy Studio",
    icon: "streamline-flex:justice-scale-1",
  },
  {
    href: "/identity",
    label: "Identity",
    icon: "streamline-flex:user-identifier-card",
  },
  { href: "/connect", label: "Connect", icon: "streamline-flex:link-chain" },
];

export function Shell({ children }: { children: ReactNode }) {
  const approvals = useApprovals();
  const me = useEcosystemMe();
  useLiveSync();
  const stream = useStreamStatus();
  const pending = approvals.data?.filter((a) => a.state === "pending").length;
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  // The chat owns its full height: no page padding and no footer.
  const bleed = location.pathname.startsWith("/chat");
  useEffect(() => {
    setSearch("");
  }, [location.pathname]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  const found = navigation.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="eco-frame">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-surface-3 p-3 focus:not-sr-only focus:fixed"
      >
        Skip to content
      </a>
      <aside className="eco-rail">
        <Link
          to="/"
          className="flex items-center gap-3 px-4 py-7"
          aria-label="Betsee home"
        >
          <span className="rounded-sm bg-surface-3 p-2 text-accent-text">
            <Icon name="streamline-flex:shield-2" size={20} />
          </span>
          <div className="rail-label">
            <span className="font-display text-xl font-semibold">
              Betsee<span className="text-accent-text">.</span>
            </span>
            <p className="text-2xs text-fg-secondary">
              Enterprise agent control
            </p>
          </div>
        </Link>
        <p className="rail-label mt-4 px-5 text-2xs font-semibold tracking-widest text-fg-tertiary">
          PRODUCTS
        </p>
        <nav aria-label="Products" className="mt-3 space-y-1 px-3">
          {navigation.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-md px-3 text-md ${isActive ? "relative bg-surface-2 font-semibold text-fg-primary before:absolute before:-left-3 before:top-2.5 before:h-6 before:w-0.75 before:rounded-pill before:bg-accent" : "text-fg-secondary hover:bg-surface-1"}`
              }
            >
              <Icon name={item.icon} size={20} />
              <span className="rail-label">{item.label}</span>
              {item.href === "/approvals" &&
                pending !== undefined &&
                pending > 0 && (
                  <span className="rail-label ml-auto rounded-pill border border-approval-border bg-approval-bg px-2 text-xs text-approval-fg">
                    {pending}
                  </span>
                )}
            </NavLink>
          ))}
        </nav>
        <p className="rail-label mt-9 px-5 text-2xs font-semibold tracking-widest text-fg-tertiary">
          LIVE
        </p>
        <a
          href="http://director.betsee.localhost"
          title="Open Director"
          className="mx-3 mt-3 flex min-h-11 items-center gap-3 rounded-md px-3 text-md text-fg-secondary hover:bg-surface-1"
        >
          <Icon name="streamline:eye-optic" size={20} />
          <span className="rail-label">Director</span>
          <Icon
            name="streamline-flex:arrow-expand"
            size={14}
            className="rail-label ml-auto"
          />
        </a>
        <div className="rail-label mt-auto px-5 py-6">
          <p className="text-sm text-fg-secondary">Acme Logistics</p>
          <p className="mt-1 text-xs text-fg-tertiary">
            Nondeterministic agents.
            <br />
            Deterministic boundaries.
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="eco-topbar">
          <div className="relative max-w-sm flex-1">
            <label className="flex items-center gap-2 text-fg-secondary">
              <Icon name="streamline-flex:magnifying-glass" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Find a product"
                placeholder="Find a product"
                className="min-w-0 flex-1 bg-transparent text-sm"
              />
              <kbd className="hidden rounded-xs border border-line-default px-1.5 font-mono text-2xs md:inline">
                Ctrl K
              </kbd>
            </label>
            {search && (
              <div className="absolute left-0 right-0 top-9 z-30 rounded-lg border border-line-default bg-surface-3 p-2 shadow-e3">
                {found.length ? (
                  found.map((item) => (
                    <Link
                      className="block rounded-md p-2 text-md hover:bg-surface-2"
                      key={item.href}
                      to={item.href}
                    >
                      {item.label}
                    </Link>
                  ))
                ) : (
                  <p className="p-2 text-sm text-fg-secondary">
                    No matching product.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <StreamStatus status={me.isError ? "offline" : stream} />
            <a
              href="/approvals"
              aria-label={`${pending ?? 0} pending approvals`}
              title="Pending approvals"
              className="hidden text-fg-secondary md:inline"
            >
              <Icon name="streamline-flex:bell" size={20} />
            </a>
            <IdentityStatus />
          </div>
        </header>
        <main
          id="main-content"
          className={bleed ? "eco-content eco-content--bleed" : "eco-content"}
        >
          {children}
          {!bleed && (
            <footer className="mt-12 flex flex-wrap justify-between gap-3 border-t border-line-subtle pt-5 text-xs text-fg-tertiary">
              <span>Betsee · Better see what your agents do.</span>
              <a
                href="https://streamlinehq.com"
                target="_blank"
                rel="noreferrer"
              >
                Icons by Streamline (streamlinehq.com), CC BY 4.0
              </a>
            </footer>
          )}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  product,
  icon,
  title,
  purpose,
  children,
}: {
  product: string;
  icon: string;
  title: string;
  purpose: string;
  children?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} - ${product} - Betsee`;
  }, [title, product]);
  return (
    <header className="mb-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-sm bg-surface-3 p-2 text-accent-text">
            <Icon name={icon} />
          </span>
          <div>
            <p className="text-2xs font-semibold tracking-widest text-fg-tertiary">
              BETSEE
            </p>
            <p className="font-display text-lg font-semibold">{product}</p>
          </div>
        </div>
        {children}
      </div>
      <h1 className="mt-7 font-display text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-md text-fg-secondary">{purpose}</p>
    </header>
  );
}

export function Tabs({ items }: { items: { href: string; label: string }[] }) {
  const location = useLocation();
  return (
    <nav
      aria-label="Product sections"
      className="mb-7 flex w-fit flex-wrap gap-1 rounded-pill border border-line-subtle bg-surface-1 p-1"
    >
      {items.map((item) => {
        const target = new URL(item.href, "http://betsee.localhost");
        const active =
          location.pathname.startsWith(target.pathname) &&
          location.search === target.search;
        return (
          <Link
            key={item.href}
            to={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-pill px-4 py-2 text-sm font-medium ${active ? "bg-surface-3 text-fg-primary" : "text-fg-secondary hover:text-fg-primary"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
