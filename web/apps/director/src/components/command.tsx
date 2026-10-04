import { useAgents, useLaunchScenario, useResetDemo, useScenarios } from '@betsee/api';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { teamName } from '../domain/feed.ts';
import { formatTime } from '../domain/format.ts';
import { PEOPLE } from '../domain/people.ts';
import { useActions } from '../hooks.ts';
import { NAV_ITEMS } from '../nav.ts';
import { Icon, type IconName } from './icon.tsx';
import { EASE } from './motion.tsx';
import { notify } from './toasts.tsx';
import { AgentGlyph, Avatar, outcomeOf, toneClass } from './ui.tsx';

export interface PaletteState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/** Opens on Ctrl+K or Cmd+K anywhere, and from the sidebar's search field. */
export function useCommandPalette(): PaletteState {
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return useMemo(() => ({ isOpen, open: () => setOpen(true), close: () => setOpen(false) }), [isOpen]);
}

interface Entry {
  key: string;
  group: string;
  label: string;
  hint: string;
  /** A place to go, or an action to run (the demo acts). */
  to?: string;
  run?: () => void;
  mark: ReactNode;
}

function Mark({ icon }: { icon: IconName }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-sunken text-ink-2">
      <Icon name={icon} size={17} />
    </span>
  );
}

