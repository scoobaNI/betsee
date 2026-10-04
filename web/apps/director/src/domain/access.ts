import type { ActionSummary, Tier, UseCaseRef } from '@betsee/api';
import { isObservation } from './decision.ts';

// The proposed access contract (POST /api/v1/access/changes, GET /api/v1/access). The Gateway has no
// write API for delegations or people yet; the mock world implements exactly these shapes.

export type AccessChangeRequest =
  | { kind: 'delegation'; agent_id: string; capability: string; granted: boolean }
  | { kind: 'agent_state'; agent_id: string; state: 'active' | 'suspended' }
  | { kind: 'person_desk'; sub: string; enabled: boolean }
  | { kind: 'person_tier'; sub: string; tier_ceiling: Tier };

export interface AccessChange {
  id: string;
  at: string;
  actor: { sub: string; display_name: string };
  request: AccessChangeRequest;
  subject: string;
  before: string;
  after: string;
  reason: string;
  suggestion_id: string | null;
}

export interface AgentAccess {
  agent_id: string;
  use_case: UseCaseRef;
  permitted: string[];
  approval_required: string[];
  step_up_required: string[];
  delegated: string[];
  effective: string[];
  tier_ceiling: Tier;
  state: 'active' | 'quarantined' | 'suspended';
}

export interface PersonAccess {
  sub: string;
  display_name: string;
  /** May start Betsee Desk chats; null when the Gateway does not expose it. */
  desk: boolean | null;
  /** Caps every session this person starts; null when the Gateway does not expose it. */
  tier_ceiling: Tier | null;
}

export interface AccessSnapshot {
  agents: AgentAccess[];
  people: PersonAccess[];
  changes: AccessChange[];
}

export const TIERS: Tier[] = ['public', 'internal', 'confidential', 'restricted'];
const tierRank = (tier: Tier) => TIERS.indexOf(tier);

/* Staging: changes the director picks before applying them in one batch. */

export type Staged = ReadonlyMap<string, AccessChangeRequest>;

export function changeKey(r: AccessChangeRequest): string {
  switch (r.kind) {
    case 'delegation':
      return `delegation:${r.agent_id}:${r.capability}`;
    case 'agent_state':
      return `state:${r.agent_id}`;
    case 'person_desk':
      return `desk:${r.sub}`;
    case 'person_tier':
      return `tier:${r.sub}`;
  }
}

/** Whether a request would change nothing, given the snapshot. */
export function isNoop(snapshot: AccessSnapshot, r: AccessChangeRequest): boolean {
  switch (r.kind) {
    case 'delegation': {
      const agent = snapshot.agents.find((a) => a.agent_id === r.agent_id);
      return Boolean(agent) && agent!.delegated.includes(r.capability) === r.granted;
    }
    case 'agent_state': {
      const agent = snapshot.agents.find((a) => a.agent_id === r.agent_id);
      return agent?.state === r.state;
    }
    case 'person_desk':
      return snapshot.people.find((p) => p.sub === r.sub)?.desk === r.enabled;
    case 'person_tier':
      return snapshot.people.find((p) => p.sub === r.sub)?.tier_ceiling === r.tier_ceiling;
  }
}

/** Stages a request, or unstages it when it would bring the subject back to how it is now. */
export function stage(snapshot: AccessSnapshot, staged: Staged, r: AccessChangeRequest): Map<string, AccessChangeRequest> {
  const next = new Map(staged);
  if (isNoop(snapshot, r)) next.delete(changeKey(r));
  else next.set(changeKey(r), r);
  return next;
}

/** The snapshot as it will be once the staged changes apply, for drawing the preview. */
export function preview(snapshot: AccessSnapshot, staged: Staged): AccessSnapshot {
  if (!staged.size) return snapshot;
  const agents = snapshot.agents.map((a) => ({ ...a, delegated: [...a.delegated] }));
  const people = snapshot.people.map((p) => ({ ...p }));
  for (const r of staged.values()) {
    if (r.kind === 'delegation') {
      const agent = agents.find((a) => a.agent_id === r.agent_id);
      if (!agent) continue;
      agent.delegated = r.granted ? [...new Set([...agent.delegated, r.capability])] : agent.delegated.filter((c) => c !== r.capability);
      agent.effective = agent.delegated.filter((c) => agent.permitted.includes(c));
    } else if (r.kind === 'agent_state') {
      const agent = agents.find((a) => a.agent_id === r.agent_id);
      if (agent) agent.state = r.state;
    } else if (r.kind === 'person_desk') {
      const person = people.find((p) => p.sub === r.sub);
      if (person) person.desk = r.enabled;
    } else {
      const person = people.find((p) => p.sub === r.sub);
      if (person) person.tier_ceiling = r.tier_ceiling;
    }
  }
  return { ...snapshot, agents, people };
}

