import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  ApprovalCard,
  DecisionChip,
  IdToken,
  approvalRequestReasons,
} from "@betsee/ui";
import { motion, useReducedMotion } from "motion/react";
import {
  useApprovals,
  useApprovalDecision,
  useControlCatalog,
} from "@betsee/api/resources/ecosystem";
import { ApiRequestError, useTrace, type Approval } from "@betsee/api";
import { useSessionAuth } from "../auth";
import { PageHeader, Tabs } from "../layout";
import { ResourceState } from "../resource-state";

export function Approvals() {
  const query = useApprovals();
  const [params] = useSearchParams();
  const decided = params.get("view") === "decided";
  const items =
    query.data?.filter((a) =>
      decided
        ? a.state === "approved" || a.state === "rejected"
        : a.state === "pending",
    ) ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    sessionStorage.getItem("betsee-step-up-approval"),
  );
  const selected = items.find((a) => a.id === selectedId) ?? items[0];
  return (
    <>
      <PageHeader
        product="Approvals"
        icon="streamline-flex:inbox"
        title="A human decides."
        purpose="High-impact actions wait for a human, with proof of who they are."
      />
      <Tabs
        items={[
          { href: "/approvals", label: "Pending" },
          { href: "/approvals?view=decided", label: "Decided" },
        ]}
      />
      <ResourceState
        query={query}
        noun="approvals"
        empty={!items.length}
        emptyTitle={
          decided
            ? "No decided approvals yet"
            : "Nothing is waiting for a human."
        }
        emptyHint={
          decided
            ? "Decisions appear here after a human reviews the exact action."
            : "Pending high-impact actions appear here as agents request them."
        }
      >
        <div className="eco-detail">
          <div className="space-y-2">
            {items.map((approval) => (
              <button
                key={approval.id}
                onClick={() => setSelectedId(approval.id)}
                aria-pressed={selected?.id === approval.id}
                className={`block w-full rounded-lg border p-4 text-left ${selected?.id === approval.id ? "border-line-focus bg-surface-2" : "border-line-subtle bg-surface-1 hover:bg-surface-2"}`}
              >
                <span className="font-mono text-sm">
                  {approval.action.agent.id}
                </span>
                <p className="mt-2 text-sm text-fg-secondary">
                  {approval.action.use_case?.name ?? "Use case not recorded"} ·{" "}
                  {approval.action.human?.display_name ?? "Human not recorded"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <IdToken copy={false}>{approval.action.capability}</IdToken>
                  <DecisionChip
                    decision="require_approval"
                    resolution={
                      approval.state === "approved"
                        ? "approved"
                        : approval.state === "rejected"
                          ? "rejected"
                          : null
                    }
                    aiTightened={approval.action.ai_tightened}
                    variant="compact"
                  />
                </div>
              </button>
            ))}
          </div>
          {selected && (
            <div className="eco-detail-panel">
              <ApprovalItem key={selected.id} approval={selected} />
            </div>
          )}
        </div>
      </ResourceState>
    </>
  );
}

function ApprovalItem({ approval }: { approval: Approval }) {
  const auth = useSessionAuth();
  const controls = useControlCatalog();
  const record = approval as Approval & {
    requested_reasons?: Approval["action"]["reasons"];
    approver_acr?: string | null;
  };
  const trace = useTrace(
    approval.state === "approved" && !record.approver_acr
      ? approval.trace_id
      : undefined,
  );
  const mutation = useApprovalDecision();
  const [stepUp, setStepUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryDecision, setRetryDecision] = useState<"approve" | "reject">(
    "approve",
  );
  const [retryStepUp, setRetryStepUp] = useState(false);
  const reducedMotion = useReducedMotion();
  const decide = async (decision: "approve" | "reject") => {
    setError(null);
    setRetryDecision(decision);
    try {
      if (decision === "approve" && retryStepUp) {
        setStepUp(true);
        setRetryStepUp(false);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await auth.stepUp(approval.id);
        return;
      }
      const result = await mutation.mutateAsync({
        id: approval.id,
        decision,
        reason:
          decision === "approve"
            ? "Reviewed exact Gateway parameters and provenance."
            : "Rejected after reviewing exact Gateway parameters and provenance.",
      });
      if (result.status === "step_up_required") {
        if (auth.acr === "2") {
          setStepUp(false);
          setRetryStepUp(true);
          setError(
            `Gateway returned step_up_required (HTTP 200, trace ${result.trace_id}). The action remains pending. Retry approval to verify your identity again.`,
          );
          return;
        }
        setStepUp(true);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await auth.stepUp(approval.id);
      } else sessionStorage.removeItem("betsee-step-up-approval");
    } catch (cause) {
      setStepUp(false);
      setError(
        cause instanceof ApiRequestError
          ? `HTTP ${cause.status}: ${cause.message}${cause.traceId ? ` · trace ${cause.traceId}` : ""}. Retry this decision.`
          : cause instanceof Error
            ? cause.message
            : "Could not submit the decision. Retry.",
      );
    }
  };
  const returned =
    sessionStorage.getItem("betsee-step-up-approval") === approval.id &&
    auth.acr === "2";
  const requested = approvalRequestReasons(record);
  const requestedIds = [
    ...new Set(
      requested.flatMap((reason) =>
        typeof reason === "object"
          ? [reason.control_id]
          : approval.state === "pending"
            ? approval.action.control_ids
            : [],
      ),
    ),
  ];
  const reasons = requestedIds
    .map((id) => {
      const control = controls.data?.find((item) => item.id === id);
      const structured = requested.find(
        (reason) => typeof reason === "object" && reason.control_id === id,
      );
      const text =
        typeof structured === "object"
          ? structured.text
          : id === "CTL-AI-001" &&
              approval.action.analyzer.verdict !== "skipped"
            ? (approval.action.analyzer.finding ??
              approval.action.analyzer.rationale)
            : control?.description;
      return text ? `${id} ${control?.name ?? ""}: ${text}` : "";
    })
    .filter(Boolean);
  return (
    <motion.div
      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0.12 : 0.2 }}
    >
      <ApprovalCard
        approval={{
          ...approval,
          requested_reasons: reasons,
          requested_control_ids: requestedIds,
          approver_acr:
            record.approver_acr ??
            String(
              trace.data?.spans.find(
                (span) =>
                  span.stage === "step_up" &&
                  span.status === "passed" &&
                  span.attributes.approver_sub === approval.approver?.sub,
              )?.attributes.acr ?? "",
            ),
        }}
        onApprove={() => {
          void decide("approve");
        }}
        onReject={() => {
          void decide("reject");
        }}
        busy={mutation.isPending}
        submittingDecision={mutation.variables?.decision}
        awaitingStepUp={stepUp}
        error={error}
      >
        {error && approval.state === "pending" && (
          <button
            type="button"
            disabled={mutation.isPending || stepUp}
            className="mt-3 h-11 rounded-md border border-line-default px-4 text-sm hover:bg-surface-2"
            onClick={() => {
              void decide(retryDecision);
            }}
          >
            Retry
          </button>
        )}
        {returned && approval.state === "pending" && (
          <p role="status" className="mt-4 text-sm text-stepup-fg">
            Identity verified. Review the exact parameters above, then approve
            this action.
          </p>
        )}
      </ApprovalCard>
    </motion.div>
  );
}
