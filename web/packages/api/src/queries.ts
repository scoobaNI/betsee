import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, demoApi, unwrap } from './client.ts';
import { liveActions, liveMessages, liveSecurityEvents, mergeActions, mergeMessages, mergeSecurityEvents } from './live.ts';
import type { ArtifactScanRequest, EvaluateRequest } from './types.ts';

export const queryKeys = {
  me: ['me'],
  agents: ['agents'],
  sessions: ['sessions'],
  useCases: ['use-cases'],
  traces: ['traces'],
  trace: (traceId: string) => ['trace', traceId],
  approvals: ['approvals'],
  controls: ['controls'],
  policies: ['policies'],
  policy: (id: string) => ['policy', id],
  agentMessages: ['agent-messages'],
  coverage: ['coverage'],
  summary: ['summary'],
  securityEvents: ['security-events'],
  connectors: ['connectors'],
  guardrails: ['guardrails'],
  scenarios: ['demo', 'scenarios'],
  run: (runId: string) => ['demo', 'run', runId],
} as const;

const STATIC = { staleTime: 5 * 60_000 } as const;

export const useMe = () =>
  useQuery({ queryKey: queryKeys.me, queryFn: () => unwrap(api.GET('/api/v1/me')), ...STATIC, retry: false });

export const useAgents = () =>
  useQuery({
    queryKey: queryKeys.agents,
    queryFn: async () => (await unwrap(api.GET('/api/v1/agents'))).items,
  });

export const useSessions = () =>
  useQuery({
    queryKey: queryKeys.sessions,
    queryFn: async () => (await unwrap(api.GET('/api/v1/sessions'))).items,
  });

export const useUseCases = () =>
  useQuery({
    queryKey: queryKeys.useCases,
    queryFn: async () => (await unwrap(api.GET('/api/v1/use-cases'))).items,
    ...STATIC,
  });

/** Newest first. Stream events land in this cache through useLiveSync. */
export const useTraces = () =>
  useQuery({
    queryKey: queryKeys.traces,
    queryFn: async () => mergeActions((await unwrap(api.GET('/api/v1/traces'))).items, liveActions()),
  });

export const useTrace = (traceId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.trace(traceId ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/traces/{trace_id}', { params: { path: { trace_id: traceId! } } })),
    enabled: Boolean(traceId),
  });

export const useApprovals = () =>
  useQuery({
    queryKey: queryKeys.approvals,
    queryFn: async () => (await unwrap(api.GET('/api/v1/approvals'))).items,
  });

export const useControls = () =>
  useQuery({
    queryKey: queryKeys.controls,
    queryFn: async () => (await unwrap(api.GET('/api/v1/controls'))).items,
    ...STATIC,
  });

export const usePolicy = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.policy(id ?? ''),
    queryFn: () => unwrap(api.GET('/api/v1/policies/{id}', { params: { path: { id: id! } } })),
    enabled: Boolean(id),
    ...STATIC,
  });

export const useAgentMessages = () =>
  useQuery({
    queryKey: queryKeys.agentMessages,
    queryFn: async () => mergeMessages((await unwrap(api.GET('/api/v1/agent-messages'))).items, liveMessages()),
  });

export const useCoverage = () =>
  useQuery({
    queryKey: queryKeys.coverage,
    queryFn: async () => (await unwrap(api.GET('/api/v1/coverage'))).items,
  });

/** KPIs counted by the Gateway (contract v0.1); clients cannot compute them cheaply from lists. */
export const useSummary = () =>
  useQuery({ queryKey: queryKeys.summary, queryFn: () => unwrap(api.GET('/api/v1/summary')), refetchInterval: 15_000 });

export const useSecurityEvents = () =>
  useQuery({
    queryKey: queryKeys.securityEvents,
    queryFn: async () =>
      mergeSecurityEvents((await unwrap(api.GET('/api/v1/security-events'))).items, liveSecurityEvents()),
  });

export const useConnectors = () =>
  useQuery({
    queryKey: queryKeys.connectors,
    queryFn: async () => (await unwrap(api.GET('/api/v1/connectors'))).items,
  });

/** The guardrail configuration in force; polled so an accepted or rejected hot reload shows within seconds. */
export const useGuardrails = () =>
  useQuery({ queryKey: queryKeys.guardrails, queryFn: () => unwrap(api.GET('/api/v1/guardrails')), refetchInterval: 5_000 });

/** The guardrail playground: the enforced detectors, signatures and classifier on typed text; no trace. */
export const useEvaluateGuardrails = () =>
  useMutation({ mutationFn: (body: EvaluateRequest) => unwrap(api.POST('/api/v1/guardrails/evaluate', { body })) });

/** Inspects a model or data artifact without loading it; a non-clean verdict becomes a security event. */
export const useScanArtifact = () =>
  useMutation({ mutationFn: (body: ArtifactScanRequest) => unwrap(api.POST('/api/v1/artifacts/scan', { body })) });

/** Releases a quarantined or suspended agent; the Gateway emits agent.state_changed. */
export const useReleaseAgent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      unwrap(api.POST('/api/v1/agents/{id}/release', { params: { path: { id: agentId } } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.agents }),
  });
};

export const useScenarios = () =>
  useQuery({ queryKey: queryKeys.scenarios, queryFn: demoApi.scenarios, ...STATIC, retry: 1 });

/** Polls a launched run until it finishes; steps carry the trace ids to match feed rows. */
export const useScenarioRun = (runId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.run(runId ?? ''),
    queryFn: () => demoApi.run(runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => (query.state.data?.status === 'running' || !query.state.data ? 1_000 : false),
  });

export const useLaunchScenario = () =>
  useMutation({ mutationFn: (scenarioId: string) => demoApi.launch(scenarioId) });

export const useResetDemo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: demoApi.reset,
    onSuccess: () => {
      for (const key of [queryKeys.agents, queryKeys.coverage, queryKeys.approvals, queryKeys.sessions]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
};