/** One staged change in words, with its direction: + grants, - takes away, ~ adjusts. */
export function describe(r: AccessChangeRequest, nameOf: (sub: string) => string = (s) => s): { sign: '+' | '-' | '~'; text: string } {
  switch (r.kind) {
    case 'delegation':
      return r.granted ? { sign: '+', text: `Grant ${r.capability} to ${r.agent_id}` } : { sign: '-', text: `Revoke ${r.capability} from ${r.agent_id}` };
    case 'agent_state':
      return r.state === 'suspended' ? { sign: '-', text: `Suspend ${r.agent_id}` } : { sign: '+', text: `Resume ${r.agent_id}` };
    case 'person_desk':
      return r.enabled ? { sign: '+', text: `Turn Betsee Desk on for ${nameOf(r.sub)}` } : { sign: '-', text: `Turn Betsee Desk off for ${nameOf(r.sub)}` };
    case 'person_tier':
      return { sign: '~', text: `Set ${nameOf(r.sub)}'s tier ceiling to ${r.tier_ceiling}` };
  }
}

/* Suggestions: what the evidence in the feed says about tightening access. */

export type Severity = 'critical' | 'elevated' | 'hygiene';

export interface Suggestion {
  /** Stable across refreshes, so a dismissal sticks. */
  id: string;
  severity: Severity;
  /** 0 to 100: how strongly the evidence points at this change. */
  score: number;
  title: string;
  subject: { kind: 'agent' | 'person'; id: string; name: string };
  evidence: string[];
  /** Part of the evidence is AI analysis flagging a request (the pink signal everywhere else). */
  ai: boolean;
  changes: AccessChangeRequest[];
  traceIds: string[];
}

const CHAT_USE_CASE = 'employee-assistance';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const finding = (a: ActionSummary) =>
  (a.analyzer as { finding?: string }).finding || a.analyzer.rationale || (typeof a.reasons[0] === 'string' ? a.reasons[0] : '');

/**
 * Turns the last hour of decisions into access suggestions. Agents: requests AI analysis flagged
 * point at revoking the capability, and flagged malicious ones at suspending the agent; delegated
 * capabilities a busy agent never used point at revoking them (least privilege). People: what they
 * ask the assistant in Betsee Desk is their own doing, so chats flagged by AI analysis or reaching
 * above their tier point at lowering their tier ceiling or turning Desk off.
 */
