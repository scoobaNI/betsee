import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon, IdToken, LogoMark, TierBadge } from "@betsee/ui";
import { chatApi, useChatThread, type ChatSession } from "@betsee/api/chat";
import {
  AGENT,
  AgentMark,
  Composer,
  GovernedMarker,
  Thread,
  time,
} from "@betsee/chat";
import {
  desk,
  native,
  openSignIn,
  pickFiles,
  readDropped,
  readFiles,
  saveFile,
  type PickedFile,
} from "./bridge";

type RuntimeId = "claude" | "codex";

interface RuntimeStatus {
  runtime: RuntimeId;
  label: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  logged_in: boolean;
  auth: string;
  detail: string;
}

interface DeskState {
  signed_in: boolean;
  human: { sub: string; display_name: string } | null;
  runtime: RuntimeId;
  runtimes: RuntimeStatus[];
  workspace: string;
  gateway: string;
}

interface WorkspaceFile {
  path: string;
  size: number;
  modified: number | null;
}

const CONTROLS = [
  ["CTL-IN-001", "What you type is checked first"],
  ["CTL-FILE-001", "Files are scanned in and out"],
  ["CTL-RT-001", "Every tool call asks the Gateway"],
] as const;

const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={36} className="text-fg-primary" />
      <div>
        <p className="font-display text-xl font-semibold">
          Betsee<span className="text-accent-text">.</span> Desk
        </p>
        <p className="text-2xs text-fg-secondary">Governed AI workspace</p>
      </div>
    </div>
  );
}

