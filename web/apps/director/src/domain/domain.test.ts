import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActionSummary, AgentSession, Span } from '@betsee/api';
import { atLeastMedium, becauseSentence, isObservation, isStricter, isVoided, outcomeTone, resolutionOf, withApprovalState } from './decision.ts';
import { computeKpis, groupBursts, recentByAgent } from './feed.ts';
import { callerLabel, callerOf } from './caller.ts';
import { chatAgentIds, chatsByPerson, principalIds } from './chats.ts';
import { capabilityRules, delegationOf } from './configuration.ts';
import { describe as describeChange, preview, stage, suggestAccess, type AccessSnapshot } from './access.ts';
import { edgeStyle, type EdgeLatest } from './graph-style.ts';
import { buildRail, decidingStage, formatDuration } from './pipeline.ts';
import { determinismStats, repeatGroups } from './determinism.ts';
import { bucketize, niceCeiling, pendingSeries, percentile, rankBy } from './series.ts';

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
    assert.match(pending.stroke, /--color-ai\b/);
    assert.equal(resolved.dash, undefined);
  });

  it('draws a breaker message edge red and dashed, and session edges neutral', () => {
    const breaker = edgeStyle({ kind: 'message', breaker: true, latest: latest({ decision: 'deny', control_ids: ['CTL-ID-002'] }) }, 'quarantined');
    assert.match(breaker.stroke, /--color-bad\b/);
    assert.equal(breaker.dash, '4 4');
    assert.match(edgeStyle({ kind: 'session', breaker: false, latest: latest({ decision: 'deny' }) }, 'active').stroke, /--color-line-strong\b/);
  });
});

describe('callers', () => {
  it('never treats an unknown or system caller as a human (p-417, p-420)', () => {
    assert.deepEqual(callerOf(undefined), { kind: 'unauthenticated', id: 'unknown', name: 'Unauthenticated' });
    assert.equal(callerOf({ sub: 'unknown', display_name: 'Unknown' }).kind, 'unauthenticated');
    assert.equal(callerLabel(callerOf({ sub: 'system', display_name: 'Gateway observer' })), 'Gateway (system)');
    assert.equal(callerLabel(callerOf({ sub: 'u-1', display_name: 'Maya Chen' })), 'Maya Chen');
    // Live data: the observer reports under the sub of the human whose action it observed.
    assert.equal(callerOf({ sub: '00000000-0000-4000-8000-000000000002', display_name: 'Gateway security observer' }, 'gateway').kind, 'gateway');
    assert.equal(callerOf({ sub: 'u-1', display_name: 'Maya Chen' }, 'gateway').kind, 'gateway');
  });
});

describe('fix window (FAIL-1, FAIL-3, D22)', () => {
  it('takes the approval state from the record over a stale trace, but keeps voided', () => {
    const records = new Map([['t-1', 'rejected']]);
    assert.equal(withApprovalState({ trace_id: 't-1', approval_state: 'pending' as const }, records).approval_state, 'rejected');
    assert.equal(withApprovalState({ trace_id: 't-2', approval_state: 'pending' as const }, records).approval_state, 'pending');
    const voided = { trace_id: 't-1', approval_state: 'voided' as unknown as 'pending' };
    assert.ok(isVoided(withApprovalState(voided, records)));
    assert.equal(resolutionOf({ decision: 'require_approval', approval_state: 'voided' as unknown as 'pending' }), 'rejected');
  });

  it('recognises Gateway observations and medium-or-higher severities', () => {
    assert.ok(isObservation({ capability: 'security.observe', agent: { id: 'gateway', name: 'g', team: 'platform' } }));
    assert.ok(isObservation({ capability: 'tool.inspect', agent: { id: 'system', name: 's', team: 'platform' } }));
    assert.ok(!isObservation({ record_type: 'action', capability: 'security.observe', agent: { id: 'gateway', name: 'g', team: 'p' } } as never));
    assert.ok(!isObservation({ capability: 'crm.read', agent: { id: 'invoice-assistant', name: 'i', team: 'finance' }, human: { sub: 'u-1' } }));
    assert.ok(atLeastMedium('high'));
    assert.ok(!atLeastMedium('low'));
    assert.ok(!atLeastMedium(undefined));
  });
});

