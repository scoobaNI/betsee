import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActionSummary, Span } from '@betsee/api';
import { becauseSentence, isStricter, outcomeTone, resolutionOf } from './decision.ts';
import { computeKpis, groupBursts, recentByAgent } from './feed.ts';
import { callerLabel, callerOf } from './caller.ts';
import { edgeStyle, type EdgeLatest } from './graph-style.ts';
import { buildRail, decidingStage, formatDuration } from './pipeline.ts';

const t0 = Date.parse('2026-10-03T19:00:00.000Z');

function span(stage: Span['stage'], status: Span['status'], startMs: number, durationMs: number, attributes = {}): Span {
  return {
    span_id: stage,
    parent_span_id: null,
    stage,
    status,
    started_at: new Date(t0 + startMs).toISOString(),
    duration_ms: durationMs,
    control_ids: [],
    policy_ids: [],
    reason: '',
    attributes,
  };
}

function action(over: Partial<ActionSummary> & { at: number }): ActionSummary {
  const { at, ...rest } = over;
  return {
    trace_id: `t-${at}-${Math.random().toString(16).slice(2, 8)}`,
    occurred_at: new Date(t0 + at).toISOString(),
    agent: { id: 'report-bot', name: 'report-bot', team: 'Finance' },
    session_id: 's',
    human: { sub: 'u', display_name: 'Maya Chen' },
    use_case: { id: 'weekly-reporting', name: 'Weekly reporting' },
    capability: 'crm.read',
    resource: { type: 'customer', id: 'C-1', tier: 'internal' },
    tool: null,
    decision: 'allow',
    deterministic_decision: 'allow',
    analyzer: { verdict: 'clean', rationale: '', model_label: 'mock model (demo)' },
    ai_tightened: false,
    control_ids: [],
    policy_ids: [],
    reasons: [],
    approval_state: 'none',
    latency_ms: 1,
    executed: true,
    output: null,
    obligations: [],
    step_up_required: false,
    caller_trace_id: null,
    ...rest,
  };
}

describe('pipeline rail', () => {
  it('ends the rail at a deny, keeps audit, and marks the approval as not required', () => {
    const rail = buildRail(
      [
        span('authenticate', 'passed', 0, 2),
        span('resolve_context', 'passed', 2, 3),
        span('identity', 'passed', 5, 1),
        span('capability', 'passed', 6, 1),
        span('cedar_authz', 'passed', 7, 1),
        span('information_tier', 'denied', 8, 1),
        span('decision', 'denied', 9, 1),
        span('audit', 'passed', 10, 4),
      ],
      'deny',
    );
    const status = Object.fromEntries(rail.stages.map((s) => [s.id, s.status]));
    assert.equal(status.information_tier, 'denied');
    assert.equal(status.command_validation, 'not_reached');
    assert.equal(status.connector, 'not_reached');
    assert.equal(status.approval, 'not_reached');
    assert.equal(status.step_up, 'not_reached');
    assert.equal(status.audit, 'passed');
    assert.equal(rail.totalMs, 14);
    assert.equal(decidingStage(rail)?.id, 'information_tier');
  });

  it('expects step-up from the trace, with the real pending span shape (p-251)', () => {
    // The Gateway's pending approval span carries only approval_id and action_hash.
    const pending = span('approval', 'pending', 0, 0, { approval_id: 'apr-1', action_hash: 'sha256:ab' });
    const withStepUp = buildRail([pending], 'require_approval', true);
    const without = buildRail([pending], 'require_approval', false);
    const rejected = buildRail([span('approval', 'denied', 0, 5, { approval_id: 'apr-1' })], 'require_approval', true);
    assert.equal(rejected.stages.find((s) => s.id === 'step_up')?.status, 'not_reached');
    assert.equal(withStepUp.stages.find((s) => s.id === 'step_up')?.status, 'not_reached');
    assert.equal(without.stages.find((s) => s.id === 'step_up')?.status, 'not_required');
    assert.equal(decidingStage(withStepUp)?.id, 'approval');
  });

  it('after a deny every later stage is not reached, skipped spans included; after an allow approval is not required (S1)', () => {
    const denied = buildRail(
      [
        span('information_tier', 'denied', 0, 1),
        span('ai_analysis', 'skipped', 1, 0),
        span('approval', 'skipped', 1, 0),
        span('decision', 'denied', 1, 1),
        span('audit', 'passed', 2, 1),
      ],
      'deny',
    );
    const st = Object.fromEntries(denied.stages.map((s) => [s.id, s.status]));
    assert.equal(st.ai_analysis, 'not_reached');
    assert.equal(st.approval, 'not_reached');
    assert.equal(st.step_up, 'not_reached');
    assert.equal(st.decision, 'denied');
    assert.equal(st.audit, 'passed');
    const allowed = buildRail([span('approval', 'skipped', 0, 0), span('step_up', 'skipped', 0, 0)], 'allow');
    assert.equal(allowed.stages.find((s) => s.id === 'approval')?.status, 'not_required');
    assert.equal(allowed.stages.find((s) => s.id === 'step_up')?.status, 'not_required');
  });

  it('preselects the tightened analysis when nothing denied or waits', () => {
    const rail = buildRail([span('ai_analysis', 'tightened', 0, 180), span('approval', 'passed', 180, 5)], 'require_approval');
    assert.equal(decidingStage(rail)?.id, 'ai_analysis');
  });

  it('formats durations at the right precision', () => {
    assert.equal(formatDuration(3.24), '3.2 ms');
    assert.equal(formatDuration(182), '182 ms');
    assert.equal(formatDuration(12_400), '12.4 s');
    assert.equal(formatDuration(0.04), '<0.1 ms');
  });
});

