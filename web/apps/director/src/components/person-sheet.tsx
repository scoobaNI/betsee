import type { ActionSummary, Agent, AgentSession } from '@betsee/api';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { PersonChats } from '../domain/chats.ts';
import { isObservation } from '../domain/decision.ts';
import { teamName } from '../domain/feed.ts';
import { formatAge, formatTime } from '../domain/format.ts';
import { personById, reportsOf, type Person } from '../domain/people.ts';
import { useNow } from '../hooks.ts';
import { ActivityList } from './activity.tsx';
import { Icon, type IconName } from './icon.tsx';
import { EASE } from './motion.tsx';
import type { Assignment } from './org-chart.tsx';
import { AgentGlyph, AnimatedNumber, Avatar, StatePill } from './ui.tsx';

function Fact({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-[14px] text-ink-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-sunken text-ink-3">
        <Icon name={icon} size={15} />
      </span>
      {children}
    </p>
  );
}

function PersonChip({ person, onOpen }: { person: Person; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(person.id)} className="press flex items-center gap-2.5 rounded-full border border-line bg-surface py-1 pr-3.5 pl-1 text-left transition-colors hover:border-line-strong">
      <Avatar name={person.name} size={30} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-ink">{person.name}</span>
        <span className="block truncate text-[11.5px] text-ink-3">{person.title}</span>
      </span>
    </button>
  );
}