describe('determinism', () => {
  it('counts tightening, never counts a human approval as AI loosening, and catches a real loosening', () => {
    const stats = determinismStats([
      action({ at: 1 }),
      action({ at: 2, deterministic_decision: 'allow', decision: 'deny', ai_tightened: true }),
      action({ at: 3, deterministic_decision: 'require_approval', decision: 'allow', approval_state: 'approved' }),
      action({ at: 4, deterministic_decision: 'deny', decision: 'deny', analyzer: { verdict: 'skipped', rationale: '', model_label: 'm' } }),
      action({ at: 5, capability: 'security.observe', agent: { id: 'gateway', name: 'g', team: 'platform' } }),
    ]);
    assert.equal(stats.total, 4);
    assert.equal(stats.tightened, 1);
    assert.equal(stats.loosened, 0);
    assert.equal(stats.resolvedByPerson, 1);
    assert.equal(stats.analyzed, 3);
    assert.equal(stats.deterministic.require_approval, 1);
    assert.equal(stats.final.deny, 2);
    assert.equal(determinismStats([action({ at: 1, deterministic_decision: 'deny', decision: 'allow' })]).loosened, 1);
  });

  it('groups identical requests and names the controls behind a changed answer', () => {
    const groups = repeatGroups([
      action({ at: 3, deterministic_decision: 'deny', control_ids: ['CTL-RUN-003'] }),
      action({ at: 2 }),
      action({ at: 1 }),
      action({ at: 0, resource: { type: 'customer', id: 'C-2', tier: 'internal' } }),
      action({ at: 5, capability: 'files.read' }),
      action({ at: 4, capability: 'files.read' }),
    ]);
    assert.equal(groups.length, 2);
    const [changed, same] = groups;
    assert.equal(changed!.consistent, false);
    assert.deepEqual(changed!.changedBy, ['CTL-RUN-003']);
    assert.deepEqual(changed!.decisions.map((d) => d.decision), ['allow', 'allow', 'deny']);
    assert.equal(same!.consistent, true);
  });
});

describe('series', () => {
  it('buckets decided actions by time and outcome, oldest first, without observations', () => {
    const now = t0 + 59_999;
    const buckets = bucketize(
      [
        action({ at: 5_000 }),
        action({ at: 6_000, decision: 'deny', latency_ms: 9 }),
        action({ at: 59_000, decision: 'require_approval', approval_state: 'pending' }),
        action({ at: -1_000 }),
        action({ at: 30_000, capability: 'security.observe', agent: { id: 'gateway', name: 'g', team: 'platform' } }),
      ],
      now,
      60_000,
      6,
    );
    assert.equal(buckets.length, 6);
    assert.equal(buckets[0]!.total, 2);
    assert.equal(buckets[0]!.deny, 1);
    assert.deepEqual(buckets[0]!.latencies, [1, 9]);
    assert.equal(buckets[5]!.approval, 1);
    assert.equal(buckets.reduce((sum, b) => sum + b.total, 0), 3);
  });

  it('reconstructs how many approvals were waiting at the end of each bucket', () => {
    const iso = (ms: number) => new Date(t0 + ms).toISOString();
    const series = pendingSeries(
      [
        { created_at: iso(5_000), decided_at: iso(25_000) },
        { created_at: iso(15_000), decided_at: null },
      ],
      t0 + 29_999,
      30_000,
      3,
    );
    assert.deepEqual(series, [1, 2, 1]);
  });

  it('keeps bucket edges on whole multiples of the bucket size as time moves', () => {
    const a = bucketize([], t0 + 61_234, 60_000, 6).map((b) => b.start);
    const b = bucketize([], t0 + 64_321, 60_000, 6).map((b) => b.start);
    assert.deepEqual(a, b);
    assert.equal(a[0]! % 10_000, 0);
    assert.ok(a.at(-1)! <= t0 + 61_234 && t0 + 61_234 < a.at(-1)! + 10_000);
  });

  it('takes nearest-rank percentiles, ranks keys, and rounds axis tops', () => {
    assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
    assert.equal(percentile([5, 1, 3, 2, 4], 95), 5);
    assert.equal(percentile([], 50), 0);
    const ranked = rankBy([action({ at: 1 }), action({ at: 2 }), action({ at: 3, capability: 'files.read', decision: 'deny' })], (a) => a.capability, 5);
    assert.deepEqual(ranked.map((r) => [r.key, r.total, r.byOutcome.deny]), [['crm.read', 2, 0], ['files.read', 1, 1]]);
    assert.deepEqual([niceCeiling(0), niceCeiling(3), niceCeiling(7), niceCeiling(42), niceCeiling(100)], [1, 5, 10, 50, 100]);
  });
});

