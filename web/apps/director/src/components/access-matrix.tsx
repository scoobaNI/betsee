import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { changeKey, type AccessChangeRequest, type AccessSnapshot, type AgentAccess, type Staged } from '../domain/access.ts';
import { Icon } from './icon.tsx';
import { Burst, SPRING, TONE_COLOR } from './motion.tsx';
import { useMediaQuery } from '../hooks.ts';
import { AgentGlyph, StatePill } from './ui.tsx';

const CELL = 46;

/** Every capability any use case permits, in the order use cases list them. */
export function capabilityColumns(agents: readonly AgentAccess[]): string[] {
  return [...new Set(agents.flatMap((a) => a.permitted))];
}

function CapabilityHeader({ capability, active }: { capability: string; active: boolean }) {
  const [domain, verb] = capability.split('.');
  return (
    <span className={`flex flex-col items-center font-mono leading-tight transition-colors ${active ? 'text-accent-ink' : 'text-ink-3'}`} title={capability}>
      <span className="text-[11.5px] font-semibold">{domain}</span>
      <span className="text-[10.5px]">.{verb}</span>
    </span>
  );
}

type CellState = 'outside' | 'off' | 'on' | 'grant' | 'revoke';

function Cell({
  state,
  approval,
  stepUp,
  uses,
  maxUses,
  hot,
  applied,
  label,
  onToggle,
}: {
  state: CellState;
  approval: boolean;
  stepUp: boolean;
  uses: number;
  maxUses: number;
  hot: boolean;
  applied: boolean;
  label: string;
  onToggle: () => void;
}) {
  const reduce = useReducedMotion();
  if (state === 'outside') {
    return (
      <span className={`flex items-center justify-center ${hot ? 'bg-accent-soft/40' : ''}`} style={{ height: CELL + 14 }}>
        <span title={`${label}: outside the use case, the Gateway denies it whatever is delegated`} className="hatch block rounded-xl opacity-60" style={{ width: CELL - 10, height: CELL - 10 }} />
      </span>
    );
  }
  const look = {
    on: 'bg-accent text-white shadow-[0_6px_16px_-6px_var(--color-accent)]',
    off: 'bg-surface text-ink-4 ring-1 ring-line-strong hover:ring-accent/50 hover:text-accent',
    grant: 'bg-ok-soft text-ok-ink ring-2 ring-ok staged-pulse',
    revoke: 'bg-bad-soft text-bad-ink ring-2 ring-bad staged-pulse',
  }[state];
  const icon = state === 'revoke' ? 'x' : 'check';
  const title = {
    on: `${label}: delegated. Click to stage a revoke.`,
    off: `${label}: permitted, not delegated. Click to stage a grant.`,
    grant: `${label}: grant staged. Click to undo.`,
    revoke: `${label}: revoke staged. Click to undo.`,
  }[state];
  return (
    <span className={`flex flex-col items-center justify-center gap-1 transition-colors ${hot ? 'bg-accent-soft/40' : ''}`} style={{ height: CELL + 14 }}>
      <motion.button
        type="button"
        onClick={onToggle}
        title={title}
        aria-label={title}
        aria-pressed={state === 'on' || state === 'grant'}
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.86 }}
        transition={SPRING}
        className={`group relative flex items-center justify-center rounded-xl transition-[background-color,box-shadow,color] duration-300 ${look}`}
        style={{ width: CELL - 10, height: CELL - 10 }}
      >
        <Burst trigger={applied ? 'applied' : undefined} onMount color={TONE_COLOR.accent} radius="12px" strength={1.5} />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: -45 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: 45 }}
            transition={SPRING}
            className="flex"
          >
            <Icon name={icon} size={17} className={state === 'off' ? 'opacity-0 transition-opacity group-hover:opacity-70' : ''} />
          </motion.span>
        </AnimatePresence>
        {(approval || stepUp) && state !== 'off' && (
          <span className="absolute -top-1 -right-1 flex gap-0.5">
            {approval && <span title="Needs a person's approval" className="h-2.5 w-2.5 rounded-full bg-wait ring-2 ring-surface" />}
            {stepUp && <span title="Needs step-up" className="h-2.5 w-2.5 rounded-full bg-verify ring-2 ring-surface" />}
          </span>
        )}
      </motion.button>
      <span className="h-[3px] overflow-hidden rounded-full bg-sunken" style={{ width: CELL - 18 }} title={`Used ${uses} times in the last hour`}>
        <motion.span className="block h-full rounded-full bg-ok/70" initial={false} animate={{ width: maxUses ? `${(uses / maxUses) * 100}%` : '0%' }} transition={{ duration: 0.6 }} />
      </span>
    </span>
  );
}

