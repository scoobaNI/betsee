import { useLaunchScenario, useResetDemo, useScenarioRun, useScenarios, type Scenario, type ScenarioRun } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { decisionLabel } from '../domain/decision.ts';
import { Icon } from './icon.tsx';
import { EASE } from './ui.tsx';

type ActState = 'idle' | 'starting' | 'running' | 'passed' | 'failed';

const OPEN_KEY = 'director.demo-dock.open';

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Storage can be unavailable (private windows); the dock then simply starts closed.
  }
}

function runSummary(run: ScenarioRun | undefined): string {
  if (!run) return '';
  const done = run.steps.filter((s) => s.actual_decision).length;
  const mismatches = run.steps.filter((s) => s.ok === false);
  const head = `${done} of ${run.steps.length} steps decided`;
  if (!mismatches.length) return head;
  return `${head}. Unexpected: ${mismatches
    .map((s) => `${s.step_id} expected ${decisionLabel[s.expected_decision]}, got ${s.actual_decision ? decisionLabel[s.actual_decision] : (s.error ?? 'nothing')}`)
    .join('; ')}`;
}

function useRunState(runId: string | undefined, launching: boolean): { state: ActState; run: ScenarioRun | undefined } {
  const run = useScenarioRun(runId);
  if (launching) return { state: 'starting', run: undefined };
  if (!runId || !run.data) return { state: runId ? 'starting' : 'idle', run: undefined };
  const status = run.data.status;
  return { state: status === 'running' ? 'running' : status === 'passed' ? 'passed' : 'failed', run: run.data };
}

function ActButton({ scenario, runId, launching, onLaunch }: { scenario: Scenario; runId: string | undefined; launching: boolean; onLaunch: () => void }) {
  const { state, run } = useRunState(runId, launching);
  const running = state === 'starting' || state === 'running';
  return (
    <button
      type="button"
      onClick={onLaunch}
      disabled={running}
      title={[`Act ${scenario.act}: ${scenario.title}`, scenario.summary, runSummary(run)].filter(Boolean).join('\n')}
      aria-label={`Launch Act ${scenario.act}: ${scenario.title}`}
      className={`relative inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
        running ? 'bg-ink text-white' : 'text-ink-2 hover:bg-sunken hover:text-ink'
      }`}
    >
      {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
      Act {scenario.act}
      {state === 'passed' && <Icon name="check" size={13} className="text-ok" strokeWidth={2.25} />}
      {state === 'failed' && <Icon name="alert" size={13} className="text-bad" />}
    </button>
  );
}

/** The presenter's controls for the scripted acts; folds away to one quiet pill when not needed. */
export function DemoDock() {
  const scenarios = useScenarios();
  const launch = useLaunchScenario();
  const reset = useResetDemo();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(readOpen);
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => writeOpen(open), [open]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 6_000);
    return () => clearTimeout(timer);
  }, [message]);

  // The runner is optional: when it does not answer, the terminal fallback runs the acts.
  if (!scenarios.data?.length) return null;
  const acts = [...scenarios.data].sort((a, b) => a.act - b.act);

  const start = (scenario: Scenario) => {
    setLaunching(scenario.id);
    launch.mutate(scenario.id, {
      onSuccess: ({ run_id }) => setRuns((prev) => ({ ...prev, [scenario.id]: run_id })),
      onError: (error) => setMessage(`Act ${scenario.act} did not start: ${error.message}`),
      onSettled: () => setLaunching(null),
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <AnimatePresence>
        {message && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="rounded-xl border border-line bg-surface px-4 py-2 text-[13px] text-ink-2 shadow-lift"
          >
            {message}
          </motion.p>
        )}
      </AnimatePresence>
      <motion.nav
        layout={!reduce}
        transition={{ duration: 0.35, ease: EASE }}
        aria-label="Demo scenarios"
        className="flex max-w-[calc(100vw-32px)] items-center gap-1 overflow-x-auto rounded-full border border-line bg-surface/95 p-1 shadow-pop backdrop-blur-xl [scrollbar-width:none]"
      >
        <motion.button
          layout={!reduce ? 'position' : false}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          title={open ? 'Hide the demo controls' : 'Show the demo controls'}
          className="inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
        >
          <Icon name="flask" size={15} />
          {open ? <Icon name="chevron-down" size={14} /> : 'Demo'}
        </motion.button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="acts"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex shrink-0 items-center gap-1"
            >
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
              {acts.map((scenario) => (
                <ActButton key={scenario.id} scenario={scenario} runId={runs[scenario.id]} launching={launching === scenario.id} onLaunch={() => start(scenario)} />
              ))}
              {!acts.some((s) => s.act === 7) && (
                <button
                  type="button"
                  onClick={() => navigate('/coverage')}
                  title="Act 7: Coverage and close. Opens the coverage view."
                  className="inline-flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
                >
                  Act 7
                </button>
              )}
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
              <button
                type="button"
                disabled={reset.isPending}
                onClick={() =>
                  reset.mutate(undefined, {
                    onSuccess: () => {
                      setRuns({});
                      setMessage('Scenario state reset: demo sessions ended, agents released, tool pin restored.');
                    },
                    onError: (error) => setMessage(`Reset failed: ${error.message}`),
                  })
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              >
                <Icon name="reset" size={14} className={reset.isPending ? 'animate-spin' : ''} />
                {reset.isPending ? 'Resetting' : 'Reset scenario'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>
    </div>
  );
}
