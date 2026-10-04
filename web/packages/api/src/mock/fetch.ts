// A fetch() that answers /api/v1/* from the mock world. Only the network is fake: the typed client,
// the SSE reader and the query hooks run their real code paths in mock mode.
import { ecosystemMockResponse } from './fixtures/ecosystem.ts';
import { AccessError, type AccessChangeRequest, type LoggedEvent, type MockWorld } from './generator.ts';
import { CONTROLS, MOCK_ME } from './world.ts';

/** Extra routes an app adds to the mock (frontend-ecosystem's fixtures); null passes it on. */
export type MockHandler = (
  world: MockWorld,
  path: string,
  method: string,
  body: unknown,
  headers: Headers,
) => Response | null | Promise<Response | null>;

export interface MockFetchOptions {
  latencyMs?: number;
  pingMs?: number;
  /** Consulted in order before the built-in routes. */
  handlers?: MockHandler[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const notFound = (what: string) => json({ error: 'not_found', message: `${what} not found` }, 404);

export function createMockFetch(world: MockWorld, options: MockFetchOptions = {}): typeof fetch {
  const latencyMs = options.latencyMs ?? 120;
  const pingMs = options.pingMs ?? 15_000;
  const handlers: MockHandler[] = [ecosystemMockResponse, ...(options.handlers ?? [])];
  // Approvals that already answered step_up_required once; the retry after step-up approves.
  const challenged = new Set<string>();

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : (request?.url ?? '');
    const url = new URL(href, 'http://mock.local');
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    const signal = init?.signal ?? request?.signal ?? undefined;
    const path = url.pathname.replace(/\/+$/, '');

    if (method === 'GET' && path === '/api/v1/events/stream') {
      const cursor = headers.get('Last-Event-ID');
      return eventStream(world, cursor ? Number(cursor) : null, signal, pingMs);
    }

    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));

    const raw = init?.body != null ? String(init.body) : request ? await request.clone().text() : '';
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    for (const handle of handlers) {
      const answer = await handle(world, path, method, body, headers);
      if (answer) return answer;
    }

    let m: RegExpMatchArray | null;
    if (method === 'GET') {
      if (path === '/api/v1/me') return json(MOCK_ME);
      if (path === '/api/v1/agents') return json({ items: world.agents() });
      if (path === '/api/v1/use-cases') return json({ items: world.useCases() });
      if (path === '/api/v1/sessions') return json({ items: world.sessions() });
      if ((m = path.match(/^\/api\/v1\/sessions\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        const session = world.sessions().find((s) => s.id === id);
        return session ? json(session) : notFound('session');
      }
      if (path === '/api/v1/traces') return json({ items: world.traces() });
      if ((m = path.match(/^\/api\/v1\/traces\/([^/]+)$/))) {
        const trace = world.trace(decodeURIComponent(m[1]));
        return trace ? json(trace) : notFound('trace');
      }
      if (path === '/api/v1/approvals') return json({ items: world.approvals() });
      if (path === '/api/v1/controls') return json({ items: CONTROLS });
      if (path === '/api/v1/policies') return json({ items: policies() });
      if ((m = path.match(/^\/api\/v1\/policies\/([^/]+)$/))) {
        const policy = policies().find((p) => p.id === decodeURIComponent(m![1]));
        return policy ? json(policy) : notFound('policy');
      }
      if (path === '/api/v1/agent-messages') return json({ items: world.messages() });
      if (path === '/api/v1/security-events') return json({ items: world.securityEvents() });
      if (path === '/api/v1/summary') return json(world.summary());
      if (path === '/api/v1/access') return json(world.access());
      if (path === '/api/v1/coverage') return json({ items: world.coverage() });
      if (path === '/api/v1/demo/scenarios') return json(world.scenarios());
      if ((m = path.match(/^\/api\/v1\/demo\/runs\/([^/]+)$/))) {
        const run = world.run(decodeURIComponent(m[1]));
        return run ? json(run) : notFound('run');
      }
    }
    if (method === 'POST') {
      if ((m = path.match(/^\/api\/v1\/demo\/scenarios\/([^/]+)\/runs$/))) {
        const runId = world.launch(decodeURIComponent(m[1]));
        return runId ? json({ run_id: runId }, 202) : notFound('scenario');
      }
      if ((m = path.match(/^\/api\/v1\/agents\/([^/]+)\/release$/))) {
        const agent = world.release(decodeURIComponent(m[1]));
        return agent ? json(agent) : notFound('agent');
      }
      if ((m = path.match(/^\/api\/v1\/approvals\/([^/]+)\/(approve|reject)$/))) {
        const id = decodeURIComponent(m[1]);
        const approval = world.approval(id);
        if (!approval) return notFound('approval');
        if (approval.state !== 'pending') {
          return json({ error: 'conflict', message: `approval is already ${approval.state}`, trace_id: approval.trace_id }, 409);
        }
        if (m[2] === 'approve' && approval.requires_step_up && !challenged.has(id)) {
          challenged.add(id);
          return json({ status: 'step_up_required', trace_id: approval.trace_id, approval_id: id, acr_values: '2', action: approval.action });
        }
        const decided = world.resolveApproval(id, m[2] === 'approve' ? 'approved' : 'rejected')!;
        return json({ status: decided.state, trace_id: decided.trace_id, approval_id: id, acr_values: null, action: decided.action });
      }
      if (path === '/api/v1/access/changes') {
        const { changes, reason, suggestion_id } = (body ?? {}) as { changes?: AccessChangeRequest[]; reason?: string; suggestion_id?: string };
        if (!Array.isArray(changes) || !changes.length) return json({ error: 'invalid', message: 'changes must be a non-empty list' }, 422);
        try {
          return json({ items: world.applyAccess(changes, MOCK_ME.human, reason?.trim() ?? '', suggestion_id ?? null) });
        } catch (error) {
          if (error instanceof AccessError) return json({ error: 'invalid', message: error.message }, 422);
          throw error;
        }
      }
      if (path === '/api/v1/demo/reset') {
        world.reset();
        return new Response(null, { status: 202 });
      }
    }
    return json({ error: 'not_found', message: `${method} ${path} is not mocked` }, 404);
  };

  return handler as typeof fetch;
}

// Policy source text lives in the Gateway; mock mode says so instead of inventing Cedar.
function policies() {
  const byId = new Map<string, string[]>();
  for (const control of CONTROLS) {
    for (const id of control.policy_ids) byId.set(id, [...(byId.get(id) ?? []), control.id]);
  }
  return [...byId].map(([id, controlIds]) => ({
    id,
    name: id,
    cedar: '// Mock data: the Cedar source is served by the Gateway (policies/*.cedar).',
    control_ids: controlIds,
  }));
}

function eventStream(
  world: MockWorld,
  lastEventId: number | null,
  signal: AbortSignal | undefined,
  pingMs: number,
): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const send = (e: LoggedEvent) =>
        write(`id: ${e.id}\nevent: ${e.event.type}\ndata: ${JSON.stringify(e.event.data)}\n\n`);
      write('retry: 1000\n\n');
      for (const e of world.eventsAfter(lastEventId)) send(e);
      const unsubscribe = world.subscribe(send);
      const ping = setInterval(() => write(': ping\n\n'), pingMs);
      cleanup = () => {
        unsubscribe();
        clearInterval(ping);
      };
      signal?.addEventListener('abort', () => {
        cleanup();
        try {
          controller.error(new DOMException('Aborted', 'AbortError'));
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}