function StateSwitch({ agent, staged, onStage }: { agent: AgentAccess; staged?: AccessChangeRequest; onStage: (r: AccessChangeRequest) => void }) {
  const target = staged?.kind === 'agent_state' ? staged.state : agent.state === 'active' ? 'active' : 'suspended';
  const on = target === 'active';
  if (agent.state === 'quarantined' && !staged) {
    return (
      <span className="flex items-center gap-2">
        <StatePill state="quarantined" />
        <button type="button" onClick={() => onStage({ kind: 'agent_state', agent_id: agent.agent_id, state: 'active' })} className="press text-[13px] font-semibold text-accent-ink hover:text-accent">
          Release
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${agent.agent_id} ${on ? 'active' : 'suspended'}`}
      onClick={() => onStage({ kind: 'agent_state', agent_id: agent.agent_id, state: on ? 'suspended' : 'active' })}
      className={`press flex items-center gap-2.5 rounded-full py-1 pr-3 pl-1 text-[12.5px] font-semibold transition-colors ${staged ? 'ring-2 ring-offset-2 ring-offset-surface staged-pulse ' + (on ? 'ring-ok' : 'ring-bad') : ''} ${on ? 'bg-ok-soft text-ok-ink' : 'bg-sunken text-ink-3'}`}
    >
      <span className={`relative flex h-6 w-11 items-center rounded-full px-0.5 transition-colors duration-300 ${on ? 'bg-ok' : 'bg-ink-4'}`}>
        <motion.span layout transition={SPRING} className={`h-5 w-5 rounded-full bg-white shadow-card ${on ? 'ml-auto' : ''}`} />
      </span>
      {on ? 'Active' : 'Suspended'}
    </button>
  );
}

/**
 * Agents by capability. A filled cell is delegated; clicking stages a grant or a revoke, drawn in
 * green or red until applied; hatched cells are outside the agent's use case. The bar under a cell
 * is how often the agent used it in the last hour, so unused grants stand out.
 */
export function AccessMatrix({
  snapshot,
  staged,
  usage,
  focus,
  applied,
  onStage,
  owners,
}: {
  snapshot: AccessSnapshot;
  staged: Staged;
  usage: Map<string, Map<string, number>>;
  focus: string | null;
  applied: ReadonlySet<string>;
  onStage: (r: AccessChangeRequest) => void;
  owners: Map<string, string>;
}) {
  const reduce = useReducedMotion();
  const columns = useMemo(() => capabilityColumns(snapshot.agents), [snapshot.agents]);
  const [hover, setHover] = useState<{ row: string | null; col: string | null }>({ row: null, col: null });
  // On a phone the agent column keeps only the mark and the id, so a few capabilities stay in view.
  const narrow = useMediaQuery('(max-width: 1023px)');
  const grid = `${narrow ? '132px' : 'minmax(220px,1.3fr)'} repeat(${columns.length}, ${CELL + 14}px) 150px`;
  return (
    <div className="scrollbar-quiet overflow-x-auto" onPointerLeave={() => setHover({ row: null, col: null })}>
      <div className="min-w-max px-3 pb-3">
        <div className="sticky top-0 z-10 grid items-end border-b border-line/70 bg-surface/90 pt-4 pb-3 backdrop-blur" style={{ gridTemplateColumns: grid }}>
          <span className="sticky left-0 z-[2] self-stretch bg-surface/90 pt-6 pl-3 text-[12px] font-bold tracking-[0.06em] text-ink-3 uppercase">Agent</span>
          {columns.map((c) => (
            <span key={c} onPointerEnter={() => setHover({ row: null, col: c })}>
              <CapabilityHeader capability={c} active={hover.col === c} />
            </span>
          ))}
          <span className="pr-3 text-right text-[12px] font-bold tracking-[0.06em] text-ink-3 uppercase">State</span>
        </div>
        {snapshot.agents.map((agent, i) => {
          const rowUsage = usage.get(agent.agent_id);
          const maxUses = Math.max(0, ...(rowUsage ? [...rowUsage.values()] : []));
          const focused = focus === agent.agent_id;
          const stateStaged = staged.get(changeKey({ kind: 'agent_state', agent_id: agent.agent_id, state: 'active' }));
          return (
            <motion.div
              key={agent.agent_id}
              initial={reduce ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: agent.state === 'active' || stateStaged ? 1 : 0.72, x: 0 }}
              transition={{ ...SPRING, delay: reduce ? 0 : i * 0.04 }}
              onPointerEnter={() => setHover((h) => ({ ...h, row: agent.agent_id }))}
              className={`grid items-center rounded-2xl transition-colors duration-300 ${focused ? 'bg-ai-soft/60 ring-1 ring-ai/30' : hover.row === agent.agent_id ? 'bg-hover' : ''}`}
              style={{ gridTemplateColumns: grid }}
            >
              <Link
                to={`/agents/${encodeURIComponent(agent.agent_id)}`}
                className="group sticky left-0 z-[2] flex min-w-0 items-center gap-3 self-stretch rounded-l-2xl bg-inherit py-2 pl-3 max-lg:bg-surface max-lg:shadow-[8px_0_12px_-10px_rgb(16_24_40/0.25)]"
              >
                <AgentGlyph state={agent.state} size={narrow ? 30 : 38} agentId={agent.agent_id} />
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold text-ink group-hover:text-accent-ink max-lg:text-[13px]">{agent.agent_id}</span>
                  <span className="block truncate text-[12.5px] text-ink-3 max-lg:hidden">
                    {agent.use_case.name}
                    {agent.use_case.id === 'employee-assistance' ? ', every Betsee Desk chat' : owners.get(agent.agent_id) ? `, ${owners.get(agent.agent_id)}` : ''}
                  </span>
                </span>
              </Link>
              {columns.map((capability) => {
                const key = changeKey({ kind: 'delegation', agent_id: agent.agent_id, capability, granted: true });
                const pending = staged.get(key);
                const delegated = agent.delegated.includes(capability);
                const state: CellState = !agent.permitted.includes(capability)
                  ? 'outside'
                  : pending?.kind === 'delegation'
                    ? pending.granted
                      ? 'grant'
                      : 'revoke'
                    : delegated
                      ? 'on'
                      : 'off';
                return (
                  <span key={capability} onPointerEnter={() => setHover({ row: agent.agent_id, col: capability })}>
                    <Cell
                      state={state}
                      approval={agent.approval_required.includes(capability)}
                      stepUp={agent.step_up_required.includes(capability)}
                      uses={rowUsage?.get(capability) ?? 0}
                      maxUses={maxUses}
                      hot={hover.col === capability}
                      applied={applied.has(key)}
                      label={`${agent.agent_id} ${capability}`}
                      onToggle={() => onStage({ kind: 'delegation', agent_id: agent.agent_id, capability, granted: !delegated })}
                    />
                  </span>
                );
              })}
              <span className="flex justify-end pr-3">
                <StateSwitch agent={agent} staged={stateStaged} onStage={onStage} />
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
