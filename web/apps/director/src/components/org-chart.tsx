import { subscribeToEvents, type ActionSummary, type Agent, type AgentSession } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { chatAgentIds, chatsByPerson, isChatSession } from '../domain/chats.ts';
import { isObservation } from '../domain/decision.ts';
import { recentByAgent, recentBySession, teamName } from '../domain/feed.ts';
import { formatAge } from '../domain/format.ts';
import { ownerOfTeam, PEOPLE, personByName, reportsOf, type Person } from '../domain/people.ts';
import { useNow } from '../hooks.ts';
import { useAgentPulse } from '../live.ts';
import { Icon } from './icon.tsx';
import { Burst, EASE, SPRING, TONE_COLOR, trackPointer } from './motion.tsx';
import { Spark } from './spark.tsx';
import { AgentGlyph, Avatar, outcomeOf, StatePill, TickStrip, toneClass, type Tone } from './ui.tsx';

// Fixed sizes keep the connectors exact: every line is drawn from these numbers, not measured.
const CARD_W = 284;
const CARD_H = 116;
const CHIP_W = 252;
const CHIP_H = 76;
const CHIP_GAP = 12;
const LINK_W = 76;
const LEVEL_GAP = 64;
const ROW_GAP = 20;

/** One person-agent exchange: the request goes out, the decision comes back. */
export interface Exchange {
  id: string;
  personId: string;
  agentId: string;
  capability: string;
  tone: Tone;
  label: string;
}

export interface Assignment {
  /** The agent id, or the session id for a chat: one assistant can serve several people at once. */
  key: string;
  agent: Agent;
  /** Launched by this person in a live session; otherwise owned by their department, idle. */
  live: boolean;
  /** A Betsee Desk chat: drawn while the session is open, gone when it ends. */
  chat?: AgentSession;
}

/** For a chat whose agent is not in the agents list (yet): enough to draw and link it. */
const chatAgent = (session: AgentSession): Agent => ({
  id: session.agent_id,
  name: session.agent_id,
  team: '',
  provider: '',
  model: '',
  state: 'active',
  state_reason: null,
  state_changed_at: null,
  current_session: session,
  budget: session.budget,
});

/**
 * Puts every agent beside the person who launched it, or beside the head of its team when idle.
 * Chat agents are drawn once per open chat beside the person chatting, after their other agents.
 */
export function assignAgents(agents: readonly Agent[], sessions: readonly AgentSession[] = []): Map<string, Assignment[]> {
  const out = new Map<string, Assignment[]>();
  const chatAgents = chatAgentIds(sessions);
  for (const agent of agents) {
    if (chatAgents.has(agent.id) || (agent.current_session && isChatSession(agent.current_session))) continue;
    const launcher = personByName(agent.current_session?.human.display_name);
    const owner = launcher ?? ownerOfTeam(agent.team) ?? PEOPLE[0]!;
    out.set(owner.id, [...(out.get(owner.id) ?? []), { key: agent.id, agent, live: Boolean(launcher) }]);
  }
  for (const list of out.values()) list.sort((a, b) => Number(b.live) - Number(a.live) || a.agent.id.localeCompare(b.agent.id));
  const byId = new Map(agents.map((a) => [a.id, a]));
  for (const [personId, { live }] of chatsByPerson(sessions)) {
    const chats = live.map((session) => ({ key: session.id, agent: byId.get(session.agent_id) ?? chatAgent(session), live: true, chat: session }));
    if (chats.length) out.set(personId, [...(out.get(personId) ?? []), ...chats]);
  }
  return out;
}

const verdict = (a: ActionSummary) => {
  const outcome = outcomeOf(a);
  return { tone: a.ai_tightened && outcome.tone === 'bad' ? ('ai' as Tone) : outcome.tone, label: outcome.label };
};