export function suggestAccess(snapshot: AccessSnapshot, actions: readonly ActionSummary[], now: number, windowMs = 60 * 60_000): Suggestion[] {
  const recent = actions.filter((a) => !isObservation(a) && now - Date.parse(a.occurred_at) <= windowMs);
  const out: Suggestion[] = [];

  for (const agent of snapshot.agents) {
    if (agent.state !== 'active' || agent.use_case.id === CHAT_USE_CASE) continue;
    const mine = recent.filter((a) => a.agent.id === agent.agent_id);
    const flagged = mine.filter((a) => a.ai_tightened);
    const malicious = flagged.filter((a) => a.analyzer.verdict === 'malicious');
    if (malicious.length && flagged.length >= 2) {
      out.push({
        id: `suspend:${agent.agent_id}`,
        severity: 'critical',
        score: Math.min(100, 60 + flagged.length * 8 + malicious.length * 6),
        title: `Suspend ${agent.agent_id}`,
        subject: { kind: 'agent', id: agent.agent_id, name: agent.agent_id },
        evidence: [
          `${plural(flagged.length, 'request')} flagged by AI analysis in the last hour, ${malicious.length} as malicious.`,
          finding(malicious[0]!),
        ].filter(Boolean),
        ai: true,
        changes: [{ kind: 'agent_state', agent_id: agent.agent_id, state: 'suspended' }],
        traceIds: flagged.map((a) => a.trace_id),
      });
      continue;
    }
    if (flagged.length) {
      const byCapability = new Map<string, ActionSummary[]>();
      for (const a of flagged) byCapability.set(a.capability, [...(byCapability.get(a.capability) ?? []), a]);
      const [capability, hits] = [...byCapability].sort((a, b) => b[1].length - a[1].length)[0]!;
      if (agent.delegated.includes(capability) && (hits.length >= 2 || hits.some((a) => a.analyzer.verdict === 'malicious'))) {
        out.push({
          id: `revoke:${agent.agent_id}:${capability}`,
          severity: 'elevated',
          score: Math.min(90, 35 + hits.length * 10),
          title: `Revoke ${capability} from ${agent.agent_id}`,
          subject: { kind: 'agent', id: agent.agent_id, name: agent.agent_id },
          evidence: [`AI analysis flagged ${plural(hits.length, `${capability} request`)} in the last hour.`, finding(hits[0]!)].filter(Boolean),
          ai: true,
          changes: [{ kind: 'delegation', agent_id: agent.agent_id, capability, granted: false }],
          traceIds: hits.map((a) => a.trace_id),
        });
      }
    }
    if (mine.length >= 10) {
      const used = new Set(mine.map((a) => a.capability));
      for (const capability of agent.effective.filter((c) => !used.has(c))) {
        out.push({
          id: `unused:${agent.agent_id}:${capability}`,
          severity: 'hygiene',
          score: 20,
          title: `Revoke unused ${capability} from ${agent.agent_id}`,
          subject: { kind: 'agent', id: agent.agent_id, name: agent.agent_id },
          evidence: [`Delegated, but not used once in ${plural(mine.length, 'request')} this hour. Least privilege: take it back until it is needed.`],
          ai: false,
          changes: [{ kind: 'delegation', agent_id: agent.agent_id, capability, granted: false }],
          traceIds: [],
        });
      }
    }
  }

  const chatAgents = new Set(snapshot.agents.filter((a) => a.use_case.id === CHAT_USE_CASE).map((a) => a.agent_id));
  for (const person of snapshot.people) {
    const chats = recent.filter((a) => chatAgents.has(a.agent.id) && a.human?.sub === person.sub);
    const flagged = chats.filter((a) => a.ai_tightened);
    const aboveTier = chats.filter((a) => a.control_ids.includes('CTL-TIER-001'));
    if (flagged.length >= 2 && person.desk !== false) {
      out.push({
        id: `desk:${person.sub}`,
        severity: 'critical',
        score: Math.min(100, 55 + flagged.length * 10 + aboveTier.length * 4),
        title: `Turn Betsee Desk off for ${person.display_name}`,
        subject: { kind: 'person', id: person.sub, name: person.display_name },
        evidence: [`AI analysis flagged ${plural(flagged.length, 'thing')} ${person.display_name} asked the assistant this hour.`, finding(flagged[0]!)].filter(Boolean),
        ai: true,
        changes: [{ kind: 'person_desk', sub: person.sub, enabled: false }],
        traceIds: flagged.map((a) => a.trace_id),
      });
      continue;
    }
    const current = person.tier_ceiling;
    if (!current || current === 'public' || (flagged.length === 0 && aboveTier.length < 2)) continue;
    const lower = TIERS[tierRank(current) - 1]!;
    out.push({
      id: `tier:${person.sub}:${lower}`,
      severity: 'elevated',
      score: Math.min(85, 30 + flagged.length * 15 + aboveTier.length * 8),
      title: `Lower ${person.display_name}'s tier ceiling to ${lower}`,
      subject: { kind: 'person', id: person.sub, name: person.display_name },
      evidence: [
        aboveTier.length ? `${plural(aboveTier.length, 'chat request')} reached above their session tier this hour.` : '',
        flagged.length ? `AI analysis flagged ${plural(flagged.length, 'chat request')}: ${finding(flagged[0]!)}` : '',
      ].filter(Boolean),
      ai: flagged.length > 0,
      changes: [{ kind: 'person_tier', sub: person.sub, tier_ceiling: lower }],
      traceIds: [...flagged, ...aboveTier].map((a) => a.trace_id),
    });
  }

  const hygiene = out.filter((s) => s.severity === 'hygiene').slice(0, 3);
  return [...out.filter((s) => s.severity !== 'hygiene'), ...hygiene]
    .filter((s) => !s.changes.every((c) => isNoop(snapshot, c)))
    .sort((a, b) => b.score - a.score);
}
