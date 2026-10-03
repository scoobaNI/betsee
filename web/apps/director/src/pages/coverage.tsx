import { useCoverage, useScenarios, useTraces, type ActionSummary, type Coverage } from '@betsee/api';
import { DecisionChip, IdToken } from '@betsee/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ECOSYSTEM_URL } from '../components/shell.tsx';
import { ErrorCard, Skeleton } from '../components/states.tsx';
import { resolutionOf } from '../domain/decision.ts';
import { formatCount, formatTime } from '../domain/format.ts';
import { notClaimed } from '../domain/not-claimed.ts';

// docs/demo-script.md, "ASI coverage by act"; the runner's scenario list overrides it when present.
const SCRIPT_ACTS: Record<string, number[]> = {
  ASI01: [3],
  ASI02: [2],
  ASI03: [2, 5],
  ASI04: [6],
  ASI05: [2],
  ASI06: [3],
  ASI07: [4],
  ASI08: [4],
  ASI09: [5],
  ASI10: [6],
};

const SEGMENTS = [
  { key: 'allow', label: 'Allowed', className: 'bg-viz-allow' },
  { key: 'deny', label: 'Denied', className: 'bg-viz-deny' },
  { key: 'require_approval', label: 'Approval', className: 'bg-viz-approval' },
  { key: 'require_step_up', label: 'Step-up', className: 'bg-viz-stepup' },
] as const;

const MAX_PRIMITIVES = 3;
const MAX_CONTROLS = 6;

/** Primitives ordered by how many of the row's controls they own: the dominant mitigation first. */
function rankedPrimitives(row: Coverage) {
  const weight = new Map<string, number>();
  for (const c of row.controls) weight.set(c.primitive, (weight.get(c.primitive) ?? 0) + 1);
  return [...row.primitives].sort((a, b) => (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0) || a.name.localeCompare(b.name));
}

const count = (row: Coverage, key: string) => {
  const value = row.decision_counts[key];
  return typeof value === 'number' ? value : 0;
};

function EvidenceBar({ row }: { row: Coverage }) {
  const total = SEGMENTS.reduce((sum, s) => sum + count(row, s.key), 0);
  const tightened = count(row, 'ai_tightened');
  if (total === 0) {
    return (
      <div className="space-y-1">
        <div className="dir-hatch-empty h-2 rounded-xs" />
        <p className="text-xs text-fg-tertiary">No evidence yet this run</p>
      </div>
    );
  }
  const summary = SEGMENTS.filter((s) => count(row, s.key) > 0)
    .map((s) => `${formatCount(count(row, s.key))} ${s.label.toLowerCase()}`)
    .join(', ');
  return (
    <div className="space-y-1">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-xs" role="img" aria-label={summary}>
        {SEGMENTS.map((s) =>
          count(row, s.key) > 0 ? <span key={s.key} title={`${s.label}: ${count(row, s.key)}`} className={s.className} style={{ flexGrow: count(row, s.key) }} /> : null,
        )}
      </div>
      <p className="text-xs tabular-nums text-fg-secondary">
        {summary}
        {tightened > 0 && <span className="text-tightened-fg">, {formatCount(tightened)} AI-tightened</span>}
      </p>
    </div>
  );
}

