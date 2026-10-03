import type { ActionSummary, Agent } from '@betsee/api';
import { isAwaitingHuman } from './decision.ts';

export interface FeedEntry {
  action: ActionSummary;
  /** Identical actions folded into this row, the row's own action included. */
  count: number;
  traceIds: string[];
}

const BURST_WINDOW_MS = 2_000;

const burstKey = (a: ActionSummary) => `${a.agent.id}|${a.capability}|${a.decision}|${a.approval_state}|${a.ai_tightened}`;

/**
 * Collapses bursts: consecutive actions (newest first) with the same agent, capability and outcome
 * within 2 s of each other become one row with a count (act 6). Actions still waiting for a human
 * never fold, because each one resolves on its own.
 */
export function groupBursts(actions: readonly ActionSummary[]): FeedEntry[] {
  const entries: FeedEntry[] = [];
  let previousAt = Number.POSITIVE_INFINITY;
  for (const action of actions) {
    const at = Date.parse(action.occurred_at);
    const last = entries.at(-1);
    if (
      last &&
      !isAwaitingHuman(action) &&
      burstKey(last.action) === burstKey(action) &&
      previousAt - at <= BURST_WINDOW_MS
    ) {
      last.count++;
      last.traceIds.push(action.trace_id);
    } else {
      entries.push({ action, count: 1, traceIds: [action.trace_id] });
    }
    previousAt = at;
  }
  return entries;
}

export interface Kpis {
  agentsActive: number;
  agentsQuarantined: number;
  agentsSuspended: number;
  actions15m: number;
  denied15m: number;
  awaitingHuman: number;
  tightened15m: number;
}

const WINDOW_MS = 15 * 60_000;

export function computeKpis(agents: readonly Agent[], actions: readonly ActionSummary[], now = Date.now()): Kpis {
  const recent = actions.filter((a) => now - Date.parse(a.occurred_at) <= WINDOW_MS);
  return {
    agentsActive: agents.filter((a) => a.state === 'active').length,
    agentsQuarantined: agents.filter((a) => a.state === 'quarantined').length,
    agentsSuspended: agents.filter((a) => a.state === 'suspended').length,
    actions15m: recent.length,
    denied15m: recent.filter((a) => a.decision === 'deny').length,
    awaitingHuman: actions.filter(isAwaitingHuman).length,
    tightened15m: recent.filter((a) => a.ai_tightened).length,
  };
}

/** The last n decisions per agent, oldest first, for the tile's tick strip. */
export function recentByAgent(actions: readonly ActionSummary[], n = 12): Map<string, ActionSummary[]> {
  const out = new Map<string, ActionSummary[]>();
  for (const action of actions) {
    const list = out.get(action.agent.id) ?? [];
    if (list.length < n) list.push(action);
    out.set(action.agent.id, list);
  }
  for (const list of out.values()) list.reverse();
  return out;
}

export const TEAM_ORDER = ['finance', 'support', 'strategy', 'platform'];

/** The Gateway sends team ids ("finance"); the UI shows them as names. */
export const teamName = (team: string) => (team ? `${team[0]!.toUpperCase()}${team.slice(1)}` : team);

export function groupByTeam(agents: readonly Agent[]): [string, Agent[]][] {
  const byTeam = new Map<string, Agent[]>();
  for (const agent of agents) byTeam.set(agent.team, [...(byTeam.get(agent.team) ?? []), agent]);
  const rank = (team: string) => {
    const i = TEAM_ORDER.indexOf(team.toLowerCase());
    return i === -1 ? TEAM_ORDER.length : i;
  };
  return [...byTeam]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([team, list]) => [team, list.sort((x, y) => x.id.localeCompare(y.id))]);
}