describe('decisions', () => {
  it('orders deny above step-up above approval above allow', () => {
    assert.ok(isStricter('deny', 'require_step_up'));
    assert.ok(isStricter('require_step_up', 'require_approval'));
    assert.ok(!isStricter('allow', 'require_approval'));
  });

  it('writes "<verdict> because <id> <name>: <reason>" from real Gateway data (M1)', () => {
    const catalog = (id: string) =>
      id === 'CTL-TIER-001'
        ? { name: 'Resource tier ceiling', description: 'An agent cannot touch a resource labelled above its session tier ceiling.' }
        : id === 'CTL-AI-001'
          ? { name: 'AI analysis only tightens', description: 'The analyzer can only tighten.' }
          : undefined;
    const analyzer = { verdict: 'skipped' as const, rationale: 'Deterministic deny is not negotiable', model_label: 'mock model (demo)' };
    // Live act 2 trace 9b0368c1: reasons carry only the policy id.
    const deny = { decision: 'deny' as const, approval_state: 'none' as const, ai_tightened: false, analyzer, control_ids: ['CTL-TIER-001'], policy_ids: ['forbid-resource-above-session-tier'], reasons: ['forbid-resource-above-session-tier'] };
    assert.equal(becauseSentence(deny, catalog), 'Denied because CTL-TIER-001 Resource tier ceiling: An agent cannot touch a resource labelled above its session tier ceiling.');
    // Live act 3 trace fa764a02: AI-tightened, the analyzer's finding is the reason.
    const tightened = {
      decision: 'require_approval' as const,
      approval_state: 'pending' as const,
      ai_tightened: true,
      analyzer: { verdict: 'suspicious' as const, rationale: 'Demo mock detected instructions embedded in untrusted action data; human review is required.', model_label: 'mock model (demo)' },
      control_ids: ['CTL-AI-001'],
      policy_ids: ['analyzer-suspicious', 'permit-effective-capability'],
      reasons: ['analyzer-suspicious', 'permit-effective-capability'],
    };
    assert.equal(
      becauseSentence(tightened, catalog),
      'Awaiting approval because CTL-AI-001 AI analysis only tightens: Demo mock detected instructions embedded in untrusted action data; human review is required.',
    );
    // A real sentence from the Gateway wins over the catalogue.
    assert.equal(
      becauseSentence({ ...deny, reasons: ['Resource restricted > session ceiling internal.'] }, catalog),
      'Denied because CTL-TIER-001 Resource tier ceiling: Resource restricted > session ceiling internal.',
    );
  });

  it('reads a resolved approval by its outcome', () => {
    assert.equal(resolutionOf({ decision: 'require_approval', approval_state: 'approved' }), 'approved');
    assert.equal(resolutionOf({ decision: 'require_step_up', approval_state: 'rejected' }), 'failed');
    assert.equal(outcomeTone({ decision: 'require_approval', approval_state: 'pending' }), 'approval');
    assert.equal(outcomeTone({ decision: 'require_approval', approval_state: 'approved' }), 'allow');
  });
});

