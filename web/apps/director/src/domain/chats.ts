import type { ActionSummary, Agent, AgentSession } from '@betsee/api';
import { personByName } from './people.ts';

/** Betsee Desk chats run as sessions of this use case (POST /api/v1/chat/sessions in the contract). */
export const CHAT_USE_CASE = 'employee-assistance';

export const isChatSession = (session: Pick<AgentSession, 'use_case'>) => session.use_case.id === CHAT_USE_CASE;

export interface PersonChats {
  /** Open chats, oldest first so a chip keeps its place while newer ones join below it. */
  live: AgentSession[];
  /** Closed or revoked chats, newest first. */
  ended: AgentSession[];
}

/** Chat sessions grouped by the directory person who started them; unknown people are left out. */
export function chatsByPerson(sessions: readonly AgentSession[]): Map<string, PersonChats> {
  const out = new Map<string, PersonChats>();
  for (const session of sessions) {
    if (!isChatSession(session)) continue;
    const person = personByName(session.human.display_name);
    if (!person) continue;
    const entry = out.get(person.id) ?? { live: [], ended: [] };
    (session.status === 'active' ? entry.live : entry.ended).push(session);
    out.set(person.id, entry);
  }
  for (const entry of out.values()) {
    entry.live.sort((a, b) => a.started_at.localeCompare(b.started_at));
    entry.ended.sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
  return out;
}

/** Agents that serve chats: drawn per chat session beside its person, never as one fixed chip. */
export function chatAgentIds(sessions: readonly AgentSession[]): Set<string> {
  return new Set(sessions.filter(isChatSession).map((s) => s.agent_id));
}

/**
 * The directory people the Gateway knows as principals: anyone who is the human of a session, of a
 * decided action, or of an agent's current session. Derived from data, so a newly seeded person
 * shows as a principal without a code change.
 */
export function principalIds(
  sessions: readonly Pick<AgentSession, 'human'>[],
  actions: readonly Pick<ActionSummary, 'human'>[],
  agents: readonly Pick<Agent, 'current_session'>[],
): Set<string> {
  const names = new Set<string>();
  for (const s of sessions) names.add(s.human.display_name);
  for (const a of actions) if (a.human) names.add(a.human.display_name);
  for (const a of agents) if (a.current_session) names.add(a.current_session.human.display_name);
  const out = new Set<string>();
  for (const name of names) {
    const person = personByName(name);
    if (person) out.add(person.id);
  }
  return out;
}
