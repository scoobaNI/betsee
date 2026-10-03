import createClient from 'openapi-fetch';
import type { paths } from './schema.ts';
import type { ApiError, DemoReset, Scenario, ScenarioRun } from './types.ts';

export type AccessTokenGetter = () => string | null | undefined | Promise<string | null | undefined>;

export interface ApiConfig {
  /** Bearer token for the signed-in human; the app plugs in its OIDC context here. */
  getAccessToken?: AccessTokenGetter;
  /** Replaces the network, e.g. the mock fetch when VITE_BETSEE_MOCK=1. */
  fetch?: typeof fetch;
  mock?: boolean;
}

let config: ApiConfig = {};

export function configureApi(next: ApiConfig): void {
  config = { ...config, ...next };
}

export function apiConfig(): Readonly<ApiConfig> {
  return config;
}

export const origin = (): string => globalThis.location?.origin ?? 'http://localhost';

/** fetch() with the human's bearer token, routed to the mock when one is configured. */
export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = new Request(input instanceof URL ? input.href : input, init);
  const token = await config.getAccessToken?.();
  if (token && !request.headers.has('Authorization')) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  return (config.fetch ?? globalThis.fetch)(request);
};

export const api = createClient<paths>({ baseUrl: origin(), fetch: apiFetch });

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError | undefined;

  constructor(status: number, body: ApiError | undefined, message?: string) {
    super(message ?? body?.message ?? (status === 0 ? 'Gateway unreachable' : `HTTP ${status}`));
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }

  /** The Gateway's trace id for this failure, for the error card's detail line. */
  get traceId(): string | undefined {
    return this.body?.trace_id;
  }
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Resolves openapi-fetch's { data, error } to the data, or throws ApiRequestError. */
export async function unwrap<T>(pending: FetchResult<T> | Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>;
  try {
    result = await pending;
  } catch (cause) {
    throw new ApiRequestError(0, undefined, cause instanceof Error ? `Gateway unreachable: ${cause.message}` : undefined);
  }
  const { data, error, response } = result;
  if (error !== undefined || !response.ok) {
    throw new ApiRequestError(response.status, isApiError(error) ? error : undefined);
  }
  return data as T;
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'error' in value && 'message' in value;
}

async function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(`${origin()}/api/v1/demo${path}`, init);
  } catch (cause) {
    throw new ApiRequestError(0, undefined, cause instanceof Error ? cause.message : undefined);
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new ApiRequestError(response.status, isApiError(body) ? body : undefined);
  return body as T;
}

/** security-architect's demo-runner (p-47, p-114): outside the Gateway contract, same origin. */
export const demoApi = {
  scenarios: () => demoRequest<Scenario[]>('/scenarios'),
  launch: (scenarioId: string) =>
    demoRequest<{ run_id: string }>(`/scenarios/${encodeURIComponent(scenarioId)}/runs`, { method: 'POST' }),
  run: (runId: string) => demoRequest<ScenarioRun>(`/runs/${encodeURIComponent(runId)}`),
  reset: () => demoRequest<DemoReset>('/reset', { method: 'POST' }),
};
