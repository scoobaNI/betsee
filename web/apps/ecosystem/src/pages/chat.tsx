import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { DecisionChip, Icon, IdToken, TierBadge } from "@betsee/ui";
import { ApiRequestError } from "@betsee/api";
import {
  chatApi,
  useChatThread,
  type ChatSession,
  type ThreadItem,
  type ToolDecision,
} from "@betsee/api/chat";
import { useEcosystemMe } from "@betsee/api/resources/ecosystem";
import { mockMode } from "../auth";

const DIRECTOR = "http://director.betsee.localhost";
const AGENT = "employee-assistant";
const CHAT_KEY = "betsee-chat";

const suggestions = [
  {
    label: "Summarise the onboarding handbook",
    prompt: "Summarise handbook/onboarding.md in three bullet points.",
    icon: "streamline-flex:text-file",
  },
  {
    label: "What did the team agree?",
    prompt:
      "Read notes/team-sync.md and list the action items with their owners.",
    icon: "streamline-flex:chat-bubble-text-square",
  },
  {
    label: "Clean up the notes folder",
    prompt: "Delete the notes folder with rm -rf notes.",
    icon: "streamline-flex:code-monitor-1",
  },
];

const capabilities = [
  {
    id: "files.read",
    title: "Read workspace files",
    body: "Handbook and notes are open. Confidential and restricted files stay closed.",
    tag: "Ask",
    prompt: "What is the hotel limit in the expense policy?",
    icon: "streamline-flex:text-file",
  },
  {
    id: "shell.exec",
    title: "Run read-only commands",
    body: "ls, cat, head, tail, wc and grep on one file. Anything else is refused.",
    tag: "List",
    prompt: "List the files in the workspace with ls -la.",
    icon: "streamline-flex:code-monitor-1",
  },
  {
    id: "files.write",
    title: "Draft files",
    body: "Every write waits for an approver in Betsee before it happens.",
    tag: "Draft",
    prompt:
      "Create notes/q4-scorecard.md with a short outline for the Q4 carrier scorecard.",
    icon: "streamline-flex:pencil-square",
  },
];

const TOOL_ICONS: Record<string, string> = {
  Bash: "streamline-flex:code-monitor-1",
  Write: "streamline-flex:pencil-square",
  Edit: "streamline-flex:pencil-square",
  WebFetch: "streamline-flex:link-chain",
  WebSearch: "streamline-flex:link-chain",
};

const time = (at: string) =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

function AgentMark({ size = 24 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-sm bg-surface-3 text-accent-text"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon
        name="streamline-flex:ai-chip-robot"
        size={Math.round(size * 0.58)}
      />
    </span>
  );
}

function GovernedMarker() {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-pill border border-accent-edge bg-accent-tint px-3 text-sm font-medium text-accent-text">
      <Icon name="streamline-flex:shield-2" size={14} />
      Governed by Betsee
    </span>
  );
}

