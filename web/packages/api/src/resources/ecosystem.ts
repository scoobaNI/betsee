import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../client.ts";

export const ecosystemKeys = {
  controls: ["controls"],
  policies: ["policies"],
  useCases: ["use-cases"],
  connectors: ["connectors"],
  approvals: ["approvals"],
  agents: ["agents"],
  me: ["me"],
} as const;
export function usePolicies() {
  return useQuery({
    queryKey: ecosystemKeys.policies,
    queryFn: async () => (await unwrap(api.GET("/api/v1/policies"))).items,
  });
}
export {
  useControls as useControlCatalog,
  useUseCases,
  useConnectors,
  useApprovals,
  useAgents as useEcosystemAgents,
  useMe as useEcosystemMe,
  useSummary as useEcosystemSummary,
  useSecurityEvents,
} from "../queries.ts";
export function useApprovalDecision() {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      decision,
      reason,
    }: {
      id: string;
      decision: "approve" | "reject";
      reason: string;
    }) =>
      unwrap(
        await api.POST(
          decision === "approve"
            ? "/api/v1/approvals/{id}/approve"
            : "/api/v1/approvals/{id}/reject",
          { params: { path: { id } }, body: { reason } },
        ),
      ),
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: ecosystemKeys.approvals }),
        queries.invalidateQueries({ queryKey: ["traces"] }),
        queries.invalidateQueries({ queryKey: ["summary"] }),
      ]);
    },
  });
}