const chat = (id: string, name: string, status: AgentSession['status'], started: string, useCase = 'employee-assistance'): AgentSession => ({
  id,
  human: { sub: `u-${id}`, display_name: name },
  agent_id: useCase === 'employee-assistance' ? 'employee-assistant' : 'invoice-assistant',
  use_case: { id: useCase, name: useCase },
  delegated: [],
  effective: [],
  tier_ceiling: 'internal',
  budget: { limit: 0, used: 0, unit: 'cents' },
  approval_state: 'none',
  status,
  started_at: started,
  expires_at: started,
});

describe('chat sessions', () => {
  const sessions = [
    chat('c3', 'Maya Chen', 'active', '2026-10-04T10:05:00Z'),
    chat('c1', 'Maya Chen', 'active', '2026-10-04T10:01:00Z'),
    chat('c2', 'Maya Chen', 'closed', '2026-10-04T09:00:00Z'),
    chat('c4', 'Maya Chen', 'revoked', '2026-10-04T09:30:00Z'),
    chat('c5', 'Someone Unknown', 'active', '2026-10-04T10:00:00Z'),
    chat('s1', 'Priya Raman', 'active', '2026-10-04T08:00:00Z', 'deployment-helper'),
  ];

  it('groups chats by person: live oldest first, ended newest first, other use cases and strangers left out', () => {
    const byPerson = chatsByPerson(sessions);
    assert.deepEqual([...byPerson.keys()], ['maya-chen']);
    assert.deepEqual(byPerson.get('maya-chen')!.live.map((s) => s.id), ['c1', 'c3']);
    assert.deepEqual(byPerson.get('maya-chen')!.ended.map((s) => s.id), ['c4', 'c2']);
  });

  it('names the agents that serve chats', () => {
    assert.deepEqual([...chatAgentIds(sessions)], ['employee-assistant']);
  });

  it('derives principals from sessions, actions and agents, matched to the directory', () => {
    const ids = principalIds(
      [chat('c1', 'Maya Chen', 'closed', '2026-10-04T10:00:00Z')],
      [{ human: { sub: 'u', display_name: 'daniel ortiz' } }, { human: undefined }],
      [{ current_session: chat('x', 'Noah Schmidt', 'active', '2026-10-04T10:00:00Z') }, { current_session: null }],
    );
    assert.deepEqual([...ids].sort(), ['daniel-ortiz', 'maya-chen', 'noah-schmidt']);
  });
});

describe('configuration', () => {
  it('lists a use case\'s capabilities with their approval and step-up checks, in order', () => {
    const rules = capabilityRules({ permitted: ['crm.read', 'payments.transfer'], approval_required: ['payments.transfer'], step_up_required: ['payments.transfer'] });
    assert.deepEqual(rules, [
      { capability: 'crm.read', approval: false, stepUp: false },
      { capability: 'payments.transfer', approval: true, stepUp: true },
    ]);
  });

  it('splits a delegation into effective and blocked by the use case', () => {
    assert.deepEqual(delegationOf({ delegated: ['crm.read', 'email.send', 'files.read'], effective: ['files.read', 'crm.read'] }), {
      effective: ['crm.read', 'files.read'],
      blocked: ['email.send'],
    });
  });
});

