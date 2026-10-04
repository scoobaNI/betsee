import { ApiRequestError, apiFetch, useAgents, useSessions, useUseCases } from '@betsee/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { AccessChange, AccessChangeRequest, AccessSnapshot, AgentAccess, PersonAccess } from './domain/access.ts';
import { useMockMode } from './mock-mode.tsx';

const ACCESS_KEY = ['access'];

async function accessRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${globalThis.location.origin}/api/v1/access${path}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new ApiRequestError(response.status, body, body?.message);
  return body as T;
}

/**
 * Who may do what. The mock world serves the proposed GET /api/v1/access; against the live Gateway,
 * which has no such endpoint yet, the agents' side is rebuilt from their sessions and use cases and
 * people's Desk access and tier ceilings stay unknown (null).
 */
export function useAccess(): { snapshot: AccessSnapshot | undefined; writable: boolean; isPending: boolean; error: unknown; refetch: () => void } {
  const mock = useMockMode();
  const remote = useQuery({ queryKey: ACCESS_KEY, queryFn: () => accessRequest<AccessSnapshot>(''), enabled: mock });
  const agents = useAgents();
  const useCases = useUseCases();
  const sessions = useSessions();
  const derived = useMemo((): AccessSnapshot | undefined => {
    if (mock || !agents.data || !useCases.data) return undefined;
    const byId = new Map(useCases.data.map((u) => [u.id, u]));
    const rows: AgentAccess[] = agents.data.flatMap((agent) => {
      const session = agent.current_session;
      const useCase = session ? byId.get(session.use_case.id) : undefined;
      if (!session || !useCase) return [];
      return [
        {
          agent_id: agent.id,
          use_case: session.use_case,
          permitted: useCase.permitted,
          approval_required: useCase.approval_required,
          step_up_required: useCase.step_up_required,
          delegated: session.delegated,
          effective: session.effective,
          tier_ceiling: session.tier_ceiling,
          state: agent.state,
        },
      ];
    });
    const people = new Map<string, PersonAccess>();
    for (const s of sessions.data ?? []) people.set(s.human.sub, { sub: s.human.sub, display_name: s.human.display_name, desk: null, tier_ceiling: null });
    return { agents: rows, people: [...people.values()], changes: [] };
  }, [mock, agents.data, useCases.data, sessions.data]);

  if (mock) return { snapshot: remote.data, writable: true, isPending: remote.isPending, error: remote.error, refetch: () => void remote.refetch() };
  return {
    snapshot: derived,
    writable: false,
    isPending: agents.isPending || useCases.isPending,
    error: agents.error ?? useCases.error,
    refetch: () => {
      void agents.refetch();
      void useCases.refetch();
    },
  };
}

/** Applies staged changes in one batch (proposed POST /api/v1/access/changes). */
export function useApplyAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { changes: AccessChangeRequest[]; reason: string; suggestionId?: string }) =>
      accessRequest<{ items: AccessChange[] }>('/changes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes: input.changes, reason: input.reason, suggestion_id: input.suggestionId }),
      }),
    onSuccess: () => {
      for (const key of [ACCESS_KEY, ['agents'], ['sessions']]) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