function Evidence({ row, traces }: { row: Coverage; traces: ActionSummary[] }) {
  const ids = new Set(row.controls.map((c) => c.id));
  const matching = traces.filter((t) => t.control_ids.some((id) => ids.has(id))).slice(0, 6);
  if (!matching.length) return <p className="px-4 pb-4 text-sm text-fg-tertiary">No trace in the feed was decided by these controls yet.</p>;
  return (
    <ul className="space-y-1 px-2 pb-3">
      {matching.map((t) => (
        <li key={t.trace_id}>
          <Link to={`/traces/${encodeURIComponent(t.trace_id)}`} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
            <span className="font-mono text-2xs text-fg-tertiary">{formatTime(t.occurred_at)}</span>
            <span className="font-mono">{t.agent.id}</span>
            <span className="font-mono text-fg-secondary">{t.capability}</span>
            <span className="text-xs text-fg-tertiary">{t.control_ids.filter((id) => ids.has(id)).join(', ')}</span>
            <span className="ml-auto">
              <DecisionChip decision={t.decision} resolution={resolutionOf(t)} aiTightened={t.ai_tightened} modelLabel={t.analyzer.model_label} size="sm" variant="compact" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NotClaimedBlock({ asiId }: { asiId: string }) {
  const items = notClaimed(asiId);
  if (!items.length) return null;
  return (
    <div className="mx-4 mb-3 rounded-md border border-dashed border-line-default p-3">
      <p className="text-xs font-semibold text-fg-secondary">Not claimed in v0</p>
      <ul className="mt-1.5 space-y-1.5 text-sm text-fg-secondary">
        {items.map((item) => (
          <li key={item.mitigation}>
            <span className="text-fg-primary">OWASP: {item.mitigation}.</span> {item.betsee}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoveragePage() {
  const coverage = useCoverage();
  const scenarios = useScenarios();
  const traces = useTraces();
  const [open, setOpen] = useState<string | null>(null);

  const acts = useMemo(() => {
    if (!scenarios.data?.length) return SCRIPT_ACTS;
    const map: Record<string, number[]> = {};
    for (const s of scenarios.data) for (const asi of s.asi) map[asi] = [...new Set([...(map[asi] ?? []), s.act])].sort();
    return map;
  }, [scenarios.data]);

  const rows = coverage.data ?? [];
  const evidenced = rows.filter((r) => r.evidence_count > 0).length;

  return (
    <div className="space-y-5">
      <header className="flex items-end gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-[var(--bs-font-tracking-display)]">ASI coverage</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            OWASP Agentic Top 10: which primitive mitigates each risk, the controls that enforce it, and the evidence from this run.
          </p>
        </div>
        {rows.length > 0 && (
          <p className="ml-auto shrink-0 whitespace-nowrap text-sm tabular-nums text-fg-secondary">
            <span className="font-display text-2xl font-semibold text-fg-primary">{evidenced}</span> of {rows.length} risks evidenced this run
          </p>
        )}
      </header>

      {coverage.isPending && (
        <div className="space-y-2">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {coverage.isError && <ErrorCard title="Could not load coverage" error={coverage.error} onRetry={() => void coverage.refetch()} />}

      <ol className="space-y-2">
        {rows.map((row) => {
          const expanded = open === row.asi_id;
          return (
            <li key={row.asi_id} className="rounded-lg border border-line-subtle bg-surface-1 shadow-e1">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                // The whole row toggles; only a real link inside it (a CTL id) keeps its own click.
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('a')) setOpen(expanded ? null : row.asi_id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpen(expanded ? null : row.asi_id);
                  }
                }}
                className="grid w-full cursor-pointer grid-cols-[minmax(220px,1.1fr)_minmax(260px,1.4fr)_minmax(220px,1fr)_72px] items-center gap-5 rounded-lg p-4 text-left hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="font-mono text-xs text-fg-secondary">{row.asi_id}</span>
                  <span className="block text-md font-semibold">{row.name}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {rankedPrimitives(row)
                      .slice(0, MAX_PRIMITIVES)
                      .map((p) => (
                        <span key={p.id} className="rounded-xs bg-surface-3 px-1.5 py-0.5 text-xs text-fg-secondary">
                          {p.name}
                        </span>
                      ))}
                    {row.primitives.length > MAX_PRIMITIVES && (
                      <span
                        title={rankedPrimitives(row)
                          .slice(MAX_PRIMITIVES)
                          .map((p) => p.name)
                          .join(', ')}
                        className="px-1 py-0.5 text-xs text-fg-tertiary"
                      >
                        +{row.primitives.length - MAX_PRIMITIVES}
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {row.controls.slice(0, MAX_CONTROLS).map((c) => (
                    <span key={c.id} title={`${c.name}: ${c.description}`}>
                      <IdToken id={c.id} href={`${ECOSYSTEM_URL}/policy-studio/controls/${encodeURIComponent(c.id)}`} copy={false} />
                    </span>
                  ))}
                  {row.controls.length > MAX_CONTROLS && (
                    <span title={row.controls.slice(MAX_CONTROLS).map((c) => c.id).join(', ')} className="px-1 py-0.5 font-mono text-xs text-fg-tertiary">
                      +{row.controls.length - MAX_CONTROLS}
                    </span>
                  )}
                </span>
                <EvidenceBar row={row} />
                <span className="text-right text-xs text-fg-secondary">{(acts[row.asi_id] ?? []).map((a) => `Act ${a}`).join(', ')}</span>
              </div>
              {expanded && (
                <>
                  <NotClaimedBlock asiId={row.asi_id} />
                  <Evidence row={row} traces={traces.data ?? []} />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