describe('access', () => {
  const snapshot = (): AccessSnapshot => ({
    agents: [
      {
        agent_id: 'support-triage',
        use_case: { id: 'ticket-triage', name: 'Ticket triage' },
        permitted: ['tickets.read', 'memory.write', 'crm.read'],
        approval_required: [],
        step_up_required: [],
        delegated: ['tickets.read', 'memory.write', 'crm.read'],
        effective: ['tickets.read', 'memory.write', 'crm.read'],
        tier_ceiling: 'internal',
        state: 'active',
      },
      {
        agent_id: 'employee-assistant',
        use_case: { id: 'employee-assistance', name: 'Employee assistance' },
        permitted: ['crm.read'],
        approval_required: [],
        step_up_required: [],
        delegated: ['crm.read'],
        effective: ['crm.read'],
        tier_ceiling: 'internal',
        state: 'active',
      },
    ],
    people: [{ sub: 'u-maya', display_name: 'Maya Chen', desk: true, tier_ceiling: 'confidential' }],
    changes: [],
  });
  const now = t0 + 30 * 60_000;
  const triage = (over: Partial<ActionSummary> & { at: number }) => action({ agent: { id: 'support-triage', name: 'support-triage', team: 'Support' }, capability: 'tickets.read', ...over });
  const flagged = (verdict: 'suspicious' | 'malicious', at: number, capability = 'memory.write') =>
    triage({ at, capability, ai_tightened: true, decision: 'deny', analyzer: { verdict, rationale: 'Instructions inside data.', model_label: 'm' } });

  it('stages a change, and unstages it when it would bring things back to how they are', () => {
    const s0 = snapshot();
    const revoke = { kind: 'delegation' as const, agent_id: 'support-triage', capability: 'crm.read', granted: false };
    const staged = stage(s0, new Map(), revoke);
    assert.equal(staged.size, 1);
    assert.ok(!preview(s0, staged).agents[0]!.effective.includes('crm.read'));
    assert.equal(stage(s0, staged, { ...revoke, granted: true }).size, 0);
    assert.equal(stage(s0, new Map(), { kind: 'person_desk', sub: 'u-maya', enabled: true }).size, 0);
    assert.deepEqual(describeChange(revoke), { sign: '-', text: 'Revoke crm.read from support-triage' });
  });

  it('suggests suspending an agent AI analysis flagged as malicious, and revoking a capability it flagged twice', () => {
    const suspend = suggestAccess(snapshot(), [flagged('suspicious', 1_000), flagged('malicious', 2_000)], now);
    assert.equal(suspend[0]!.id, 'suspend:support-triage');
    assert.equal(suspend[0]!.severity, 'critical');
    assert.ok(suspend[0]!.ai);
    const revoke = suggestAccess(snapshot(), [flagged('suspicious', 1_000), flagged('suspicious', 2_000)], now);
    assert.deepEqual(revoke[0]!.changes, [{ kind: 'delegation', agent_id: 'support-triage', capability: 'memory.write', granted: false }]);
  });

  it('suggests revoking a delegated capability a busy agent never used, and ignores old evidence', () => {
    const busy = Array.from({ length: 10 }, (_, i) => triage({ at: i * 1_000, capability: i % 2 ? 'tickets.read' : 'memory.write' }));
    const ids = suggestAccess(snapshot(), busy, now).map((s) => s.id);
    assert.deepEqual(ids, ['unused:support-triage:crm.read']);
    assert.deepEqual(suggestAccess(snapshot(), [flagged('malicious', 0), flagged('malicious', 1)], now + 2 * 60 * 60_000), []);
  });

  it('suggests Desk off for a person whose chats AI analysis flagged twice, a lower tier for one flag', () => {
    const chat = (at: number, over: Partial<ActionSummary> = {}) =>
      action({ at, agent: { id: 'employee-assistant', name: 'employee-assistant', team: 'Workplace' }, human: { sub: 'u-maya', display_name: 'Maya Chen' }, ...over });
    const ai = { ai_tightened: true, decision: 'deny' as const, analyzer: { verdict: 'malicious' as const, rationale: 'Asked to export every customer.', model_label: 'm' } };
    const twice = suggestAccess(snapshot(), [chat(1_000, ai), chat(2_000, ai)], now);
    assert.deepEqual(twice.map((s) => s.id), ['desk:u-maya']);
    const once = suggestAccess(snapshot(), [chat(1_000, ai)], now);
    assert.deepEqual(once[0]!.changes, [{ kind: 'person_tier', sub: 'u-maya', tier_ceiling: 'internal' }]);
    const off = snapshot();
    off.people[0]!.desk = false;
    assert.ok(suggestAccess(off, [chat(1_000, ai), chat(2_000, ai)], now).every((s) => s.id !== 'desk:u-maya'));
  });
});
