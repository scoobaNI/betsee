import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { openEventStream, type EventStreamHandle } from '../stream.ts';
import type { ActionSummary, Agent, AgentStateChanged, Coverage, Trace } from '../types.ts';
import { createMockFetch } from './fetch.ts';
import { createMockWorld, type MockWorld } from './generator.ts';

const BASE = 'http://director.betsee.localhost';
let world: MockWorld | undefined;
let stream: EventStreamHandle | undefined;

afterEach(() => {
  stream?.close();
  world?.stop();
  stream = undefined;
  world = undefined;
});

function until(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('condition not met in time'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

function boot() {
  world = createMockWorld({ seed: 11, timeScale: 0.01, backgroundEveryMs: [100_000, 100_000], backfill: 20 });
  world.start();
  const fetchImpl = createMockFetch(world, { latencyMs: 0, pingMs: 50 });
  const events: { type: string; data: unknown }[] = [];
  stream = openEventStream({
    url: `${BASE}/api/v1/events/stream`,
    fetch: fetchImpl,
    onMessage: (m) => events.push({ type: m.event, data: JSON.parse(m.data) }),
    backoffMs: () => 0,
  });
  return { fetchImpl, events };
}

const get = async <T>(fetchImpl: typeof fetch, path: string) => {
  const res = await fetchImpl(`${BASE}${path}`);
  return { status: res.status, body: (await res.json()) as T };
};

describe('mock world over mock fetch', () => {
  it('backfills a feed and serves each trace with its spans', async () => {
    const { fetchImpl } = boot();
    const list = await get<{ items: ActionSummary[] }>(fetchImpl, '/api/v1/traces');
    assert.equal(list.body.items.length, 20);
    const first = list.body.items[0];
    const trace = await get<Trace>(fetchImpl, `/api/v1/traces/${first.trace_id}`);
    assert.equal(trace.status, 200);
    assert.equal(trace.body.spans[0].stage, 'authenticate');
    assert.ok(trace.body.spans.every((s) => s.status !== ('ok' as string)));
    assert.equal(trace.body.spans.at(-1)?.stage, 'audit');
    assert.equal((await get(fetchImpl, '/api/v1/traces/nope')).status, 404);
  });

  it('act 5 streams a pending approval, then the approved update for the same trace', async () => {
    const { fetchImpl, events } = boot();
    const runRes = await fetchImpl(`${BASE}/api/v1/demo/scenarios/act5-human-decides/runs`, { method: 'POST' });
    assert.equal(runRes.status, 202);
    const { run_id } = (await runRes.json()) as { run_id: string };
    await until(() => events.some((e) => e.type === 'action.updated'));
    const decided = events.find((e) => e.type === 'action.decided')!.data as ActionSummary;
    const updated = events.find((e) => e.type === 'action.updated')!.data as ActionSummary;
    assert.equal(decided.decision, 'require_approval');
    assert.equal(decided.approval_state, 'pending');
    assert.equal(updated.trace_id, decided.trace_id);
    assert.equal(updated.approval_state, 'approved');
    const trace = await get<Trace>(fetchImpl, `/api/v1/traces/${decided.trace_id}`);
    const stages = trace.body.spans.map((s) => `${s.stage}:${s.status}`);
    assert.ok(stages.includes('approval:passed'));
    assert.ok(stages.includes('step_up:passed'));
    assert.ok(stages.includes('connector:passed'));
    assert.equal(trace.body.executed, true);
    const approvals = await get<{ items: { trace_id: string; state: string; requires_step_up: boolean }[] }>(fetchImpl, '/api/v1/approvals');
    const approval = approvals.body.items.find((a) => a.trace_id === decided.trace_id)!;
    assert.equal(approval.state, 'approved');
    assert.equal(approval.requires_step_up, true);
    const run = await get<{ status: string; steps: { trace_id: string }[] }>(fetchImpl, `/api/v1/demo/runs/${run_id}`);
    assert.equal(run.body.status, 'passed');
    assert.equal(run.body.steps[0].trace_id, decided.trace_id);
  });

  it('act 3 tightens memory.write and never shows a real model name', async () => {
    const { fetchImpl, events } = boot();
    await fetchImpl(`${BASE}/api/v1/demo/scenarios/act3-hijacked-goal/runs`, { method: 'POST' });
    await until(() => events.filter((e) => e.type === 'action.decided').length === 3);
    const actions = events.filter((e) => e.type === 'action.decided').map((e) => e.data as ActionSummary);
    assert.deepEqual(
      actions.map((a) => [a.capability, a.decision, a.ai_tightened]),
      [
        ['tickets.read', 'allow', false],
        ['email.send', 'deny', false],
        ['memory.write', 'require_approval', true],
      ],
    );
    const tightened = actions[2];
    assert.equal(tightened.deterministic_decision, 'allow');
    assert.equal(tightened.analyzer.model_label, 'mock model (demo)');
    assert.equal(tightened.analyzer.verdict, 'suspicious');
    assert.equal(actions[1].analyzer.verdict, 'skipped');
    assert.equal(actions[1].executed, false);
  });

  it('act 6 quarantines report-bot and denies everything after', async () => {
    const { fetchImpl, events } = boot();
    await fetchImpl(`${BASE}/api/v1/demo/scenarios/act6-supply-chain-and-rogue/runs`, { method: 'POST' });
    await until(() => events.filter((e) => e.type === 'action.decided').length === 25);
    const state = events.find((e) => e.type === 'agent.state_changed')?.data as AgentStateChanged;
    assert.equal(state.agent_id, 'report-bot');
    assert.equal(state.state, 'quarantined');
    const reportBot = events
      .filter((e) => e.type === 'action.decided')
      .map((e) => e.data as ActionSummary)
      .filter((a) => a.agent.id === 'report-bot');
    assert.deepEqual(
      reportBot.slice(-7).map((a) => a.decision),
      Array(7).fill('deny'),
    );
    const coverage = await get<{ items: Coverage[] }>(fetchImpl, '/api/v1/coverage');
    const deny = (asi: string) => coverage.body.items.find((r) => r.asi_id === asi)!.decision_counts.deny as number;
    assert.ok(deny('ASI10') > 0);
    assert.ok(deny('ASI04') > 0);
    assert.ok(coverage.body.items.find((r) => r.asi_id === 'ASI04')!.primitives.some((p) => p.id === 'PRM-TOOL'));

    await fetchImpl(`${BASE}/api/v1/demo/reset`, { method: 'POST' });
    const agents = await get<{ items: Agent[] }>(fetchImpl, '/api/v1/agents');
    assert.equal(agents.body.items.find((a) => a.id === 'report-bot')!.state, 'active');
  });

  it('resumes a dropped stream from Last-Event-ID without losing events', async () => {
    const { fetchImpl, events } = boot();
    world!.perform({
      agentId: 'ops-runner',
      capability: 'shell.exec',
      resource: { type: 'command', id: 'kubectl get pods', tier: 'internal' },
      tool: null,
      outcome: { kind: 'allow' },
    });
    await until(() => events.length === 1);
    stream!.close();
    const lastId = stream!.lastEventId;
    for (let i = 0; i < 3; i++) {
      world!.perform({
        agentId: 'ops-runner',
        capability: 'shell.exec',
        resource: { type: 'command', id: `kubectl get pods ${i}`, tier: 'internal' },
        tool: null,
        outcome: { kind: 'allow' },
      });
    }
    const resumed: string[] = [];
    stream = openEventStream({
      url: `${BASE}/api/v1/events/stream`,
      fetch: fetchImpl,
      lastEventId: lastId,
      onMessage: (m) => resumed.push((JSON.parse(m.data) as ActionSummary).resource.id),
    });
    await until(() => resumed.length === 3);
    assert.deepEqual(resumed, ['kubectl get pods 0', 'kubectl get pods 1', 'kubectl get pods 2']);
  });
});