/** Live exchanges between people and their agents, newest per pair, kept a few seconds. */
export function useExchanges(): Map<string, Exchange> {
  const reduce = useReducedMotion();
  const [byPair, setByPair] = useState<Map<string, Exchange>>(new Map());
  useEffect(() => {
    if (reduce) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = subscribeToEvents((event) => {
      if (event.type !== 'action.decided' && event.type !== 'action.updated') return;
      const a = event.data;
      if (isObservation(a)) return;
      const person = personByName(a.human?.display_name);
      if (!person) return;
      const { tone, label } = verdict(a);
      const exchange: Exchange = { id: `${a.trace_id}:${event.type}`, personId: person.id, agentId: a.agent.id, capability: a.capability, tone, label };
      const key = `${person.id}|${a.agent.id}`;
      setByPair((prev) => new Map(prev).set(key, exchange));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setByPair((prev) => {
          if (prev.get(key)?.id !== exchange.id) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      }, 4_000);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      for (const t of timers) clearTimeout(t);
    };
  }, [reduce]);
  return byPair;
}

function AgentChip({ assignment, recent, exchange }: { assignment: Assignment; recent: ActionSummary[]; exchange?: Exchange }) {
  const { agent, live } = assignment;
  const now = useNow(10_000);
  const { pulse } = useAgentPulse(agent.id);
  const last = recent.at(-1);
  const tone = pulse.action ? outcomeOf(pulse.action).tone : 'accent';
  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.id)}`}
      onPointerMove={trackPointer}
      style={{ width: CHIP_W, height: CHIP_H }}
      className={`group hover-lift spotlight relative flex items-center gap-3 rounded-[18px] border px-3.5 shadow-card transition-transform duration-300 hover:-translate-y-0.5 ${
        agent.state === 'quarantined' ? 'border-quar/40 bg-quar-soft' : live ? 'border-line bg-surface' : 'border-dashed border-line-strong bg-surface/70'
      }`}
    >
      <Burst trigger={pulse.seq} color={TONE_COLOR[tone]} radius="18px" strength={1.06} delay={0.45} />
      <AgentGlyph state={agent.state} size={40} agentId={agent.id} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14.5px] font-bold tracking-[-0.01em] text-ink">{agent.id}</span>
          {agent.state !== 'active' && <StatePill state={agent.state} />}
        </span>
        <AnimatePresence mode="wait" initial={false}>
          {exchange ? (
            <motion.span
              key={exchange.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-accent-ink"
            >
              <Icon name="send" size={12} />
              <span className="truncate font-mono text-[11.5px]">{exchange.capability}</span>
            </motion.span>
          ) : last ? (
            <motion.span key={last.trace_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneClass(outcomeOf(last).tone).dot}`} />
              <span className="truncate font-mono text-[11.5px] text-ink-2">{last.capability}</span>
              <span className="ml-auto shrink-0">{formatAge(last.occurred_at, now)}</span>
            </motion.span>
          ) : (
            <span className="mt-1 block text-[12px] text-ink-3">{live ? 'No request yet' : `${teamName(agent.team)} team, no session`}</span>
          )}
        </AnimatePresence>
        <TickStrip actions={recent.slice(-16)} className="mt-1.5" />
      </span>
    </Link>
  );
}