function Notice({
  tone,
  children,
  onDismiss,
}: {
  tone: "deny" | "info";
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={tone === "deny" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-md border p-3 text-sm ${tone === "deny" ? "border-deny-border bg-deny-bg text-deny-fg" : "border-line-default bg-surface-1 text-fg-secondary"}`}
    >
      <p className="min-w-0 flex-1">{children}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="-m-1 rounded-xs p-1 text-fg-tertiary hover:bg-surface-2 hover:text-fg-primary"
        >
          <Icon name="streamline:delete-1" size={12} />
        </button>
      )}
    </div>
  );
}

function SignIn({ error }: { error: string | null }) {
  const [opened, setOpened] = useState(false);
  return (
    <main className="grid min-h-screen place-items-center bg-app p-6">
      <section className="w-full max-w-md rounded-xl bg-surface-1 p-8 shadow-e2">
        <Brand />
        <h1 className="mt-8 font-display text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-md text-fg-secondary">Acme Logistics</p>
        {error && (
          <div className="mt-5">
            <Notice tone="deny">{error}</Notice>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setOpened(true);
            void openSignIn();
          }}
          className="mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-5 font-semibold text-fg-on-accent hover:bg-accent-hover"
        >
          <Icon name="streamline-flex:user-identifier-card" size={16} />
          Continue with SSO
        </button>
        {opened && (
          <p
            className="mt-4 text-center text-sm text-fg-secondary"
            role="status"
          >
            Waiting for browser sign-in...
          </p>
        )}
      </section>
    </main>
  );
}

function RuntimeCard({
  status,
  selected,
  onSelect,
  onChanged,
}: {
  status: RuntimeStatus;
  selected: boolean;
  onSelect: () => void;
  onChanged: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "deny" | "info";
    text: string;
  } | null>(null);
  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage({ tone: "info", text: done });
      setKey("");
      onChanged();
    } catch (error) {
      setMessage({
        tone: "deny",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };
  const ready = status.installed && status.logged_in;
  return (
    <article
      className={`flex flex-col rounded-lg p-5 ${selected ? "bg-surface-2 shadow-selected" : "bg-surface-1 shadow-e1"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-surface-3 text-accent-text">
            <Icon
              name={
                status.runtime === "codex"
                  ? "streamline-flex:code-monitor-1"
                  : "streamline-flex:ai-chip-robot"
              }
              size={22}
            />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">
              {status.label}
            </h2>
            <p className="font-mono text-xs text-fg-secondary">
              {status.version ?? "not installed"}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex h-6 items-center gap-1.5 rounded-pill border px-2 text-xs font-semibold ${ready ? "border-allow-border bg-allow-bg text-allow-fg" : "border-approval-border bg-approval-bg text-approval-fg"}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-pill ${ready ? "bg-allow-fg" : "bg-approval-fg"}`}
          />
          {ready
            ? "Ready"
            : status.installed
              ? "Not signed in"
              : "Not installed"}
        </span>
      </div>
      <p className="mt-4 text-sm text-fg-secondary">{status.detail}</p>
      {status.logged_in && (
        <p className="mt-1 text-xs text-fg-tertiary">
          Using{" "}
          {status.auth === "api_key"
            ? "your API key"
            : status.auth === "chatgpt"
              ? "your ChatGPT sign-in"
              : "your own sign-in"}
          .
        </p>
      )}
      {status.installed && (
        <div className="mt-5 space-y-3">
          {status.runtime === "codex" && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => desk("/desk/runtime/codex/import", {}),
                  "Your Codex sign-in is linked to Betsee Desk.",
                )
              }
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-surface-3 px-3 text-sm font-medium hover:bg-surface-2"
            >
              <Icon name="streamline-flex:link-chain" size={14} />
              Use my Codex sign-in
            </button>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (key.trim())
                void act(
                  () =>
                    desk("/desk/runtime/key", { runtime: status.runtime, key }),
                  "Key saved. It stays on this computer.",
                );
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">
                {status.runtime === "codex"
                  ? "OpenAI API key"
                  : "Anthropic API key"}
              </span>
              <input
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={
                  status.runtime === "codex"
                    ? "OpenAI API key"
                    : "Anthropic API key"
                }
                autoComplete="off"
                className="h-9 w-full rounded-md border border-line-default bg-surface-inset px-3 font-mono text-sm focus:border-line-focus focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !key.trim()}
              className="h-9 rounded-md bg-surface-3 px-3 text-sm font-medium hover:bg-surface-2"
            >
              Save key
            </button>
          </form>
          {status.runtime === "claude" && status.auth === "api_key" && (
            <button
              type="button"
              className="text-xs text-fg-secondary underline"
              onClick={() =>
                void act(
                  () =>
                    desk("/desk/runtime/key", { runtime: "claude", key: null }),
                  "Key removed.",
                )
              }
            >
              Remove saved key
            </button>
          )}
          {status.runtime === "claude" && (
            <p className="text-xs text-fg-tertiary">
              Or sign in with your Claude plan: run{" "}
              <code className="rounded-xs bg-surface-3 px-1 font-mono">
                claude auth login
              </code>{" "}
              in a terminal.
            </p>
          )}
        </div>
      )}
      {message && (
        <div className="mt-4">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      <button
        type="button"
        onClick={onSelect}
        disabled={!ready}
        aria-pressed={selected}
        className={`mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 pt-0 text-sm font-semibold ${selected ? "bg-accent text-fg-on-accent" : ready ? "bg-surface-3 hover:bg-surface-2" : "bg-surface-3 text-fg-disabled"}`}
        style={{ marginTop: 20 }}
      >
        {selected ? "Selected" : `Use ${status.label}`}
      </button>
    </article>
  );
}

function Setup({
  state,
  onChanged,
  onDone,
}: {
  state: DeskState;
  onChanged: () => void;
  onDone: () => void;
}) {
  const selected = state.runtimes.find((r) => r.runtime === state.runtime);
  return (
    <main className="min-h-screen bg-app p-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <Brand />
          <span className="text-sm text-fg-secondary">
            {state.human?.display_name}
          </span>
        </div>
        <h1 className="mt-10 font-display text-3xl font-semibold">
          Choose your assistant
        </h1>
        <p className="mt-2 max-w-2xl text-md text-fg-secondary">
          Bring your own Claude Code or Codex sign-in, or an API key. Whichever
          you use, it runs inside Betsee: the Gateway decides every action and
          every file before it happens.
        </p>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {state.runtimes.map((status) => (
            <RuntimeCard
              key={status.runtime}
              status={status}
              selected={status.runtime === state.runtime}
              onChanged={onChanged}
              onSelect={() =>
                void desk("/desk/runtime", { runtime: status.runtime }).then(
                  onChanged,
                )
              }
            />
          ))}
        </div>
        <div className="mt-8 flex items-center justify-between gap-4 rounded-lg bg-surface-1 p-5 shadow-e1">
          <p className="text-sm text-fg-secondary">
            Workspace:{" "}
            <span className="font-mono text-fg-primary">{state.workspace}</span>
          </p>
          <button
            type="button"
            disabled={!selected?.logged_in}
            onClick={onDone}
            className={`inline-flex h-11 items-center gap-2 rounded-md px-5 font-semibold ${selected?.logged_in ? "bg-accent text-fg-on-accent hover:bg-accent-hover" : "bg-surface-3 text-fg-disabled"}`}
          >
            Open workspace
            <Icon
              name="streamline:interface-arrows-upright-corner-arrow-up-right-upright-corner"
              size={14}
            />
          </button>
        </div>
      </div>
    </main>
  );
}

// Remix Icon fill glyphs (Apache-2.0), the set the Director uses; copied, not imported.
const GLYPHS = {
  chat: "M7.291 20.824L2 22l1.176-5.291A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10a9.96 9.96 0 0 1-4.709-1.176",
  bot: "M13.5 2c0 .444-.193.843-.5 1.118V5h5a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h5V3.118A1.5 1.5 0 1 1 13.5 2M0 10h2v6H0zm24 0h-2v6h2zM9 14.5a1.5 1.5 0 1 0 0-3a1.5 1.5 0 0 0 0 3m7.5-1.5a1.5 1.5 0 1 0-3 0a1.5 1.5 0 0 0 3 0",
  inbox:
    "M3 3h18a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1m6 9a3 3 0 1 0 6 0h5V5H4v7z",
  power:
    "M11 2.05V12h2V2.05c5.053.501 9 4.765 9 9.95c0 5.523-4.477 10-10 10S2 17.523 2 12c0-5.185 3.947-9.449 9-9.95",
} as const;

function DockTile({
  glyph,
  label,
  tint,
  active = false,
  onClick,
  href,
}: {
  glyph: keyof typeof GLYPHS | "logo";
  label: string;
  tint: [string, string];
  active?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const tile = (
    <span
      className="desk-tile"
      style={{ background: `linear-gradient(160deg, ${tint[0]}, ${tint[1]})` }}
    >
      {glyph === "logo" ? (
        <LogoMark size={30} className="text-white" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="26"
          height="26"
          fill="#fff"
          aria-hidden="true"
        >
          <path d={GLYPHS[glyph]} />
        </svg>
      )}
    </span>
  );
  return (
    <div className="desk-dock-item">
      {active && <span className="desk-dock-dot" aria-hidden="true" />}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label={label}>
          {tile}
        </a>
      ) : (
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-current={active ? "page" : undefined}
        >
          {tile}
        </button>
      )}
      <span className="desk-dock-tip" role="tooltip">
        {label}
      </span>
    </div>
  );
}

/** The Director's dock: frosted glass on the left, gradient tiles, a dot marks the current place. */
function Dock({
  initials,
  onNewChat,
  onSettings,
  onSignOut,
}: {
  initials: string;
  onNewChat: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  return (
    <nav className="desk-dock glass" aria-label="Betsee Desk">
      <DockTile
        glyph="logo"
        label="Betsee Desk"
        tint={["#4a5568", "#101828"]}
      />
      <span className="desk-dock-sep" aria-hidden="true" />
      <DockTile
        glyph="chat"
        label="New chat"
        tint={["#6a96ff", "#2f5bea"]}
        active
        onClick={onNewChat}
      />
      <DockTile
        glyph="bot"
        label="Assistant and keys"
        tint={["#3fd0f0", "#0a8bbd"]}
        onClick={onSettings}
      />
      <DockTile
        glyph="inbox"
        label="Approvals (opens Betsee)"
        tint={["#7d8fa8", "#34465f"]}
        href="http://betsee.localhost/approvals"
      />
      <span className="desk-dock-sep" aria-hidden="true" />
      <DockTile
        glyph="power"
        label="Sign out"
        tint={["#9aa4b5", "#5b6578"]}
        onClick={onSignOut}
      />
      <span className="desk-avatar" title="Signed in">
        {initials}
      </span>
    </nav>
  );
}

const STARTERS = [
  "What files are in my workspace, and what is each one for?",
  "Summarise the newest document in my workspace in five bullets.",
  "Draft a short status update for my team from my workspace notes.",
  "Check uploads/ for anything I should not share outside the company.",
];

const emptyChat = (chat: ChatSession) => !chat.title && chat.events <= 1;

const chatTime = (at: string) => {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString()
    ? time(at)
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
};

// Chats live in the embedded service, not in the window, so the open chat survives the Workspace
// remounting (a trip to the assistant settings) as long as the service has it.
let lastChatId: string | null = null;
let opening: Promise<string> | null = null;

/** The chat to show on entry: the one open before, else the newest if nothing was asked in it yet,
 * else a new one. Shared while in flight, so StrictMode's double effect starts one chat, not two. */
function initialChat(): Promise<string> {
  opening ??= (async () => {
    const list = await chatApi.sessions();
    const remembered = list.find((chat) => chat.chat_id === lastChatId);
    if (remembered) return remembered.chat_id;
    if (list[0] && emptyChat(list[0])) return list[0].chat_id;
    return (await chatApi.start()).chat_id;
  })().finally(() => {
    opening = null;
  });
  return opening;
}

const modKey = (event: KeyboardEvent) =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;

function ChatList({
  chats,
  activeId,
  activeTitle,
  activeBusy,
  drafts,
  query,
  onQuery,
  onOpen,
  onNew,
  searchRef,
}: {
  chats: ChatSession[];
  activeId: string | null;
  activeTitle: string | null;
  activeBusy: boolean;
  drafts: ReadonlyMap<string, string>;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (chatId: string) => void;
  onNew: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <nav
      aria-label="Chats"
      className="desk-chats min-h-0 flex-col rounded-lg bg-surface-1 shadow-e1"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <h2 className="font-display text-xl font-bold tracking-[-0.02em]">
          Chats
        </h2>
        <button
          type="button"
          onClick={onNew}
          title="New chat (Ctrl+N)"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-sm font-semibold text-fg-on-accent hover:bg-accent-hover"
        >
          <Icon name="streamline:add-1" size={12} />
          New
        </button>
      </div>
      <label className="mx-4 mt-3 flex h-9 items-center gap-2 rounded-md border border-line-default bg-surface-inset px-2.5 focus-within:border-line-focus">
        <Icon
          name="streamline:magnifying-glass"
          size={13}
          className="shrink-0 text-fg-tertiary"
        />
        <span className="sr-only">Search chats</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search chats"
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-fg-tertiary focus:outline-none"
        />
        <kbd className="desk-kbd">Ctrl K</kbd>
      </label>
      <ul className="mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {chats.length === 0 && (
          <li className="px-2 py-3 text-xs text-fg-tertiary">
            {query ? "No chats match." : "No chats yet."}
          </li>
        )}
        {chats.map((chat) => {
          const active = chat.chat_id === activeId;
          const title =
            chat.title ?? (active ? activeTitle : null) ?? "New chat";
          const busy = active ? activeBusy : chat.busy;
          const draft = !active && (drafts.get(chat.chat_id) ?? "").trim();
          return (
            <li key={chat.chat_id}>
              <button
                type="button"
                onClick={() => onOpen(chat.chat_id)}
                aria-current={active ? "true" : undefined}
                className={`desk-chat-row w-full rounded-md px-2.5 py-2 text-left ${active ? "bg-accent-tint" : "hover:bg-surface-2"}`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${active ? "font-semibold text-fg-primary" : "font-medium text-fg-secondary"} ${chat.title || (active && activeTitle) ? "" : "italic"}`}
                    title={title}
                  >
                    {title}
                  </span>
                  {busy && (
                    <span
                      className="bs-live-pulse h-2 w-2 shrink-0 rounded-pill bg-allow-solid"
                      role="img"
                      aria-label="Working"
                    />
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-2xs text-fg-tertiary">
                  {chatTime(chat.updated_at ?? chat.created_at)}
                  {draft && (
                    <span className="font-semibold text-approval-fg">
                      Draft
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line-subtle px-4 py-2.5 text-2xs text-fg-tertiary">
        <kbd className="desk-kbd">Alt Up</kbd>{" "}
        <kbd className="desk-kbd">Alt Down</kbd> switch chats
      </p>
    </nav>
  );
}

function Workspace({
  state,
  onSettings,
  onSignOut,
}: {
  state: DeskState;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [sendingChat, setSendingChat] = useState<string | null>(null);
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  const [sent, setSent] = useState<ReadonlyMap<string, string>>(new Map());
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [dropping, setDropping] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const thread = useChatThread(chatId, sent);
  const runtime = state.runtimes.find((r) => r.runtime === state.runtime);
  const draft = (chatId && drafts.get(chatId)) || "";
  const activeTitle =
    thread.items.find((item) => item.kind === "user")?.text ?? null;

  const notify = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setNotices((current) => [...current.slice(-2), { id, text }]);
    setTimeout(
      () => setNotices((current) => current.filter((n) => n.id !== id)),
      6000,
    );
  }, []);
  const failed = useCallback(
    (error: unknown, fallback: string) =>
      notify(error instanceof Error ? error.message : fallback),
    [notify],
  );

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() =>
      composer.current?.querySelector("textarea")?.focus(),
    );
  }, []);

  const refreshChats = useCallback(
    () =>
      chatApi
        .sessions()
        .then((list) => {
          setChats(list);
          return list;
        })
        .catch(() => [] as ChatSession[]),
    [],
  );

  const openChat = useCallback(
    (id: string) => {
      lastChatId = id;
      setChatId(id);
      setAtBottom(true);
      focusComposer();
    },
    [focusComposer],
  );

  useEffect(() => {
    let live = true;
    void initialChat()
      .then((id) => {
        if (!live) return;
        openChat(id);
        void refreshChats();
      })
      .catch((error) => failed(error, "Could not start a chat"));
    return () => {
      live = false;
    };
  }, [openChat, refreshChats, failed]);

  useEffect(() => {
    const timer = setInterval(() => void refreshChats(), 5000);
    return () => clearInterval(timer);
  }, [refreshChats]);
  useEffect(() => {
    void refreshChats();
  }, [thread.busy, refreshChats]);

  const newChat = useCallback(async () => {
    setQuery("");
    if (chatId && thread.items.length === 0 && !thread.busy) {
      focusComposer();
      return;
    }
    const spare = chats.find(
      (chat) => chat.chat_id !== chatId && emptyChat(chat),
    );
    if (spare) {
      openChat(spare.chat_id);
      return;
    }
    try {
      const chat = await chatApi.start();
      await refreshChats();
      openChat(chat.chat_id);
    } catch (error) {
      failed(error, "Could not start a chat");
    }
  }, [
    chatId,
    chats,
    thread.items.length,
    thread.busy,
    focusComposer,
    openChat,
    refreshChats,
    failed,
  ]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((chat) =>
      (
        chat.title ??
        (chat.chat_id === chatId ? activeTitle : null) ??
        "New chat"
      )
        .toLowerCase()
        .includes(needle),
    );
  }, [chats, query, chatId, activeTitle]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (modKey(event) && key === "n") {
        event.preventDefault();
        void newChat();
      } else if (modKey(event) && key === "k") {
        event.preventDefault();
        search.current?.focus();
        search.current?.select();
      } else if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        if (visible.length === 0) return;
        const at = visible.findIndex((chat) => chat.chat_id === chatId);
        const next =
          at === -1
            ? 0
            : Math.min(
                visible.length - 1,
                Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)),
              );
        if (visible[next].chat_id !== chatId) openChat(visible[next].chat_id);
      } else if (
        event.key === "Escape" &&
        document.activeElement === search.current
      ) {
        setQuery("");
        focusComposer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat, visible, chatId, openChat, focusComposer]);

  const refreshFiles = useCallback(() => {
    void desk<{ items: WorkspaceFile[] }>("/desk/files")
      .then((list) => setFiles(list.items))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshFiles();
    const timer = setInterval(refreshFiles, 5000);
    return () => clearInterval(timer);
  }, [refreshFiles]);
  useEffect(refreshFiles, [thread.items.length, refreshFiles]);

  const upload = useCallback(
    async (picked: { files: PickedFile[]; errors: string[] }) => {
      picked.errors.forEach(notify);
      if (!chatId) return;
      for (const file of picked.files) {
        setUploading((n) => n + 1);
        try {
          await desk("/desk/files/upload", {
            chat_id: chatId,
            name: file.name,
            content_base64: file.content_base64,
            tier: "internal",
          });
        } catch {
          // The refusal and its reason arrive in the thread as a file card.
        } finally {
          setUploading((n) => n - 1);
        }
      }
      refreshFiles();
    },
    [chatId, refreshFiles, notify],
  );

  const download = useCallback(
    async (path: string) => {
      if (!chatId) return;
      try {
        const result = await desk<{
          type: string;
          name: string;
          content_base64?: string;
        }>("/desk/files/download", { chat_id: chatId, path });
        if (result.content_base64) {
          const saved = await saveFile(
            result.name ?? path.split("/").pop() ?? "file",
            result.content_base64,
          );
          if (saved) notify(`Saved ${saved}`);
        }
      } catch {
        // The refusal and its reason arrive in the thread as a file card.
      }
    },
    [chatId, notify],
  );

  useEffect(() => {
    const tauri = native();
    if (!tauri) return;
    let stop: (() => void) | undefined;
    void tauri.webview
      .getCurrentWebview()
      .onDragDropEvent((event) => {
        const kind = event.payload.type;
        if (kind === "enter" || kind === "over") setDropping(true);
        else if (kind === "leave") setDropping(false);
        else if (kind === "drop") {
          setDropping(false);
          void readDropped(event.payload.paths ?? []).then(upload);
        }
      })
      .then((unlisten) => {
        stop = unlisten;
      });
    return () => stop?.();
  }, [upload]);

  const setDraft = (value: string) => {
    if (!chatId) return;
    setDrafts((current) => new Map(current).set(chatId, value));
  };

  const send = async () => {
    const target = chatId;
    const text = draft.trim();
    if (!text || !target) return;
    setSendingChat(target);
    try {
      const result = await chatApi.send(target, text);
      setSent((current) => new Map(current).set(result.message_id, text));
      setDrafts((current) => {
        const next = new Map(current);
        next.delete(target);
        return next;
      });
      setAtBottom(true);
      void refreshChats();
    } catch (error) {
      failed(error, "Message not sent");
    } finally {
      setSendingChat(null);
    }
  };

  const jumpToLatest = () => {
    const box = scroller.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    setAtBottom(true);
  };

  const sending = sendingChat !== null && sendingChat === chatId;
  const uploads = files.filter((f) => f.path.startsWith("uploads/"));
  const others = files.filter((f) => !f.path.startsWith("uploads/"));

  return (
    <div className="desk-frame">
      <Dock
        initials={(state.human?.display_name ?? "?")
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2)}
        onNewChat={() => void newChat()}
        onSettings={onSettings}
        onSignOut={onSignOut}
      />
      <ChatList
        chats={visible}
        activeId={chatId}
        activeTitle={activeTitle}
        activeBusy={thread.busy}
        drafts={drafts}
        query={query}
        onQuery={setQuery}
        onOpen={openChat}
        onNew={() => void newChat()}
        searchRef={search}
      />
      <section
        aria-label="Conversation"
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface-1 shadow-e1 ${dropping ? "desk-drop" : ""}`}
        onDragOver={(event) => {
          if (!native()) {
            event.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          if (native()) return;
          event.preventDefault();
          setDropping(false);
          void readFiles([...event.dataTransfer.files]).then(upload);
        }}
      >
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line-subtle px-6">
          <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-pill border border-line-default bg-surface-1 px-3">
            <AgentMark size={20} />
            <span className="font-mono text-sm font-medium">
              {runtime?.label}
            </span>
          </span>
          {thread.model && (
            <span className="hidden h-9 shrink-0 items-center rounded-pill border border-line-default bg-surface-1 px-3 font-mono text-xs text-fg-secondary 2xl:inline-flex">
              {thread.model}
            </span>
          )}
          <span
            className="min-w-0 flex-1 truncate px-2 text-sm font-semibold text-fg-primary"
            title={activeTitle ?? undefined}
          >
            {activeTitle}
          </span>
          <GovernedMarker />
        </header>
        <div className="relative min-h-0 flex-1">
          <div
            ref={scroller}
            className="h-full overflow-y-auto px-6"
            onScroll={(event) => {
              const box = event.currentTarget;
              setAtBottom(
                box.scrollHeight - box.scrollTop - box.clientHeight < 96,
              );
            }}
          >
            <div className="mx-auto w-full max-w-(--bs-layout-eco-chat-column)">
              {thread.items.length === 0 ? (
                <div className="flex flex-col items-center pt-[8vh] text-center">
                  <span className="inline-flex h-16 w-16 items-center justify-center rounded-lg bg-surface-2 text-accent-text shadow-e2">
                    <Icon name="streamline-flex:ai-chip-robot" size={28} />
                  </span>
                  <h1 className="mt-5 font-display text-3xl font-semibold">
                    What do you need, {state.human?.display_name.split(" ")[0]}?
                  </h1>
                  <p className="mt-2 max-w-xl text-md text-fg-secondary">
                    Ask {runtime?.label} about the files in your workspace, or
                    attach your own. Drop files anywhere here: each is scanned
                    before the assistant sees it.
                  </p>
                  <div className="mt-8 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                    {STARTERS.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => {
                          setDraft(starter);
                          focusComposer();
                        }}
                        className="desk-starter rounded-md bg-surface-1 px-4 py-3 text-left text-sm text-fg-secondary shadow-e1 hover:text-fg-primary"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <Thread
                  items={thread.items}
                  busy={thread.busy}
                  follow={atBottom}
                  onDownload={(path) => void download(path)}
                />
              )}
            </div>
          </div>
          {!atBottom && thread.items.length > 0 && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="desk-jump glass absolute bottom-4 left-1/2 inline-flex h-9 -translate-x-1/2 items-center gap-2 rounded-pill px-4 text-sm font-semibold text-fg-primary"
            >
              <Icon
                name="streamline:interface-arrows-button-down-arrow-down-keyboard"
                size={12}
              />
              Jump to latest
            </button>
          )}
        </div>
        <div ref={composer} className="shrink-0 px-6 pb-6 pt-2">
          <div className="mx-auto w-full max-w-(--bs-layout-eco-chat-column)">
            {notices.map((notice) => (
              <div key={notice.id} className="mb-2">
                <Notice
                  tone="info"
                  onDismiss={() =>
                    setNotices((current) =>
                      current.filter((n) => n.id !== notice.id),
                    )
                  }
                >
                  {notice.text}
                </Notice>
              </div>
            ))}
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => void send()}
              sending={sending}
              disabled={sending || thread.busy || !chatId}
              compact={thread.items.length > 0}
              onAttach={() => void pickFiles().then(upload)}
              attachments={
                uploading > 0 ? (
                  <p className="mb-2 text-xs text-fg-secondary" role="status">
                    Scanning {uploading} {uploading === 1 ? "file" : "files"} at
                    the Gateway
                  </p>
                ) : null
              }
            />
          </div>
        </div>
      </section>
      <aside
        className="desk-files min-h-0 flex-col gap-4"
        aria-label="Assistant and files"
      >
        <section className="rounded-lg bg-surface-1 p-5 shadow-e1">
          <div className="flex items-center gap-3">
            <AgentMark size={40} />
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-medium">{AGENT}</p>
              <p className="text-xs text-fg-secondary">
                {runtime?.label ?? "Runtime"}{" "}
                <span className="font-mono">
                  {runtime?.version?.split(" ")[0] ?? ""}
                </span>
              </p>
              {thread.model && (
                <p className="truncate font-mono text-2xs text-fg-tertiary 2xl:hidden">
                  {thread.model}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <span className="text-fg-secondary">Session ceiling</span>
            <TierBadge tier="internal" />
          </div>
          <ul className="mt-4 space-y-2 border-t border-line-subtle pt-4">
            {CONTROLS.map(([id, label]) => (
              <li key={id} className="flex items-center justify-between gap-3">
                <span className="text-xs text-fg-secondary">{label}</span>
                <IdToken
                  id={id}
                  href={`http://betsee.localhost/policy-studio/controls/${id}`}
                  copy={false}
                />
              </li>
            ))}
          </ul>
        </section>
        <section className="flex min-h-0 flex-1 flex-col rounded-lg bg-surface-1 p-5 shadow-e1">
          <h2 className="font-display text-xl font-bold tracking-[-0.02em]">
            Workspace files
          </h2>
          <p className="mt-1 text-xs text-fg-secondary">
            Downloads are scanned and released by the Gateway.
          </p>
          <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
            {[
              ["Shared by you", uploads],
              ["Workspace", others],
            ].map(([title, list]) => (
              <section key={title as string}>
                <p className="mb-2 text-2xs font-semibold tracking-widest text-fg-tertiary">
                  {(title as string).toUpperCase()}
                </p>
                {(list as WorkspaceFile[]).length === 0 ? (
                  <p className="text-xs text-fg-tertiary">Nothing yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {(list as WorkspaceFile[]).map((file) => (
                      <li
                        key={file.path}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-1"
                      >
                        <Icon
                          name="streamline-flex:text-file"
                          size={14}
                          className="shrink-0 text-fg-tertiary"
                        />
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-xs"
                          title={file.path}
                        >
                          {file.path}
                        </span>
                        <span className="text-2xs text-fg-tertiary">
                          {bytes(file.size)}
                        </span>
                        <button
                          type="button"
                          title={`Download ${file.path}`}
                          aria-label={`Download ${file.path}`}
                          onClick={() => void download(file.path)}
                          className="rounded-xs p-1 text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                        >
                          <Icon name="streamline:download-box-1" size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<DeskState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const load = useCallback(() => {
    desk<DeskState>("/desk/state")
      .then((next) => {
        setState(next);
        setError(null);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (state?.signed_in) return;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [state?.signed_in, load]);
  const ready = useMemo(
    () =>
      state?.runtimes.find((r) => r.runtime === state.runtime)?.logged_in ??
      false,
    [state],
  );
  if (!state)
    return (
      <main className="grid min-h-screen place-items-center bg-app p-6">
        {error ? (
          <Notice tone="deny">
            Betsee Desk could not reach its governing service: {error}
          </Notice>
        ) : (
          <p className="text-sm text-fg-secondary" role="status">
            Starting Betsee Desk…
          </p>
        )}
      </main>
    );
  if (!state.signed_in) return <SignIn error={error} />;
  if (settings || !ready)
    return (
      <Setup state={state} onChanged={load} onDone={() => setSettings(false)} />
    );
  return (
    <Workspace
      state={state}
      onSettings={() => setSettings(true)}
      onSignOut={() => void desk("/desk/logout", {}).then(load)}
    />
  );
}
