// Shared pieces of a governed chat: the thread (messages, tool cards with their Gateway decision,
// blocked messages, files) and the composer. Used by the ecosystem /chat page and by Betsee Desk.
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { DecisionChip, Icon, IdToken, TierBadge } from "@betsee/ui";
import type { ThreadItem, ToolDecision } from "@betsee/api/chat";

export const DIRECTOR = "http://director.betsee.localhost";
export const AGENT = "employee-assistant";
export const APPROVALS = "http://betsee.localhost/approvals";
const WRITE_TOOLS = new Set(["Write", "Edit", "apply_patch"]);

export const TOOL_ICONS: Record<string, string> = {
  Bash: "streamline-flex:code-monitor-1",
  Write: "streamline-flex:pencil-square",
  Edit: "streamline-flex:pencil-square",
  WebFetch: "streamline-flex:link-chain",
  WebSearch: "streamline-flex:link-chain",
};

export const time = (at: string) =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export function AgentMark({ size = 24 }: { size?: number }) {
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

export function GovernedMarker() {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-pill border border-accent-edge bg-accent-tint px-3 text-sm font-medium text-accent-text">
      <Icon name="streamline-flex:shield-2" size={14} />
      Governed by Betsee
    </span>
  );
}

/** Assistant text: paragraphs, bullet and numbered lists, **bold** and `code`. No raw HTML. */
export function RichText({ text }: { text: string }) {
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

export function TraceLink({
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

export function ControlIds({ ids }: { ids: string[] }) {
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

export function ToolCard({
  item,
  onDownload,
}: {
  item: Extract<ThreadItem, { kind: "tool" }>;
  onDownload?: (path: string) => void;
}) {
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
          <a
            href={APPROVALS}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline"
          >
            Approvals
          </a>
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
      {onDownload &&
        WRITE_TOOLS.has(item.tool) &&
        decision?.decision === "allow" &&
        item.result &&
        !item.result.isError &&
        decision.resource.id.startsWith("workspace/") && (
          <button
            type="button"
            onClick={() =>
              onDownload(decision.resource.id.replace(/^workspace\//, ""))
            }
            className="mt-3 inline-flex h-8 items-center gap-2 rounded-md bg-surface-2 px-3 text-sm font-medium hover:bg-surface-3"
          >
            <Icon name="streamline:download-box-1" size={14} />
            Download {decision.resource.id.replace(/^workspace\//, "")}
          </button>
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

/** A file that crossed, or was stopped at, the workspace boundary. */
export function FileCard({
  item,
  onDownload,
}: {
  item: Extract<ThreadItem, { kind: "file" }>;
  onDownload?: (path: string) => void;
}) {
  const upload = item.direction === "upload";
  const tier =
    item.tier &&
    ["public", "internal", "confidential", "restricted"].includes(item.tier)
      ? item.tier
      : null;
  return (
    <div
      className={`relative overflow-hidden rounded-lg p-4 shadow-e1 ${upload ? "ml-auto max-w-[80%]" : ""} ${item.allowed ? "bg-surface-1" : "border border-deny-border bg-deny-bg"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-surface-2 text-fg-secondary">
          <Icon
            name={
              upload ? "streamline:paperclip-1" : "streamline:download-box-1"
            }
            size={14}
          />
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-sm font-medium"
          title={item.path ?? item.name}
        >
          {item.name}
        </span>
        {item.fileType && (
          <span className="rounded-pill bg-surface-2 px-2 py-0.5 font-mono text-2xs text-fg-secondary">
            {item.fileType}
          </span>
        )}
        {tier && <TierBadge tier={tier as "internal"} />}
        <DecisionChip
          decision={item.allowed ? "allow" : "deny"}
          size="sm"
          controlIds={item.controlIds}
        />
      </div>
      <p
        className={`mt-2 text-sm ${item.allowed ? "text-fg-secondary" : "text-deny-fg"}`}
      >
        {item.allowed
          ? upload
            ? `Scanned and shared with the assistant as ${item.path}.`
            : "Scanned and released to you."
          : `${upload ? "Not shared" : "Not released"}: ${item.reasons[0] ?? "the file scan refused it"}`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {item.findings.map((finding) => (
          <span
            key={`${finding.class}-${finding.masked}`}
            className="rounded-pill bg-surface-2 px-2 py-0.5 font-mono text-2xs text-fg-secondary"
          >
            {finding.masked}
          </span>
        ))}
        <ControlIds ids={item.controlIds} />
        <span className="ml-auto flex items-center gap-3">
          {onDownload && item.allowed && upload && item.path && (
            <button
              type="button"
              onClick={() => onDownload(item.path ?? "")}
              className="text-xs font-medium text-accent-text hover:underline"
            >
              Download
            </button>
          )}
          <TraceLink traceId={item.traceId} label="View scan" />
        </span>
      </div>
    </div>
  );
}

export function BlockedMessage({
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

export function Thread({
  items,
  busy,
  onDownload,
}: {
  items: ThreadItem[];
  busy: boolean;
  onDownload?: (path: string) => void;
}) {
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
        const human =
          item.kind === "user" ||
          item.kind === "blocked" ||
          (item.kind === "file" && item.direction === "upload");
        const startsAgent = !human && !previousAgent;
        previousAgent = !human;
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
            {item.kind === "tool" && (
              <ToolCard item={item} onDownload={onDownload} />
            )}
            {item.kind === "file" && (
              <FileCard item={item} onDownload={onDownload} />
            )}
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

export function Composer({
  value,
  onChange,
  onSend,
  sending,
  disabled,
  compact,
  onAttach,
  attachments,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled: boolean;
  /** Opens a file picker; files then go through the Gateway scan before the assistant sees them. */
  onAttach?: () => void;
  attachments?: ReactNode;
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
        {attachments}
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
          {onAttach && (
            <>
              <button
                type="button"
                onClick={onAttach}
                className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
              >
                <Icon name="streamline:paperclip-1" size={14} />
                Attach
              </button>
              <span
                className="mx-1 h-4 w-px bg-line-default"
                aria-hidden="true"
              />
            </>
          )}
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
