import type { ReactNode } from "react";
import { Icon } from "./icon";
import { capabilityIntersection } from "./capabilities";
import {
  DecisionChip,
  IdToken,
  MockBadge,
  TierBadge,
  type Tier,
} from "./primitives";

export function CapabilityIntersection({
  delegated,
  permitted,
  useCase,
  requested,
  qualifiers = {},
}: {
  delegated: string[];
  permitted: string[];
  useCase: string;
  requested?: string;
  qualifiers?: Record<string, string>;
}) {
  const effective = capabilityIntersection(delegated, permitted);
  const union = [...new Set([...delegated, ...permitted])].sort();
  const mark = (yes: boolean) =>
    yes ? (
      <Icon name="streamline:check" size={14} />
    ) : (
      <span aria-label="No">–</span>
    );
  return (
    <section aria-label="Capability intersection" className="space-y-4">
      <div className="flex flex-wrap items-center gap-0 text-xs">
        <div className="rounded-l-lg border border-line-strong px-3 py-4">
          Delegated <b>{new Set(delegated).size}</b>
        </div>
        <div className="border-y border-line-strong bg-accent-tint px-3 py-4 text-accent-text">
          Effective <b>{effective.length}</b>
        </div>
        <div className="rounded-r-lg border border-line-strong px-3 py-4">
          Permitted <b>{new Set(permitted).size}</b>
        </div>
      </div>
      <p className="text-sm text-fg-secondary">
        Effective = delegated to the agent ∩ permitted by policy for the use
        case
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line-default text-xs text-fg-secondary">
            <tr>
              <th className="py-3 pr-4">Capability</th>
              <th className="pr-4">Delegated</th>
              <th className="pr-4">Permitted for {useCase}</th>
              <th>Effective</th>
            </tr>
          </thead>
          <tbody>
            {union.map((capability) => {
              const hasDelegation = delegated.includes(capability);
              const isPermitted = permitted.includes(capability);
              const isEffective = effective.includes(capability);
              return (
                <tr
                  key={capability}
                  className={`border-b border-line-subtle ${requested === capability ? `border-l-2 ${isEffective ? "border-l-allow-fg" : "border-l-deny-fg"} bg-surface-2` : ""}`}
                >
                  <th className="py-3 pr-4 font-mono text-xs font-medium">
                    {capability}
                    {requested === capability && !isEffective && (
                      <p className="mt-1 font-sans text-xs text-deny-fg">
                        {hasDelegation
                          ? `Not permitted for ${useCase}`
                          : "Not delegated"}
                      </p>
                    )}
                  </th>
                  <td>{mark(hasDelegation)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      {mark(isPermitted)}
                      {qualifiers[capability] && (
                        <span className="text-xs text-fg-secondary">
                          {qualifiers[capability]}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    {isEffective ? (
                      <IdToken
                        copy={false}
                        className="bg-accent-tint text-accent-text"
                      >
                        {capability}
                      </IdToken>
                    ) : (
                      mark(false)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const attachmentIcons: Record<string, string> = {
  organization: "streamline-flex:office-building-1",
  team: "streamline-flex:user-collaborate-group",
  user: "streamline-flex:user-circle-single",
  agent: "streamline-flex:ai-chip-robot",
  use_case: "streamline-flex:target",
  tool: "streamline-flex:wrench-hand",
  provider_model: "streamline-flex:artificial-intelligence-brain-chip",
  tier: "streamline-flex:layers-1",
};

export interface ControlCardData {
  id: string;
  name: string;
  description: string;
  asi: string[];
  attachment_points: string[];
  enforcement: string;
  attachments?: { target_type: string; target_id: string }[];
}
export function ControlCard({
  control,
  href,
  selected = false,
}: {
  control: ControlCardData;
  href?: string;
  selected?: boolean;
}) {
  return (
    <article
      className={`flex h-full flex-col rounded-lg border border-line-subtle bg-surface-1 p-4 shadow-e1 hover:shadow-e2 ${selected ? "shadow-selected" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <IdToken
          id={control.id}
          href={
            href ?? `/policy-studio/controls/${encodeURIComponent(control.id)}`
          }
        />
        <span className="inline-flex h-5 items-center gap-1 rounded-pill border border-line-default px-2 text-2xs font-semibold text-fg-secondary">
          <Icon name="streamline-flex:shield-1" size={12} />
          Enforced
        </span>
      </div>
      <h3 className="mt-3 text-md font-semibold">{control.name}</h3>
      <p className="mt-2 line-clamp-3 text-sm text-fg-secondary">
        {control.description}
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {control.asi.map((asi) => (
          <span
            key={asi}
            className="rounded-xs border border-line-default px-1.5 py-0.5 font-mono text-2xs"
          >
            {asi}
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-xs text-fg-secondary">
        {control.attachment_points.map((point) => (
          <span key={point} className="inline-flex items-center gap-1.5">
            <Icon
              name={attachmentIcons[point] ?? "streamline-flex:tag"}
              size={14}
            />
            {point.replaceAll("_", " ")}
          </span>
        ))}
      </div>
      <p className="mt-auto border-t border-line-subtle pt-4 text-xs text-fg-secondary">
        Enforcement: <span className="font-mono">{control.enforcement}</span>
      </p>
    </article>
  );
}

export interface ApprovalCardData {
  id: string;
  trace_id: string;
  state: "none" | "pending" | "approved" | "rejected";
  action: {
    agent: { id: string };
    human: { display_name: string };
    use_case: { name: string };
    capability: string;
    resource: { tier: Tier };
    control_ids: string[];
    reasons: string[];
    analyzer: { model_label: string; rationale: string; verdict: string };
    ai_tightened: boolean;
  };
  parameters: Record<string, unknown>;
  provenance: Record<string, unknown>;
  action_hash: string;
  requires_step_up: boolean;
  created_at: string;
  decided_at: string | null;
  approver: { display_name: string } | null;
}

export function ApprovalCard({
  approval,
  onApprove,
  onReject,
  busy = false,
  awaitingStepUp = false,
  error,
  children,
}: {
  approval: ApprovalCardData;
  onApprove: () => void;
  onReject: () => void;
  busy?: boolean;
  awaitingStepUp?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  const pending = approval.state === "pending";
  return (
    <article
      className={`rounded-lg border bg-surface-1 p-5 ${pending ? (awaitingStepUp ? "border-stepup-border" : "border-approval-border") : "border-line-subtle"}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-sm bg-surface-3 p-2 text-accent-text">
            <Icon name="streamline-flex:ai-chip-robot" size={16} />
          </span>
          <div>
            <IdToken
              id={approval.action.agent.id}
              href={`/identity/agents/${encodeURIComponent(approval.action.agent.id)}`}
            />
            <p className="mt-1 text-sm text-fg-secondary">
              for {approval.action.use_case.name}
            </p>
          </div>
        </div>
        <time
          dateTime={approval.created_at}
          title={new Date(approval.created_at).toLocaleString()}
          className="font-mono text-xs text-fg-secondary"
        >
          {new Date(approval.created_at).toLocaleTimeString([], {
            hour12: false,
          })}
        </time>
      </header>
      <p className="mt-4 text-sm text-fg-secondary">
        Initiated by{" "}
        <span className="text-fg-primary">
          {approval.action.human.display_name}
        </span>
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <IdToken>{approval.action.capability}</IdToken>
        <DecisionChip
          decision={
            approval.requires_step_up && awaitingStepUp
              ? "require_step_up"
              : "require_approval"
          }
          resolution={
            approval.state === "approved"
              ? "approved"
              : approval.state === "rejected"
                ? "rejected"
                : null
          }
          aiTightened={approval.action.ai_tightened}
          modelLabel={approval.action.analyzer.model_label}
          controlIds={approval.action.control_ids}
        />
      </div>
      <h3 className="mb-2 mt-5 text-md font-semibold">
        Parameters as received by the Gateway
      </h3>
      <dl className="space-y-3 rounded-sm bg-surface-inset p-4 font-mono text-sm">
        {Object.entries(approval.parameters).map(([key, value]) => (
          <div key={key} className="grid gap-1 sm:grid-cols-[160px_1fr]">
            <dt className="text-fg-secondary">{key}</dt>
            <dd className="break-all">
              {typeof value === "string" ? value : JSON.stringify(value)}
              {key in approval.provenance && (
                <p className="mt-1 text-xs text-fg-secondary">
                  Source:{" "}
                  {typeof approval.provenance[key] === "string"
                    ? approval.provenance[key]
                    : JSON.stringify(approval.provenance[key])}
                </p>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {Object.keys(approval.parameters).length === 0 && (
        <p className="rounded-sm bg-surface-inset p-4 font-mono text-sm">
          {"{}"}
        </p>
      )}
      <details className="mt-3 text-sm text-fg-secondary">
        <summary className="cursor-pointer">
          Provenance recorded by the Gateway
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-sm bg-surface-inset p-4 font-mono text-xs">
          {JSON.stringify(approval.provenance, null, 2)}
        </pre>
      </details>
      <p className="mt-3 break-all font-mono text-xs text-fg-secondary">
        Action hash: {approval.action_hash}
      </p>
      <h3 className="mt-5 text-md font-semibold">Why a human</h3>
      <p className="mt-2 text-sm text-fg-secondary">
        {approval.action.reasons.join(" ")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {approval.action.control_ids.map((id) => (
          <IdToken
            key={id}
            id={id}
            href={`/policy-studio/controls/${encodeURIComponent(id)}`}
          />
        ))}
        <TierBadge tier={approval.action.resource.tier} />
      </div>
      {!["skipped", "clean"].includes(approval.action.analyzer.verdict) && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-fg-secondary">
            AI analysis: {approval.action.analyzer.rationale}
          </p>
          <MockBadge modelLabel={approval.action.analyzer.model_label} />
        </div>
      )}
      {approval.approver && (
        <p className="mt-4 text-sm">
          {approval.state === "approved" ? "Approved" : "Rejected"} by{" "}
          {approval.approver.display_name}
          {approval.decided_at &&
            ` at ${new Date(approval.decided_at).toLocaleTimeString([], { hour12: false })}`}
        </p>
      )}
      {awaitingStepUp && (
        <p role="status" className="mt-4 text-sm text-stepup-fg">
          Waiting for the one-time code in Keycloak
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
      {pending && (
        <div className="mt-5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || awaitingStepUp}
              onClick={onApprove}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-md font-semibold text-fg-on-accent hover:bg-accent-hover"
            >
              {approval.requires_step_up && (
                <Icon name="streamline-flex:fingerprint-1" />
              )}
              {busy
                ? "Submitting…"
                : approval.requires_step_up
                  ? "Approve with step-up"
                  : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy || awaitingStepUp}
              onClick={onReject}
              className="h-11 rounded-md border border-deny-border px-5 text-md font-semibold text-deny-fg hover:bg-deny-bg"
            >
              Reject
            </button>
          </div>
          {approval.requires_step_up && (
            <p className="mt-2 text-xs text-fg-secondary">
              Keycloak will ask for a one-time code. Approval applies only to
              these exact parameters.
            </p>
          )}
        </div>
      )}
      <a
        href={`http://director.betsee.localhost/traces/${encodeURIComponent(approval.trace_id)}`}
        className="mt-5 inline-flex items-center gap-2 text-sm text-accent-text"
      >
        Open trace
        <Icon name="streamline-flex:arrow-expand" size={14} />
      </a>
      {children}
    </article>
  );
}