function Palette({ onClose, launch, reset }: { onClose: () => void; launch: ReturnType<typeof useLaunchScenario>; reset: ReturnType<typeof useResetDemo> }) {
  const agents = useAgents();
  const { actions } = useActions();
  const scenarios = useScenarios();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const pages = NAV_ITEMS.map((n) => ({ key: `page:${n.to}`, group: 'Go to', label: n.label, hint: n.hint, to: n.to, mark: <Mark icon={n.icon} /> }));
    const agentEntries = (agents.data ?? []).map((a) => ({
      key: `agent:${a.id}`,
      group: 'Agents',
      label: a.id,
      hint: `${teamName(a.team)} team${a.current_session ? `, launched by ${a.current_session.human.display_name}` : ''}`,
      to: `/agents/${encodeURIComponent(a.id)}`,
      mark: <AgentGlyph state={a.state} size={36} />,
    }));
    const people = PEOPLE.map((p) => ({
      key: `person:${p.id}`,
      group: 'People',
      label: p.name,
      hint: `${p.title}, ${p.department}`,
      to: `/agents?person=${p.id}`,
      mark: <Avatar name={p.name} size={36} />,
    }));
    const traces = actions.slice(0, 40).map((a) => {
      const outcome = outcomeOf(a);
      return {
        key: `trace:${a.trace_id}`,
        group: 'Recent decisions',
        label: `${a.agent.id}: ${a.capability}`,
        hint: `${formatTime(a.occurred_at)} on ${a.resource.id}, ${outcome.label.toLowerCase()}`,
        to: `/traces/${encodeURIComponent(a.trace_id)}`,
        mark: (
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] ${toneClass(outcome.tone).soft} ${toneClass(outcome.tone).ink}`}>
            <Icon name="route" size={17} />
          </span>
        ),
      };
    });
    // The presenter's acts live here rather than on screen; the runner is optional, so they appear
    // only when it answers (docs/demo-script.md keeps the terminal fallback).
    const acts = [...(scenarios.data ?? [])].sort((a, b) => a.act - b.act);
    const demo: Entry[] = acts.length
      ? [
          ...acts.map((scenario) => ({
            key: `act:${scenario.id}`,
            group: 'Demo',
            label: `Act ${scenario.act}: ${scenario.title}`,
            hint: scenario.summary,
            mark: <Mark icon="play" />,
            run: () =>
              launch.mutate(scenario.id, {
                onSuccess: () => notify({ key: `act:${scenario.id}`, tone: 'accent', icon: 'play', title: `Act ${scenario.act} started`, body: scenario.title, to: '/activity' }),
                onError: (error) => notify({ key: `act:${scenario.id}`, tone: 'bad', icon: 'alert', title: `Act ${scenario.act} did not start`, body: error.message, to: '/' }),
              }),
          })),
          ...(acts.some((s) => s.act === 7)
            ? []
            : [{ key: 'act:7', group: 'Demo', label: 'Act 7: Coverage and close', hint: 'Opens the coverage view.', to: '/coverage', mark: <Mark icon="shield" /> }]),
          {
            key: 'demo:reset',
            group: 'Demo',
            label: 'Reset scenario',
            hint: 'Ends demo sessions, releases agents, restores the tool pin.',
            mark: <Mark icon="reset" />,
            run: () =>
              reset.mutate(undefined, {
                onSuccess: () =>
                  notify({ key: 'demo:reset', tone: 'ok', icon: 'reset', title: 'Scenario state reset', body: 'Demo sessions ended, agents released, tool pin restored.', to: '/' }),
                onError: (error) => notify({ key: 'demo:reset', tone: 'bad', icon: 'alert', title: 'Reset failed', body: error.message, to: '/' }),
              }),
          },
        ]
      : [];
    const q = query.trim().toLowerCase();
    const all = [...pages, ...demo, ...agentEntries, ...people, ...traces];
    if (!q) return [...pages, ...demo, ...agentEntries, ...people.slice(0, 4), ...traces.slice(0, 4)];
    return all.filter((e) => `${e.label} ${e.hint}`.toLowerCase().includes(q)).slice(0, 30);
  }, [agents.data, actions, query, scenarios.data, launch, reset]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    if (entry.run) entry.run();
    else if (entry.to) navigate(entry.to);
    onClose();
  };

  let previousGroup = '';
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/20 px-4 pt-[12vh] backdrop-blur-[3px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-label="Search the Director"
        className="glass w-full max-w-[640px] overflow-hidden rounded-[22px]"
        initial={{ opacity: 0, y: -16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
      >
        <div className="flex items-center gap-3 border-b border-line/70 px-5">
          <Icon name="search" size={19} className="text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(entries.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(entries[index]);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            placeholder="Search places, agents, people and decisions"
            className="h-16 flex-1 bg-transparent text-[16px] font-medium text-ink outline-none placeholder:text-ink-4 focus-visible:outline-none"
          />
          <kbd className="rounded-md border border-line bg-sunken px-1.5 py-0.5 font-sans text-[11px] font-semibold text-ink-3">Esc</kbd>
        </div>
        <ul ref={listRef} className="scrollbar-quiet max-h-[52vh] overflow-y-auto p-2">
          {entries.map((entry, i) => {
            const header = entry.group !== previousGroup ? entry.group : null;
            previousGroup = entry.group;
            return (
              <li key={entry.key}>
                {header && <p className="px-3 pt-3 pb-1.5 text-[11px] font-bold tracking-[0.08em] text-ink-4 uppercase">{header}</p>}
                <button
                  type="button"
                  data-index={i}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => go(entry)}
                  className="relative flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left"
                >
                  {i === index && <motion.span layoutId="palette-active" className="absolute inset-0 rounded-[14px] bg-ink/[0.05]" transition={{ type: 'spring', stiffness: 600, damping: 45 }} />}
                  <span className="relative">{entry.mark}</span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold text-ink">{entry.label}</span>
                    <span className="block truncate text-[12.5px] text-ink-3">{entry.hint}</span>
                  </span>
                  {i === index && (
                    <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.15, ease: EASE }} className="relative text-ink-3">
                      <Icon name="arrow-right" size={16} />
                    </motion.span>
                  )}
                </button>
              </li>
            );
          })}
          {!entries.length && <li className="px-4 py-10 text-center text-[14px] text-ink-3">Nothing matches "{query}".</li>}
        </ul>
      </motion.div>
    </motion.div>
  );
}

export function CommandPalette({ state }: { state: PaletteState }) {
  // The demo mutations live out here: the palette closes as an act starts, and a mutation's
  // callbacks only fire while the component that started it is still mounted.
  const launch = useLaunchScenario();
  const reset = useResetDemo();
  return <AnimatePresence>{state.isOpen && <Palette onClose={state.close} launch={launch} reset={reset} />}</AnimatePresence>;
}
