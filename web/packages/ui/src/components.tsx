import { Fragment, type ReactNode } from "react";
import { Icon } from "./icon";
import { capabilityIntersection } from "./capabilities";
import {
  gatewayField,
  paymentAmount,
  unverifiedParameters,
} from "./approval-facts";
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
                <Fragment key={capability}>
                  <tr
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
                    <td>{mark(isPermitted)}</td>
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
                  {qualifiers[capability] && (
                    <tr className="border-b border-line-subtle">
                      <td
                        colSpan={4}
                        className="pb-3 text-xs text-fg-secondary"
                      >
                        {qualifiers[capability]}
                      </td>
                    </tr>
                  )}
                </Fragment>
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
  state: "none" | "pending" | "approved" | "rejected" | "voided";
  action: {
    agent: { id: string };
    human?: { display_name: string };
    use_case?: { name: string };
    session_id?: string;
    capability: string;
    resource: { tier: Tier; id: string; type: string };
    control_ids: string[];
    policy_ids?: string[];
    reasons: unknown[];
    analyzer: { model_label: string; rationale: string; verdict: string };
    ai_tightened: boolean;
  };
  parameters: Record<string, unknown>;
  gateway_facts?: Record<string, unknown>;
  requested_reasons?: unknown[];
  requested_control_ids?: string[];
  approver_acr?: string | null;
  provenance: Record<string, unknown>;
  action_hash: string;
  requires_step_up: boolean;
  created_at: string;
  decided_at: string | null;
  approver: { display_name: string } | null;
}

const POLICY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

function reasonSentences(
  reasons: unknown[],
  policyIds: string[] = [],
): string[] {
  return reasons
    .map((r) =>
      typeof r === "string" ? r : ((r as { text?: unknown })?.text ?? ""),
    )
    .filter(
      (r): r is string =>
        typeof r === "string" &&
        r.trim() !== "" &&
        !policyIds.includes(r) &&
        !POLICY_ID.test(r.trim()),
    );
}

function Fact({
  label,
  children,
  verified = false,
}: {
  label: string;
  children: ReactNode;
  verified?: boolean;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_1fr]">
      <dt className="text-sm text-fg-secondary">{label}</dt>
      <dd className="min-w-0 text-md">
        {children}
        {verified && (
          <p className="mt-1 font-sans text-xs text-fg-tertiary">
            Source: Gateway
          </p>
        )}
      </dd>
    </div>
  );
}