/** Assistant text: paragraphs, bullet and numbered lists, **bold** and `code`. No raw HTML. */
function RichText({ text }: { text: string }) {
  const inline = (line: string, key: string): ReactNode[] =>
    line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
        return (
          <code
            key={`${key}-${index}`}
            className="rounded-xs bg-surface-3 px-1 font-mono text-sm"
          >
            {part.slice(1, -1)}
          </code>
        );
      if (part.startsWith("**") && part.endsWith("**") && part.length > 3)
        return (
          <strong key={`${key}-${index}`} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      return <Fragment key={`${key}-${index}`}>{part}</Fragment>;
    });
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-3 text-md leading-relaxed text-fg-primary">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const bullets = lines.every((line) => /^\s*[-*] /.test(line));
        const numbered = lines.every((line) => /^\s*\d+[.)] /.test(line));
        if (bullets || numbered) {
          const List = numbered ? "ol" : "ul";
          return (
            <List
              key={index}
              className={`space-y-1 pl-5 ${numbered ? "list-decimal" : "list-disc"}`}
            >
              {lines.map((line, item) => (
                <li key={item}>
                  {inline(
                    line.replace(/^\s*([-*]|\d+[.)]) /, ""),
                    `${index}-${item}`,
                  )}
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {lines.map((line, item) => (
              <Fragment key={item}>
                {item > 0 && <br />}
                {inline(line, `${index}-${item}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function TraceLink({
  traceId,
  label = "View trace",
}: {
  traceId: string | null;
  label?: string;
}) {
  if (!traceId) return null;
  return (
    <a
      href={`${DIRECTOR}/traces/${encodeURIComponent(traceId)}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline"
    >
      {label}
      <Icon name="streamline-flex:arrow-expand" size={12} />
    </a>
  );
}

function ControlIds({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id) => (
        <IdToken
          key={id}
          id={id}
          href={`/policy-studio/controls/${encodeURIComponent(id)}`}
        />
      ))}
    </>
  );
}

function toolTarget(
  tool: string,
  input: Record<string, unknown>,
  decision: ToolDecision | null,
) {
  const text = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : "";
  if (tool === "Bash") return text("command");
  if (tool === "WebFetch") return text("url");
  if (tool === "WebSearch") return text("query");
  const path = text("file_path") || text("path") || text("pattern");
  const resource = decision?.resource.id ?? "";
  return resource.startsWith("workspace")
    ? resource.replace(/^workspace\/?/, "") || "."
    : path;
}

function ToolCard({ item }: { item: Extract<ThreadItem, { kind: "tool" }> }) {
  const decision = item.decision;
  const waiting = item.waiting;
  const shown = decision ?? waiting;
  const denied = decision?.decision === "deny";
  const pending = !decision && waiting !== null;
  const target = toolTarget(item.tool, item.input, shown);
  const tier = shown?.resource.tier;
  return (
    <div
      className={`relative overflow-hidden rounded-lg p-4 shadow-e1 ${pending ? "border border-approval-border bg-approval-bg" : "bg-surface-1"}`}
    >
      {denied && (
        <span
          className="absolute inset-y-0 left-0 w-0.5 bg-deny-fg"
          aria-hidden="true"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-surface-2 text-fg-secondary">
          <Icon
            name={TOOL_ICONS[item.tool] ?? "streamline-flex:text-file"}
            size={14}
          />
        </span>
        <span className="font-mono text-sm font-medium">
          {item.tool || "Tool"}
        </span>
        {shown?.capability && <IdToken id={shown.capability} copy={false} />}
        <span
          className="min-w-0 flex-1 truncate font-mono text-sm text-fg-secondary"
          title={target}
        >
          {target}
        </span>
        {tier &&
          ["public", "internal", "confidential", "restricted"].includes(
            tier,
          ) && <TierBadge tier={tier as "public"} />}
        {shown ? (
          <DecisionChip
            decision={shown.decision}
            size="sm"
            resolution={
              decision && waiting
                ? decision.decision === "allow"
                  ? "approved"
                  : "rejected"
                : null
            }
            controlIds={shown.controlIds}
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-tertiary">
            <span className="bs-live-pulse h-1.5 w-1.5 rounded-pill bg-fg-tertiary" />
            Asking the Gateway
          </span>
        )}
      </div>
      {shown && (
        <p className="mt-2.5 text-sm text-fg-secondary">
          {shown.unreachable
            ? "The Gateway could not be reached, so the agent runtime was not allowed to run this. "
            : ""}
          {shown.reasons[0] ?? ""}
        </p>
      )}
      {pending && !item.timedOut && (
        <p className="mt-2 text-sm text-approval-fg">
          Waiting for an approver in{" "}
          <Link to="/approvals" className="font-semibold underline">
            Approvals
          </Link>
          {waiting?.waitingSeconds
            ? ` (up to ${Math.round(waiting.waitingSeconds / 60)} min)`
            : ""}
          .
        </p>
      )}
      {item.timedOut && !decision && (
        <p className="mt-2 text-sm text-approval-fg">
          No approval in time; nothing ran. Approve it in Approvals, then ask
          again.
        </p>
      )}
      {shown && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ControlIds ids={shown.controlIds} />
          <span className="ml-auto">
            <TraceLink traceId={shown.traceId} />
          </span>
        </div>
      )}
      {item.result && !item.result.isError && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs text-fg-tertiary">
            Executed by the agent runtime after allow. Output
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-sm bg-surface-inset p-3 font-mono text-xs text-fg-secondary">
            {item.result.content}
          </pre>
        </details>
      )}
    </div>
  );
}

function BlockedMessage({
  item,
}: {
  item: Extract<ThreadItem, { kind: "blocked" }>;
}) {
  return (
    <div className="ml-auto flex max-w-[80%] flex-col items-end gap-2">
      <div className="relative overflow-hidden rounded-xl rounded-br-xs border border-deny-border bg-deny-bg px-4 py-3">
        <p className="text-md text-fg-secondary line-through decoration-deny-fg/60">
          {item.text ?? "Message withheld"}
        </p>
      </div>
      <div className="flex max-w-full flex-col items-end gap-1.5 text-right">
        <p className="flex items-center gap-1.5 text-sm font-medium text-deny-fg">
          <Icon name="streamline-flex:block-2" size={14} />
          Not sent: {item.reasons[0] ?? "the input filter refused this message"}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {item.findings.map((finding) => (
            <span
              key={`${finding.class}-${finding.masked}`}
              className="rounded-pill bg-surface-2 px-2 py-0.5 font-mono text-2xs text-fg-secondary"
            >
              {finding.masked}
            </span>
          ))}
          <ControlIds ids={item.controlIds} />
          <TraceLink traceId={item.traceId} label="View check" />
        </div>
        <p className="text-2xs text-fg-tertiary">
          The assistant never saw this message. {time(item.at)}
        </p>
      </div>
    </div>
  );
}

function Thread({ items, busy }: { items: ThreadItem[]; busy: boolean }) {
  const reduced = useReducedMotion();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({
      block: "end",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [items.length, busy, reduced]);
  let previousAgent = false;
  return (
    <div className="flex flex-col gap-5 pb-6 pt-8">
      {items.map((item) => {
        const startsAgent =
          item.kind !== "user" && item.kind !== "blocked" && !previousAgent;
        previousAgent = item.kind !== "user" && item.kind !== "blocked";
        return (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.2 }}
          >
            {startsAgent && (
              <div className="mb-2 flex items-center gap-2">
                <AgentMark />
                <span className="font-mono text-sm font-medium">{AGENT}</span>
                <span className="text-2xs text-fg-tertiary">
                  {time(item.at)}
                </span>
              </div>
            )}
            {item.kind === "user" && (
              <div className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
                <div className="rounded-xl rounded-br-xs bg-surface-3 px-4 py-3 text-md whitespace-pre-wrap">
                  {item.text}
                </div>
                <span className="flex items-center gap-2 text-2xs text-fg-tertiary">
                  Passed the input filter
                  <TraceLink traceId={item.traceId} label="View check" />
                  {time(item.at)}
                </span>
              </div>
            )}
            {item.kind === "blocked" && <BlockedMessage item={item} />}
            {item.kind === "assistant" && <RichText text={item.text} />}
            {item.kind === "tool" && <ToolCard item={item} />}
            {item.kind === "error" && (
              <p className="rounded-lg border border-deny-border bg-deny-bg p-3 text-sm text-deny-fg">
                {item.message}
              </p>
            )}
          </motion.div>
        );
      })}
      {busy && (
        <div
          className="flex items-center gap-2 text-sm text-fg-tertiary"
          role="status"
        >
          <AgentMark />
          <span className="bs-live-pulse">{AGENT} is working</span>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  sending,
  disabled,
  compact,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled: boolean;
  compact: boolean;
}) {
  const empty = value.trim() === "";
  return (
    <div>
      <form
        className={`flex flex-col rounded-xl border border-line-strong bg-surface-1 p-4 pb-3 shadow-e2 focus-within:border-line-focus focus-within:shadow-selected ${compact ? "min-h-28" : "min-h-42"}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!empty && !disabled) onSend();
        }}
      >
        <label className="flex flex-1 gap-3">
          <Icon
            name="streamline:ai-prompt-spark"
            size={18}
            className="mt-1 text-accent-text"
          />
          <span className="sr-only">Message the employee assistant</span>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!empty && !disabled) onSend();
              }
            }}
            rows={compact ? 2 : 3}
            maxLength={8000}
            placeholder={`Ask ${AGENT}...`}
            className="max-h-[40vh] min-w-0 flex-1 resize-none bg-transparent text-lg text-fg-primary placeholder:text-fg-tertiary focus:outline-none"
          />
        </label>
        <div className="mt-3 flex items-center gap-1">
          <span className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm text-fg-secondary">
            <Icon name="streamline-flex:layers-1" size={14} />
            Session ceiling <TierBadge tier="internal" />
          </span>
          <span className="mx-1 h-4 w-px bg-line-default" aria-hidden="true" />
          <span className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm text-fg-secondary">
            <Icon name="streamline-flex:shield-1" size={14} />
            Checked before sending
          </span>
          <button
            type="submit"
            disabled={empty || disabled}
            aria-label="Send"
            title="Send"
            className={`ml-auto inline-flex h-10 w-10 items-center justify-center rounded-pill ${empty || disabled ? "bg-surface-3 text-fg-disabled" : "bg-accent text-fg-on-accent hover:bg-accent-hover"}`}
          >
            {sending ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-pill border-2 border-current border-t-transparent" />
            ) : (
              <Icon name="streamline:arrow-up-1" size={16} />
            )}
          </button>
        </div>
      </form>
      <p className="mt-2 text-center text-2xs text-fg-tertiary">
        Messages pass the Betsee content filter before the assistant sees them.
        Every tool call is decided by the Gateway and recorded as a trace.
      </p>
    </div>
  );
}

function EmptyState({
  name,
  onPick,
}: {
  name: string;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-col items-center pt-[6vh] text-center">
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-lg bg-surface-2 text-accent-text shadow-e2">
        <Icon name="streamline-flex:ai-chip-robot" size={28} />
      </span>
      <h1 className="mt-5 font-display text-3xl font-semibold">
        What do you need{name ? `, ${name}` : ""}?
      </h1>
      <p className="mt-2 max-w-xl text-md text-fg-secondary">
        The employee assistant is Claude Code working in your team workspace.
        Betsee decides each step it takes: what it may read, run and write.
      </p>
      <div className="mt-10 flex w-full flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            onClick={() => onPick(suggestion.prompt)}
            className="inline-flex h-9 items-center gap-2 rounded-pill border border-line-default bg-surface-1 px-3.5 text-sm hover:bg-surface-2"
          >
            {suggestion.label}
            <Icon
              name={suggestion.icon}
              size={14}
              className="text-fg-secondary"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function CapabilityCards({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
      {capabilities.map((capability) => (
        <button
          key={capability.id}
          type="button"
          onClick={() => onPick(capability.prompt)}
          className="rounded-lg bg-surface-1 p-5 text-left shadow-e1 hover:bg-surface-2 hover:shadow-e2"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-pill bg-surface-2 text-fg-secondary">
              <Icon name={capability.icon} size={16} />
            </span>
            <span className="inline-flex h-7 items-center whitespace-nowrap rounded-pill bg-surface-3 px-2.5 text-xs font-semibold text-fg-secondary">
              {capability.tag}
            </span>
          </span>
          <span className="mt-4 block text-md font-semibold">
            {capability.title}
          </span>
          <span className="mt-1 line-clamp-2 block text-sm text-fg-secondary">
            {capability.body}
          </span>
          <IdToken id={capability.id} copy={false} className="mt-2" />
        </button>
      ))}
    </div>
  );
}

function History({
  chats,
  active,
  onSelect,
  onNew,
  starting,
}: {
  chats: ChatSession[];
  active: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  starting: boolean;
}) {
  return (
    <aside className="chat-history flex min-h-0 flex-col border-r border-line-subtle p-4">
      <button
        type="button"
        onClick={onNew}
        disabled={starting}
        className="flex h-11 w-full items-center gap-2 rounded-md bg-surface-2 px-3 text-md font-semibold shadow-e1 hover:bg-surface-3"
      >
        <Icon name="streamline:add-1" size={16} />
        New chat
      </button>
      <p className="mb-2 mt-6 text-2xs font-semibold tracking-widest text-fg-tertiary">
        ASSISTANTS
      </p>
      <div className="relative flex min-h-11 items-center gap-3 rounded-md bg-surface-2 px-3">
        <span
          className="absolute inset-y-2 left-0 w-0.5 rounded-pill bg-accent"
          aria-hidden="true"
        />
        <AgentMark />
        <span className="font-mono text-sm font-medium">{AGENT}</span>
      </div>
      <div className="my-4 h-px bg-line-subtle" />
      <p className="mb-2 text-2xs font-semibold tracking-widest text-fg-tertiary">
        RECENT
      </p>
      <nav
        aria-label="Recent chats"
        className="min-h-0 flex-1 space-y-1 overflow-y-auto"
      >
        {chats.length === 0 && (
          <p className="px-3 text-sm text-fg-tertiary">No chats yet.</p>
        )}
        {chats.map((chat) => (
          <button
            key={chat.chat_id}
            type="button"
            onClick={() => onSelect(chat.chat_id)}
            aria-current={chat.chat_id === active ? "page" : undefined}
            className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm ${chat.chat_id === active ? "bg-surface-2 text-fg-primary" : "text-fg-secondary hover:bg-surface-1"}`}
          >
            <span className="truncate">
              Chat started {time(chat.created_at)}
            </span>
            {chat.busy && (
              <span className="bs-live-pulse h-1.5 w-1.5 shrink-0 rounded-pill bg-accent" />
            )}
          </button>
        ))}
      </nav>
      <div className="mt-4 rounded-lg bg-surface-1 p-4 text-center shadow-e1">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-pill bg-surface-2 text-accent-text">
          <Icon name="streamline-flex:shield-2" size={16} />
        </span>
        <p className="mt-2 text-sm font-semibold">
          Every request passes the Gateway
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          What you type is checked first. Each action the assistant takes is
          checked against your delegation and policy.
        </p>
      </div>
    </aside>
  );
}

function AgentPanel({ chat }: { chat: ChatSession | null }) {
  const session = chat?.session;
  return (
    <aside
      className="chat-agent min-h-0 overflow-y-auto border-l border-line-subtle p-5"
      aria-label="This agent"
    >
      <div className="space-y-3">
        <section className="rounded-lg bg-surface-1 p-4 shadow-e1">
          <div className="flex items-center gap-3">
            <AgentMark size={44} />
            <div className="min-w-0">
              <p className="truncate font-mono text-md font-medium">{AGENT}</p>
              <p className="text-xs text-fg-secondary">
                Team workplace · Claude Code
              </p>
            </div>
          </div>
          <a
            href={`${DIRECTOR}/agents/${AGENT}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline"
          >
            Open in Director{" "}
            <Icon name="streamline-flex:arrow-expand" size={12} />
          </a>
        </section>
        <section className="rounded-lg bg-surface-1 p-4 shadow-e1">
          <p className="text-2xs font-semibold tracking-widest text-fg-tertiary">
            SESSION
          </p>
          <dl className="mt-2 divide-y divide-line-subtle text-sm">
            <div className="flex min-h-9 items-center justify-between gap-3">
              <dt className="text-fg-secondary">Use case</dt>
              <dd>Employee assistance</dd>
            </div>
            <div className="flex min-h-9 items-center justify-between gap-3">
              <dt className="text-fg-secondary">Tier ceiling</dt>
              <dd>
                <TierBadge
                  tier={(session?.tier_ceiling as "internal") ?? "internal"}
                />
              </dd>
            </div>
            <div className="flex min-h-9 items-center justify-between gap-3">
              <dt className="text-fg-secondary">On behalf of</dt>
              <dd className="truncate">
                {session?.human.display_name ?? "You"}
              </dd>
            </div>
            {session && (
              <div className="flex min-h-9 items-center justify-between gap-3">
                <dt className="text-fg-secondary">Session</dt>
                <dd className="min-w-0">
                  <IdToken id={session.id} />
                </dd>
              </div>
            )}
          </dl>
        </section>
        <section className="rounded-lg bg-surface-1 p-4 shadow-e1">
          <p className="text-2xs font-semibold tracking-widest text-fg-tertiary">
            CAN DO
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(
              session?.effective ?? ["files.read", "files.write", "shell.exec"]
            ).map((capability) => (
              <IdToken key={capability} id={capability} copy={false} />
            ))}
          </div>
          <p className="mt-3 text-xs text-fg-secondary">
            Writes need an approver. No network access.
          </p>
        </section>
        <section className="rounded-lg bg-surface-1 p-4 shadow-e1">
          <p className="text-2xs font-semibold tracking-widest text-fg-tertiary">
            CONTROLS
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <IdToken
                id="CTL-IN-001"
                href="/policy-studio/controls/CTL-IN-001"
              />
              <span className="text-fg-secondary">Input content filter</span>
            </li>
            <li className="flex items-start gap-2">
              <IdToken
                id="CTL-RT-001"
                href="/policy-studio/controls/CTL-RT-001"
              />
              <span className="text-fg-secondary">Delegated execution</span>
            </li>
          </ul>
        </section>
      </div>
    </aside>
  );
}

export function Chat() {
  useEffect(() => {
    document.title = "Chat - Betsee";
  }, []);
  const me = useEcosystemMe();
  const firstName = String(me.data?.human.display_name ?? "").split(" ")[0];
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [chatId, setChatId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(CHAT_KEY);
    } catch {
      return null;
    }
  });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReadonlyMap<string, string>>(new Map());
  const thread = useChatThread(chatId, sent);

  const refresh = useMemo(
    () => async () => {
      try {
        const items = await chatApi.sessions();
        setChats(items);
        setChatId((current) =>
          current && items.some((chat) => chat.chat_id === current)
            ? current
            : null,
        );
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof ApiRequestError
            ? cause.message
            : "Chat service unreachable",
        );
      }
    },
    [],
  );
  useEffect(() => {
    if (!mockMode) void refresh();
  }, [refresh]);
  useEffect(() => {
    try {
      if (chatId) sessionStorage.setItem(CHAT_KEY, chatId);
      else sessionStorage.removeItem(CHAT_KEY);
    } catch {
      // Storage unavailable: the chat still works, it just is not restored on reload.
    }
  }, [chatId]);

  const start = async () => {
    setStarting(true);
    try {
      const chat = await chatApi.start();
      setChats((current) => [chat, ...current]);
      setChatId(chat.chat_id);
      setError(null);
      return chat.chat_id;
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : "Could not start a chat",
      );
      return null;
    } finally {
      setStarting(false);
    }
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    setSending(true);
    try {
      const id = chatId ?? (await start());
      if (!id) return;
      const result = await chatApi.send(id, message);
      setSent((current) => new Map(current).set(result.message_id, message));
      setDraft("");
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError ? cause.message : "Message not sent",
      );
    } finally {
      setSending(false);
    }
  };

  const active = chats.find((chat) => chat.chat_id === chatId) ?? null;
  const empty = thread.items.length === 0;
  const composer = (
    <>
      {error && (
        <p
          role="alert"
          className="mb-2 rounded-md border border-deny-border bg-deny-bg p-3 text-sm text-deny-fg"
        >
          {error}
        </p>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void send(draft)}
        sending={sending}
        disabled={sending || starting || thread.busy}
        compact={!empty}
      />
    </>
  );

  if (mockMode)
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <h1 className="font-display text-3xl font-semibold">
          Chat needs the live stack
        </h1>
        <p className="mt-3 text-md text-fg-secondary">
          The employee assistant is real Claude Code governed by the Gateway.
          Run the stack and scripts/agent-host.sh, then open this page without
          mock data.
        </p>
      </div>
    );

  return (
    <div className="chat-page">
      <History
        chats={chats}
        active={chatId}
        onSelect={setChatId}
        onNew={() => void start()}
        starting={starting}
      />
      <section
        className="flex min-h-0 min-w-0 flex-col"
        aria-label="Conversation"
      >
        <header className="flex h-16 shrink-0 items-center gap-2 px-6">
          <span className="inline-flex h-9 items-center gap-2 rounded-pill border border-line-default bg-surface-1 px-3">
            <AgentMark size={20} />
            <span className="font-mono text-sm font-medium">{AGENT}</span>
          </span>
          {thread.model && (
            <span className="hidden h-9 items-center rounded-pill border border-line-default bg-surface-1 px-3 font-mono text-xs text-fg-secondary md:inline-flex">
              {thread.model}
            </span>
          )}
          <span className="ml-auto" />
          <GovernedMarker />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <div className="mx-auto w-full max-w-(--bs-layout-eco-chat-column)">
            {empty ? (
              // Before the first message the composer scrolls with the hero, so a short
              // viewport never covers the heading.
              <div className="pb-6">
                <EmptyState name={firstName} onPick={setDraft} />
                <div className="mt-3">{composer}</div>
                <CapabilityCards onPick={setDraft} />
              </div>
            ) : (
              <Thread items={thread.items} busy={thread.busy} />
            )}
          </div>
        </div>
        {!empty && (
          <div className="shrink-0 px-6 pb-6 pt-2">
            <div className="mx-auto w-full max-w-(--bs-layout-eco-chat-column)">
              {composer}
            </div>
          </div>
        )}
      </section>
      <AgentPanel chat={active} />
    </div>
  );
}