/** One chat: open ones pulse, closed ones stay as history with how many requests they made. */
function ChatRow({ session, requests, now }: { session: AgentSession; requests: number; now: number }) {
  const open = session.status === 'active';
  return (
    <Link
      to={`/agents/${encodeURIComponent(session.agent_id)}`}
      className={`group row-hover flex items-center gap-3 rounded-2xl border p-3 ${open ? 'border-accent/25 bg-surface' : 'border-line bg-surface/70'}`}
    >
      <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${open ? 'bg-accent-soft text-accent-ink' : 'bg-sunken text-ink-3'}`}>
        <Icon name="chat" size={18} />
        {open && <span className="live-dot absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-surface" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-ink">{open ? `Open, started ${formatAge(session.started_at, now)}` : `Started ${formatTime(session.started_at)}`}</span>
        <span className="block truncate text-[12.5px] text-ink-3">
          {session.agent_id}, {requests === 1 ? '1 request' : `${requests} requests`}
          {open ? '' : session.status === 'revoked' ? ', revoked' : ', closed'}
        </span>
      </span>
      <Icon name="chevron-right" size={16} className="text-ink-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function Body({
  person,
  principal,
  agents,
  chats,
  actions,
  onOpen,
}: {
  person: Person;
  principal: boolean;
  agents: Assignment[];
  chats?: PersonChats;
  actions: readonly ActionSummary[];
  onOpen: (id: string) => void;
}) {
  const manager = person.manager ? personById(person.manager) : undefined;
  const reports = reportsOf(person.id);
  const mine = useMemo(() => actions.filter((a) => !isObservation(a) && a.human?.display_name === person.name), [actions, person.name]);
  const denied = mine.filter((a) => a.decision === 'deny').length;
  const now = useNow(10_000);
  const perSession = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of mine) if (a.session_id) counts.set(a.session_id, (counts.get(a.session_id) ?? 0) + 1);
    return counts;
  }, [mine]);
  const fixed = agents.filter((a) => !a.chat);
  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center pt-2 text-center">
        <motion.span initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.08 }}>
          <Avatar name={person.name} size={112} className="shadow-lift ring-[6px] ring-surface" />
        </motion.span>
        <h2 className="mt-5 text-[24px] font-bold tracking-[-0.02em] text-ink">{person.name}</h2>
        <p className="mt-1 text-[15px] text-ink-2">{person.title}</p>
        <span
          className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ${principal ? 'bg-accent-soft text-accent-ink' : 'bg-sunken text-ink-3'}`}
        >
          <Icon name={principal ? 'key' : 'id'} size={13} />
          {principal ? 'Signs in to Betsee and launches agents' : 'Directory profile, not a Betsee principal'}
        </span>
      </div>

      <div className="space-y-3">
        <Fact icon="briefcase">{person.department}</Fact>
        <Fact icon="map-pin">{person.location}</Fact>
        <Fact icon="mail">{person.email}</Fact>
      </div>

      {principal && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Agents', value: agents.filter((a) => a.live).length },
            { label: 'Requests', value: mine.length },
            { label: 'Denied', value: denied },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-line bg-surface p-4 text-center">
              <p className="text-[24px] leading-none font-bold tracking-[-0.02em] text-ink">
                <AnimatedNumber value={s.value} />
              </p>
              <p className="mt-1.5 text-[12px] font-medium text-ink-3">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {fixed.length > 0 && (
        <section>
          <h3 className="mb-3 text-[13px] font-bold tracking-[0.06em] text-ink-3 uppercase">{fixed.some((a) => a.live) ? 'Agents beside them' : 'Agents their department owns'}</h3>
          <div className="space-y-2">
            {fixed.map(({ agent, live }: { agent: Agent; live: boolean }) => (
              <Link key={agent.id} to={`/agents/${encodeURIComponent(agent.id)}`} className="group row-hover flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                <AgentGlyph state={agent.state} size={40} agentId={agent.id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold text-ink">{agent.id}</span>
                  <span className="block truncate text-[12.5px] text-ink-3">
                    {live && agent.current_session ? agent.current_session.use_case.name : `${teamName(agent.team)} team, no session`}
                  </span>
                </span>
                {agent.state !== 'active' && <StatePill state={agent.state} />}
                <Icon name="chevron-right" size={16} className="text-ink-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {chats && (chats.live.length > 0 || chats.ended.length > 0) && (
        <section>
          <h3 className="mb-3 text-[13px] font-bold tracking-[0.06em] text-ink-3 uppercase">Chats in Betsee Desk</h3>
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {[...chats.live, ...chats.ended.slice(0, 8)].map((session) => (
                <motion.div key={session.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                  <ChatRow session={session} requests={perSession.get(session.id) ?? 0} now={now} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {manager && (
        <section>
          <h3 className="mb-3 text-[13px] font-bold tracking-[0.06em] text-ink-3 uppercase">Reports to</h3>
          <PersonChip person={manager} onOpen={onOpen} />
        </section>
      )}
      {reports.length > 0 && (
        <section>
          <h3 className="mb-3 text-[13px] font-bold tracking-[0.06em] text-ink-3 uppercase">Direct reports</h3>
          <div className="flex flex-wrap gap-2">
            {reports.map((r) => (
              <PersonChip key={r.id} person={r} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}

      {principal && (
        <section>
          <h3 className="mb-3 text-[13px] font-bold tracking-[0.06em] text-ink-3 uppercase">Their latest requests</h3>
          <div className="rounded-2xl border border-line bg-surface p-1.5">
            <ActivityList actions={mine} limit={6} empty={<p className="p-4 text-[14px] text-ink-3">No request through an agent yet.</p>} />
          </div>
        </section>
      )}
    </div>
  );
}

/** A person's profile sliding in from the right, over the org chart. */
export function PersonSheet({
  personId,
  assignments,
  principals,
  chats,
  actions,
  onOpen,
  onClose,
}: {
  personId: string | null;
  assignments: Map<string, Assignment[]>;
  principals: Set<string>;
  chats: Map<string, PersonChats>;
  actions: readonly ActionSummary[];
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const person = personId ? personById(personId) : undefined;
  useEffect(() => {
    if (!person) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [person, onClose]);
  return (
    <AnimatePresence>
      {person && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-[55] bg-ink/10 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            key="sheet"
            role="dialog"
            aria-label={person.name}
            className="glass scrollbar-quiet fixed top-4 right-4 bottom-4 z-[56] w-[min(440px,calc(100vw-32px))] overflow-y-auto rounded-[26px] px-7 pt-6 pb-10"
            initial={{ x: 480, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 480, opacity: 0.6, transition: { duration: 0.28, ease: EASE } }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="press sticky top-0 z-10 ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-3 shadow-card hover:text-ink"
            >
              <Icon name="x" size={17} />
            </button>
            <AnimatePresence mode="wait">
              <motion.div key={person.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25, ease: EASE }}>
                <Body
                  person={person}
                  principal={principals.has(person.id)}
                  agents={assignments.get(person.id) ?? []}
                  chats={chats.get(person.id)}
                  actions={actions}
                  onOpen={onOpen}
                />
              </motion.div>
            </AnimatePresence>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