export function ApprovalCard({
  approval,
  onApprove,
  onReject,
  busy = false,
  awaitingStepUp = false,
  submittingDecision = "approve",
  error,
  children,
}: {
  approval: ApprovalCardData;
  onApprove: () => void;
  onReject: () => void;
  busy?: boolean;
  awaitingStepUp?: boolean;
  submittingDecision?: "approve" | "reject";
  error?: string | null;
  children?: ReactNode;
}) {
  const pending = approval.state === "pending";
  const { action } = approval;
  const amount = paymentAmount(
    approval.parameters,
    approval.provenance,
    approval.gateway_facts,
  );
  const agentKeys = unverifiedParameters(approval.parameters, amount !== null);
  const reasons = reasonSentences(
    approval.requested_reasons ?? (pending ? action.reasons : []),
    pending ? action.policy_ids : [],
  );
  const controlIds =
    approval.requested_control_ids ?? (pending ? action.control_ids : []);
  const payment = action.capability.startsWith("payments.");
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
              id={action.agent.id}
              href={`/identity/agents/${encodeURIComponent(action.agent.id)}`}
            />
            <p className="mt-1 text-sm text-fg-secondary">
              for {action.use_case?.name ?? "Use case not recorded"}
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
          aiTightened={action.ai_tightened}
          modelLabel={action.analyzer.model_label}
          controlIds={action.control_ids}
        />
        {approval.requires_step_up && pending && (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-dashed border-stepup-border bg-stepup-bg px-2.5 text-xs font-semibold text-stepup-fg">
            <Icon name="streamline-flex:fingerprint-1" size={14} />
            Step-up required
          </span>
        )}
      </div>

      <section aria-label="Action recorded by the Gateway" className="mt-5">
        <h3 className="flex items-center gap-2 text-md font-semibold">
          <Icon
            name="streamline-flex:shield-2"
            size={16}
            className="text-accent-text"
          />
          The action, as the Gateway recorded it
        </h3>
        <p className="mt-1 text-xs text-fg-secondary">
          Approval applies to exactly this action. The Gateway re-checks every
          control before it executes.
        </p>
        <dl className="mt-3 space-y-2.5 rounded-sm bg-surface-inset p-4">
          {payment && (
            <Fact label="Amount" verified={amount !== null}>
              <span
                className={
                  amount
                    ? "font-display text-3xl font-semibold tabular-nums"
                    : "text-sm text-fg-tertiary"
                }
              >
                {amount ?? "Not provided by the Gateway"}
              </span>
            </Fact>
          )}
          <Fact label={payment ? "Payee" : "Resource"}>
            <span className="break-words font-mono text-md">
              {action.resource.id}
            </span>
            <span className="ml-2 font-mono text-xs text-fg-secondary">
              {action.resource.type}
            </span>
          </Fact>
          <Fact
            label="Capability"
            verified={gatewayField(approval.provenance, "capability")}
          >
            <IdToken copy={false}>{action.capability}</IdToken>
          </Fact>
          <Fact label="Information tier">
            <TierBadge tier={action.resource.tier} />
          </Fact>
          <Fact label="Agent">
            <span className="font-mono">{action.agent.id}</span>
          </Fact>
          <Fact label="Session created by">
            {action.human?.display_name ?? "Not recorded"}
          </Fact>
          <Fact label="Use case">
            {action.use_case?.name ?? "Not recorded"}
          </Fact>
          {action.session_id && (
            <Fact
              label="Session"
              verified={gatewayField(approval.provenance, "session_id")}
            >
              <IdToken id={action.session_id} />
            </Fact>
          )}
          <Fact label="Trace">
            <IdToken
              id={approval.trace_id}
              href={`http://director.betsee.localhost/traces/${encodeURIComponent(approval.trace_id)}`}
            />
          </Fact>
          <Fact label="Action hash">
            <IdToken id={approval.action_hash} className="max-w-72" />
          </Fact>
        </dl>
      </section>

      {agentKeys.length > 0 && (
        <section
          aria-label="Agent-supplied, unverified"
          className="mt-4 rounded-sm border border-dashed border-line-strong p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg-secondary">
            <Icon name="streamline-flex:information-circle" size={14} />
            Agent-supplied, unverified
          </h3>
          <p className="mt-1 text-xs text-fg-tertiary">
            These are agent-supplied values. Review them separately from the
            Gateway facts above.
          </p>
          <dl className="mt-3 space-y-1.5 text-sm">
            {agentKeys.map((key) => {
              const value = approval.parameters[key];
              return (
                <div key={key} className="grid gap-1 sm:grid-cols-[150px_1fr]">
                  <dt className="text-xs text-fg-tertiary">{key}</dt>
                  <dd className="whitespace-pre-wrap break-words text-fg-secondary">
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {reasons.length > 0 || pending ? (
        <>
          <h3 className="mt-5 text-md font-semibold">Why a human</h3>
          {reasons.length > 0 && (
            <div className="mt-2 text-sm text-fg-secondary">
              <p>
                {pending
                  ? "Awaiting approval because:"
                  : "Human review was required because:"}
              </p>
              <ul className="mt-2 space-y-2">
                {reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          {controlIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {controlIds.map((id) => (
                <IdToken
                  key={id}
                  id={id}
                  href={`/policy-studio/controls/${encodeURIComponent(id)}`}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="mt-5 text-sm text-fg-secondary">
          The original approval reason is recorded in the{" "}
          <a
            className="underline hover:text-fg-primary"
            href={`http://director.betsee.localhost/traces/${encodeURIComponent(approval.trace_id)}`}
          >
            full trace
          </a>
          , which keeps the require-approval and step-up decision.
        </p>
      )}
      {!["skipped", "clean"].includes(action.analyzer.verdict) && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-fg-secondary">
            AI analysis: {action.analyzer.rationale}
          </p>
          <MockBadge modelLabel={action.analyzer.model_label} />
        </div>
      )}
      <details className="mt-4 text-xs text-fg-secondary">
        <summary className="cursor-pointer">
          Raw provenance record from the Gateway
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-sm bg-surface-inset p-3 font-mono text-xs">
          {JSON.stringify(approval.provenance, null, 2)}
        </pre>
      </details>
      {approval.approver && (
        <p className="mt-4 text-sm">
          {approval.state === "approved" ? "Approved" : "Rejected"} by{" "}
          {approval.approver.display_name}
          {approval.state === "approved" &&
            approval.requires_step_up &&
            approval.approver_acr &&
            ` with step-up (acr ${approval.approver_acr})`}
          {approval.decided_at &&
            ` at ${new Date(approval.decided_at).toLocaleTimeString([], { hour12: false })}`}
        </p>
      )}
      {awaitingStepUp && (
        <p role="status" className="mt-4 text-sm text-stepup-fg">
          The Gateway requires step-up. Opening Keycloak for your one-time code.
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
              disabled={
                busy ||
                awaitingStepUp ||
                (payment && amount === null) ||
                !action.human ||
                !action.use_case
              }
              onClick={onApprove}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-md font-semibold text-fg-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-disabled disabled:hover:bg-surface-3"
            >
              {busy && submittingDecision === "approve" ? (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-pill border-2 border-current border-r-transparent motion-reduce:animate-none"
                />
              ) : (
                approval.requires_step_up && (
                  <Icon name="streamline-flex:fingerprint-1" />
                )
              )}
              {busy && submittingDecision === "approve"
                ? "Submitting…"
                : approval.requires_step_up
                  ? "Approve with step-up"
                  : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy || awaitingStepUp}
              onClick={onReject}
              className="inline-flex h-11 items-center gap-2 rounded-md border border-deny-border px-5 text-md font-semibold text-deny-fg hover:bg-deny-bg"
            >
              {busy && submittingDecision === "reject" && (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-pill border-2 border-current border-r-transparent motion-reduce:animate-none"
                />
              )}
              {busy && submittingDecision === "reject"
                ? "Submitting…"
                : "Reject"}
            </button>
          </div>
          {approval.requires_step_up && !(payment && amount === null) && (
            <p className="mt-2 text-xs text-fg-secondary">
              Keycloak will ask for a one-time code. Approval applies only to
              the action recorded above.
            </p>
          )}
          {payment && amount === null && (
            <p className="mt-2 text-sm text-fg-secondary">
              This cannot be approved here: the Gateway did not bind the amount.
              You can still reject it.
            </p>
          )}
        </div>
      )}
      {children}
    </article>
  );
}