/** An open Betsee Desk chat beside the person having it; it leaves when the session ends. */
function ChatChip({ session, agent, recent, exchange }: { session: AgentSession; agent: Agent; recent: ActionSummary[]; exchange?: Exchange }) {
  const now = useNow(10_000);
  const { pulse } = useAgentPulse(agent.id);
  const last = recent.at(-1);
  const tone = pulse.action?.session_id === session.id ? outcomeOf(pulse.action).tone : 'accent';
  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.id)}`}
      onPointerMove={trackPointer}
      title={`${session.use_case.name}: chat ${session.id}`}
      style={{ width: CHIP_W, height: CHIP_H }}
      className="group hover-lift spotlight relative flex items-center gap-3 rounded-[18px] border border-accent/25 bg-surface px-3.5 shadow-card transition-transform duration-300 hover:-translate-y-0.5"
    >
      <Burst trigger={pulse.action?.session_id === session.id ? pulse.seq : undefined} color={TONE_COLOR[tone]} radius="18px" strength={1.06} delay={0.45} />
      <span aria-hidden="true" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
        <Icon name="chat" size={19} />
        <span className="live-dot absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-surface" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="shrink-0 text-[14.5px] font-bold tracking-[-0.01em] text-ink">Chat</span>
          <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-3">{agent.id}</span>
        </span>
        <AnimatePresence mode="wait" initial={false}>
          {exchange ? (
            <motion.span
              key={exchange.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-accent-ink"
            >
              <Icon name="send" size={12} />
              <span className="truncate font-mono text-[11.5px]">{exchange.capability}</span>
            </motion.span>
          ) : last ? (
            <motion.span key={last.trace_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneClass(outcomeOf(last).tone).dot}`} />
              <span className="truncate font-mono text-[11.5px] text-ink-2">{last.capability}</span>
              <span className="ml-auto shrink-0">{formatAge(last.occurred_at, now)}</span>
            </motion.span>
          ) : (
            <span className="mt-1 block text-[12px] text-ink-3">Started {formatAge(session.started_at, now)}</span>
          )}
        </AnimatePresence>
        <TickStrip actions={recent.slice(-16)} className="mt-1.5" />
      </span>
    </Link>
  );
}

