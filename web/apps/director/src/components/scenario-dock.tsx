import { useLaunchScenario, useResetDemo, useScenarioRun, useScenarios, type Scenario, type ScenarioRun } from '@betsee/api';
import { Icon } from '@betsee/ui';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { decisionLabel } from '../domain/decision.ts';

type ActState = 'idle' | 'starting' | 'running' | 'passed' | 'failed';

function runSummary(run: ScenarioRun | undefined): string {
  if (!run) return '';
  const done = run.steps.filter((s) => s.actual_decision).length;
  const mismatches = run.steps.filter((s) => s.ok === false);
  const head = `${done} of ${run.steps.length} steps decided`;
  if (!mismatches.length) return head;
  return `${head}. Unexpected: ${mismatches
    .map((s) => `${s.step_id} expected ${decisionLabel[s.expected_decision]}, got ${s.actual_decision ? decisionLabel[s.actual_decision] : s.error ?? 'nothing'}`)
    .join('; ')}`;
}

function ActButton({ scenario, state, detail, onLaunch }: { scenario: Scenario; state: ActState; detail: string; onLaunch: () => void }) {
  const running = state === 'starting' || state === 'running';
  return (
    <button
      type="button"
      onClick={onLaunch}
      disabled={running}
      title={[`Act ${scenario.act}: ${scenario.title}`, scenario.summary, detail].filter(Boolean).join('\n')}
      aria-label={`Launch Act ${scenario.act}: ${scenario.title}`}
      className={`inline-flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-sm font-semibold ${
        running ? 'bs-feature text-fg-on-feature' : 'text-fg-secondary hover:bg-surface-2 hover:text-fg-primary'
      }`}
    >
      Act {scenario.act}
      {state === 'passed' && <Icon name="streamline:check" size={12} className="text-allow-fg" />}
      {state === 'failed' && <Icon name="streamline-flex:warning-diamond" size={12} className="text-danger" />}
    </button>
  );
}

function useRunState(runId: string | undefined, launching: boolean): { state: ActState; run: ScenarioRun | undefined } {
  const run = useScenarioRun(runId);
  if (launching) return { state: 'starting', run: undefined };
  if (!runId || !run.data) return { state: runId ? 'starting' : 'idle', run: undefined };
  const status = run.data.status;
  return { state: status === 'running' ? 'running' : status === 'passed' ? 'passed' : 'failed', run: run.data };
}

function TrackedAct({ scenario, runId, launching, onLaunch }: { scenario: Scenario; runId: string | undefined; launching: boolean; onLaunch: () => void }) {
  const { state, run } = useRunState(runId, launching);
  return <ActButton scenario={scenario} state={state} detail={runSummary(run)} onLaunch={onLaunch} />;
}

/** One-click acts from docs/demo-script.md through security-architect's demo-runner (p-47, p-161). */
export function ScenarioDock() {
  const scenarios = useScenarios();
  const launch = useLaunchScenario();
  const reset = useResetDemo();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
      {message && (
        <p role="alert" className="dir-overlay rounded-md border border-line-subtle px-3 py-1.5 text-xs text-fg-secondary shadow-e2">
          {message}
        </p>
      )}
      <nav aria-label="Scenario dock" className="dir-overlay flex h-(--bs-layout-dir-dock) items-center gap-1 rounded-pill border border-line-subtle px-2 shadow-e3">
        {acts.map((scenario) => (
          <TrackedAct
            key={scenario.id}
            scenario={scenario}
            runId={runs[scenario.id]}
            launching={launching === scenario.id}
            onLaunch={() => start(scenario)}
          />
        ))}
        {!acts.some((s) => s.act === 7) && (
          <button
            type="button"
            onClick={() => navigate('/coverage')}
            title="Act 7: Coverage and close. Opens the ASI coverage view."
            className="inline-flex h-9 items-center rounded-pill px-3.5 text-sm font-semibold text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
          >
            Act 7
          </button>
        )}
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-line-default" />
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
          className="inline-flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-sm font-semibold text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
        >
          <Icon name="streamline:arrow-reload-horizontal-1" size={14} />
          {reset.isPending ? 'Resetting' : 'Reset scenario'}
        </button>
      </nav>
    </div>
  );
}