describe('feed', () => {
  it('folds a burst within 2 s and breaks it at a gap or a different outcome', () => {
    const actions = [
      action({ at: 5_000 }),
      action({ at: 4_800 }),
      action({ at: 4_600 }),
      action({ at: 4_500, decision: 'deny' }),
      action({ at: 4_400, decision: 'deny' }),
      action({ at: 1_000 }),
    ];
    assert.deepEqual(
      groupBursts(actions).map((e) => [e.action.decision, e.count]),
      [
        ['allow', 3],
        ['deny', 2],
        ['allow', 1],
      ],
    );
  });

  it('never folds actions that wait for a human', () => {
    const pending = { decision: 'require_approval' as const, approval_state: 'pending' as const };
    assert.equal(groupBursts([action({ at: 2, ...pending }), action({ at: 1, ...pending })]).length, 2);
  });

  it('counts the 15-minute window and everything awaiting a human', () => {
    const now = t0 + 20 * 60_000;
    const kpis = computeKpis(
      [],
      [
        action({ at: 19 * 60_000, decision: 'deny' }),
        action({ at: 18 * 60_000, ai_tightened: true, decision: 'require_approval', approval_state: 'pending' }),
        action({ at: 1 * 60_000, decision: 'require_approval', approval_state: 'pending' }),
      ],
      now,
    );
    assert.equal(kpis.actions15m, 2);
    assert.equal(kpis.denied15m, 1);
    assert.equal(kpis.tightened15m, 1);
    assert.equal(kpis.awaitingHuman, 2);
  });

  it('keeps the last n decisions per agent, oldest first', () => {
    const list = recentByAgent([action({ at: 3 }), action({ at: 2 }), action({ at: 1 })], 2).get('report-bot')!;
    assert.deepEqual(
      list.map((a) => a.occurred_at),
      [new Date(t0 + 2).toISOString(), new Date(t0 + 3).toISOString()],
    );
  });
});

describe('graph edge style', () => {
  const latest = (over: Partial<EdgeLatest>): EdgeLatest => ({
    trace_id: 't',
    decision: 'allow',
    approval_state: 'none',
    ai_tightened: false,
    control_ids: [],
    at: '2026-10-03T19:00:00.000Z',
    ...over,
  });

  it('keeps an AI-tightened edge dashed while a human is pending, solid once resolved (p-248)', () => {
    const pending = edgeStyle({ kind: 'action', breaker: false, latest: latest({ decision: 'require_approval', approval_state: 'pending', ai_tightened: true }) }, 'active');
    const resolved = edgeStyle({ kind: 'action', breaker: false, latest: latest({ decision: 'require_approval', approval_state: 'approved', ai_tightened: true }) }, 'active');
    assert.equal(pending.dash, '4 4');
    assert.match(pending.stroke, /ai-tightened/);
    assert.equal(resolved.dash, undefined);
  });

  it('draws a breaker message edge red and dashed, and session edges neutral', () => {
    const breaker = edgeStyle({ kind: 'message', breaker: true, latest: latest({ decision: 'deny', control_ids: ['CTL-ID-002'] }) }, 'quarantined');
    assert.match(breaker.stroke, /deny/);
    assert.equal(breaker.dash, '4 4');
    assert.match(edgeStyle({ kind: 'session', breaker: false, latest: latest({ decision: 'deny' }) }, 'active').stroke, /border-strong/);
  });
});

describe('callers', () => {
  it('never treats an unknown or system caller as a human (p-417, p-420)', () => {
    assert.deepEqual(callerOf(undefined), { kind: 'unauthenticated', id: 'unknown', name: 'Unauthenticated' });
    assert.equal(callerOf({ sub: 'unknown', display_name: 'Unknown' }).kind, 'unauthenticated');
    assert.equal(callerLabel(callerOf({ sub: 'system', display_name: 'Gateway observer' })), 'Gateway (system)');
    assert.equal(callerLabel(callerOf({ sub: 'u-1', display_name: 'Maya Chen' })), 'Maya Chen');
  });
});