/** The elbows from a person to each agent beside them, with the live request and reply on them. */
function AgentLinks({ height, exchanges, assignments }: { height: number; exchanges: Map<string, Exchange>; assignments: Assignment[] }) {
  const reduce = useReducedMotion();
  const count = assignments.length;
  const stack = count * CHIP_H + (count - 1) * CHIP_GAP;
  const top = (height - stack) / 2;
  const mid = height / 2;
  return (
    <svg width={LINK_W} height={height} className="shrink-0 overflow-visible" aria-hidden="true">
      {assignments.map(({ key, agent, live }, i) => {
        const y = top + CHIP_H / 2 + i * (CHIP_H + CHIP_GAP);
        const d = `M 0 ${mid} C ${LINK_W * 0.55} ${mid}, ${LINK_W * 0.45} ${y}, ${LINK_W} ${y}`;
        const exchange = exchanges.get(key) ?? exchanges.get(agent.id);
        return (
          <g key={key}>
            <motion.path
              d={d}
              fill="none"
              stroke={exchange ? TONE_COLOR.accent : 'var(--color-line-strong)'}
              strokeOpacity={exchange ? 0.6 : 1}
              strokeWidth={exchange ? 2.5 : 1.75}
              strokeDasharray={live ? undefined : '4 5'}
              strokeLinecap="round"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.25 + i * 0.08 }}
              style={{ transition: 'stroke 400ms, stroke-width 300ms, stroke-opacity 400ms' }}
            />
            {exchange && (
              <g key={exchange.id}>
                <Spark d={d} color={TONE_COLOR.accent} duration={0.65} />
                <Spark d={d} color={TONE_COLOR[exchange.tone]} duration={0.65} delay={0.85} reverse radius={6} />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function PersonCard({
  person,
  principal,
  agents,
  reply,
  selected,
  onOpen,
  collapsed,
  onToggle,
  reports,
}: {
  person: Person;
  principal: boolean;
  agents: Assignment[];
  reply?: Exchange;
  selected: boolean;
  onOpen: () => void;
  collapsed: boolean;
  onToggle?: () => void;
  reports: number;
}) {
  const live = agents.filter((a) => a.live).length;
  return (
    <div className="relative shrink-0" style={{ width: CARD_W, height: CARD_H }}>
      <motion.button
        type="button"
        onClick={onOpen}
        onPointerMove={trackPointer}
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.985 }}
        transition={SPRING}
        className={`hover-lift spotlight flex h-full w-full items-center gap-4 rounded-[22px] border bg-surface px-4 text-left shadow-card ${
          selected ? 'border-accent/50 ring-4 ring-accent-soft' : 'border-line'
        }`}
      >
        <span className="relative shrink-0">
          <Avatar name={person.name} size={64} className="ring-4 ring-surface" />
          {principal && (
            <span title="Signs in to Betsee" className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white ring-[3px] ring-surface">
              <Icon name="key" size={12} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold tracking-[-0.015em] text-ink">{person.name}</span>
          <span className="mt-0.5 block truncate text-[13px] text-ink-3">{person.title}</span>
          <span className="mt-2.5 flex items-center gap-2 text-[12px] font-semibold">
            <span className="truncate rounded-full bg-sunken px-2 py-0.5 text-ink-2">{person.department}</span>
            {live > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 whitespace-nowrap text-accent-ink">
                <Icon name="bot" size={12} />
                {live} running
              </span>
            )}
          </span>
        </span>
      </motion.button>
      <AnimatePresence>
        {reply && (
          <motion.span
            key={reply.id}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: 1.45, ...SPRING } }}
            exit={{ opacity: 0, y: -6, scale: 0.95, transition: { duration: 0.2 } }}
            className={`pointer-events-none absolute -top-4 right-4 z-10 inline-flex max-w-[240px] items-center gap-1.5 rounded-full border-2 border-surface px-3 py-1 text-[12px] font-bold shadow-lift ${toneClass(reply.tone).soft} ${toneClass(reply.tone).ink}`}
          >
            <Icon name="reply" size={12} />
            <span className="truncate">
              {reply.agentId}: {reply.label.toLowerCase()}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
      {onToggle && (
        <motion.button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Show the ${reports} people who report to ${person.name}` : `Hide the people who report to ${person.name}`}
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.92 }}
          transition={SPRING}
          className="absolute top-1/2 -right-3.5 z-10 -mt-3.5 flex h-7 min-w-7 items-center justify-center rounded-full border border-line bg-surface px-1.5 text-[11px] font-bold text-ink-2 shadow-card hover:text-ink"
        >
          {collapsed ? reports : <Icon name="chevron-left" size={14} />}
        </motion.button>
      )}
    </div>
  );
}

interface TreeContext {
  assignments: Map<string, Assignment[]>;
  principals: Set<string>;
  recent: Map<string, ActionSummary[]>;
  recentChats: Map<string, ActionSummary[]>;
  exchanges: Map<string, Exchange>;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  selected: string | null;
  open: (id: string) => void;
  intro: boolean;
}

/** The vertical line shared by siblings and the elbow into each one, with rounded corners at the ends. */
function Spine({ first, last }: { first: boolean; last: boolean }) {
  const w = LEVEL_GAP / 2;
  const half = ROW_GAP / 2;
  const line = 'border-line-strong';
  if (first && last) return <span aria-hidden="true" className={`absolute top-1/2 left-0 h-0 border-t-[1.75px] ${line}`} style={{ width: w }} />;
  if (first) return <span aria-hidden="true" className={`absolute top-1/2 left-0 rounded-tl-[14px] border-t-[1.75px] border-l-[1.75px] ${line}`} style={{ width: w, bottom: -half }} />;
  if (last) return <span aria-hidden="true" className={`absolute bottom-1/2 left-0 rounded-bl-[14px] border-b-[1.75px] border-l-[1.75px] ${line}`} style={{ width: w, top: -half }} />;
  return (
    <>
      <span aria-hidden="true" className={`absolute left-0 border-l-[1.75px] ${line}`} style={{ top: -half, bottom: -half }} />
      <span aria-hidden="true" className={`absolute top-1/2 left-0 border-t-[1.75px] ${line}`} style={{ width: w }} />
    </>
  );
}

/** A person with their agents beside them, then the people who report to them further right. */
function Branch({ person, ctx, depth, index }: { person: Person; ctx: TreeContext; depth: number; index: number }) {
  const reduce = useReducedMotion();
  const reports = reportsOf(person.id);
  const agents = ctx.assignments.get(person.id) ?? [];
  const collapsed = ctx.collapsed.has(person.id);
  const stack = agents.length * CHIP_H + Math.max(0, agents.length - 1) * CHIP_GAP;
  const unitH = Math.max(CARD_H, stack);
  const pairExchanges = new Map<string, Exchange>();
  let reply: Exchange | undefined;
  for (const { key, agent } of agents) {
    const e = ctx.exchanges.get(`${person.id}|${agent.id}`);
    if (e) {
      pairExchanges.set(key, e);
      reply = e;
    }
  }
  const delay = ctx.intro ? depth * 0.22 + index * 0.06 : 0;
  return (
    <div className="flex items-center">
      <motion.div
        className="flex shrink-0 items-center"
        style={{ height: unitH }}
        initial={reduce ? false : { opacity: 0, x: -28, filter: 'blur(6px)' }}
        animate={{ opacity: 1, x: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
        transition={{ ...SPRING, delay }}
      >
        <PersonCard
          person={person}
          principal={ctx.principals.has(person.id)}
          agents={agents}
          reply={reply}
          selected={ctx.selected === person.id}
          onOpen={() => ctx.open(person.id)}
          collapsed={collapsed}
          onToggle={reports.length ? () => ctx.toggle(person.id) : undefined}
          reports={reports.length}
        />
        {agents.length > 0 && (
          <>
            <AgentLinks height={unitH} exchanges={pairExchanges} assignments={agents} />
            <div className="flex flex-col" style={{ gap: CHIP_GAP }}>
              <AnimatePresence initial={false} mode="popLayout">
                {agents.map((a, i) => (
                  <motion.div
                    key={a.key}
                    layout={reduce ? false : 'position'}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, x: -16, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16, scale: 0.92, transition: { duration: 0.3, ease: EASE } }}
                    transition={{ ...SPRING, delay: a.chat ? 0 : delay + 0.3 + i * 0.07 }}
                  >
                    {a.chat ? (
                      <ChatChip session={a.chat} agent={a.agent} recent={ctx.recentChats.get(a.chat.id) ?? []} exchange={pairExchanges.get(a.key)} />
                    ) : (
                      <AgentChip assignment={a} recent={ctx.recent.get(a.agent.id) ?? []} exchange={pairExchanges.get(a.key)} />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </motion.div>
      <AnimatePresence initial={false}>
        {reports.length > 0 && !collapsed && (
          <motion.div
            key="reports"
            className="flex items-center overflow-hidden"
            initial={reduce ? { opacity: 0 } : { opacity: 0, width: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, width: 'auto', transitionEnd: { overflow: 'visible' } }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, width: 0, overflow: 'hidden' }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <span aria-hidden="true" className="h-0 shrink-0 border-t-[1.75px] border-line-strong" style={{ width: LEVEL_GAP / 2 }} />
            <div className="flex flex-col py-4" style={{ gap: ROW_GAP }}>
              {reports.map((report, i) => (
                <div key={report.id} className="relative flex items-center" style={{ paddingLeft: LEVEL_GAP / 2 }}>
                  <Spine first={i === 0} last={i === reports.length - 1} />
                  <Branch person={report} ctx={ctx} depth={depth + 1} index={i} />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The whole organization, left to right: the chief executive, the people who report to each
 * person, and beside every person the agents they launched. Requests run along the line to an
 * agent and the decision comes back to the person who asked.
 */
export function OrgChart({
  assignments,
  principals,
  actions,
  selected,
  onOpen,
  collapsed,
  onToggle,
}: {
  assignments: Map<string, Assignment[]>;
  principals: Set<string>;
  actions: readonly ActionSummary[];
  selected: string | null;
  onOpen: (id: string) => void;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}) {
  const exchanges = useExchanges();
  const decided = useMemo(() => actions.filter((a) => !isObservation(a)), [actions]);
  const recent = useMemo(() => recentByAgent(decided, 16), [decided]);
  const recentChats = useMemo(() => recentBySession(decided, 16), [decided]);
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 2_000);
    return () => clearTimeout(timer);
  }, []);
  const root = PEOPLE.find((p) => !p.manager)!;
  const ctx: TreeContext = { assignments, principals, recent, recentChats, exchanges, collapsed, toggle: onToggle, selected, open: onOpen, intro };
  return (
    <div className="inline-flex">
      <Branch person={root} ctx={ctx} depth={0} index={0} />
    </div>
  );
}
