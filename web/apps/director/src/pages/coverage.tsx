import { useCoverage, useScenarios, type Coverage } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import { ActivityList } from '../components/activity.tsx';
import { Icon } from '../components/icon.tsx';
import { Rise, Stagger } from '../components/motion.tsx';
import { Card, Code, controlHref, EASE, EmptyState, ErrorCard, OutcomeBar, PageHeader, Skeleton, type Tone } from '../components/ui.tsx';
import { formatCount } from '../domain/format.ts';
import { notClaimed } from '../domain/not-claimed.ts';
import { useActions } from '../hooks.ts';

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

const SEGMENTS: { key: string; label: string; tone: Tone }[] = [
  { key: 'allow', label: 'allowed', tone: 'ok' },
  { key: 'require_approval', label: 'sent for approval', tone: 'wait' },
  { key: 'require_step_up', label: 'sent for step-up', tone: 'verify' },
  { key: 'deny', label: 'denied', tone: 'bad' },
];

const count = (row: Coverage, key: string) => {
  const value = row.decision_counts[key];
  return typeof value === 'number' ? value : 0;
};

/** Primitives ordered by how many of the row's controls they own: the dominant mitigation first. */
function rankedPrimitives(row: Coverage) {
  const weight = new Map<string, number>();
  for (const c of row.controls) weight.set(c.primitive, (weight.get(c.primitive) ?? 0) + 1);
  return [...row.primitives].sort((a, b) => (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0) || a.name.localeCompare(b.name));
}

function Ring({ value, total }: { value: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const ratio = total ? value / total : 0;
  return (
    <span className="flex items-center gap-4">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-sunken)" strokeWidth="6" />
        <motion.circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--color-ok)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - ratio) }}
          transition={{ duration: 0.9, ease: EASE }}
        />
      </svg>
      <span>
        <span className="block text-[28px] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
          {value}
          <span className="text-ink-3"> / {total}</span>
        </span>
        <span className="mt-1 block text-[13px] text-ink-3">risks evidenced this run</span>
      </span>
    </span>
  );
}

function RiskDetail({ row }: { row: Coverage }) {
  const { actions } = useActions();
  const ids = useMemo(() => new Set(row.controls.map((c) => c.id)), [row.controls]);
  const evidence = useMemo(() => actions.filter((t) => t.control_ids.some((id) => ids.has(id))), [actions, ids]);
  const limits = notClaimed(row.asi_id);
  return (
    <div className="space-y-8">
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <p className="text-[12px] font-medium text-ink-3">Mitigated by</p>
          <ul className="mt-3 space-y-2">
            {rankedPrimitives(row).map((p, i) => (
              <li key={p.id} className="flex items-center gap-2.5 text-[14px] text-ink">
                <span className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-accent' : 'bg-ink-4'}`} />
                {p.name}
                {i === 0 && <span className="text-[12px] text-ink-3">main</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[12px] font-medium text-ink-3">Enforced by {row.controls.length} controls</p>
          <ul className="mt-3 space-y-2">
            {row.controls.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center gap-2.5">
                <Code href={controlHref(c.id)} title={c.description}>
                  {c.id}
                </Code>
                <span className="truncate text-[14px] text-ink-2">{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {limits.length > 0 && (
        <div className="rounded-xl border border-dashed border-line-strong p-5">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
            <Icon name="info" size={14} />
            Not claimed in v0
          </p>
          <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink-2">
            {limits.map((item) => (
              <li key={item.mitigation}>
                <span className="text-ink">OWASP suggests {item.mitigation}.</span> {item.betsee}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="mb-2 text-[12px] font-medium text-ink-3">Evidence in the feed</p>
        <div className="-mx-4">
          <ActivityList actions={evidence} limit={6} empty={<p className="px-4 text-[14px] text-ink-3">No trace in the feed was decided by these controls yet.</p>} />
        </div>
      </div>
    </div>
  );
}

function RiskRow({ row, acts, open, onToggle }: { row: Coverage; acts: number[]; open: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();
  const total = SEGMENTS.reduce((sum, s) => sum + count(row, s.key), 0);
  const tightened = count(row, 'ai_tightened');
  const summary = SEGMENTS.filter((s) => count(row, s.key) > 0)
    .map((s) => `${formatCount(count(row, s.key))} ${s.label}`)
    .join(', ');
  return (
    <Rise as="li">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="group row-hover grid w-full grid-cols-[minmax(0,1fr)_24px] items-center gap-6 rounded-xl px-5 py-5 text-left md:grid-cols-[64px_minmax(0,1.4fr)_minmax(0,1fr)_96px_24px]"
      >
        <span className="hidden font-mono text-[12px] text-ink-3 md:block">{row.asi_id}</span>
        <span className="min-w-0">
          <span className="block text-[15px] font-medium text-ink">
            <span className="mr-2 font-mono text-[12px] text-ink-3 md:hidden">{row.asi_id}</span>
            {row.name}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-ink-3">{rankedPrimitives(row)[0]?.name ?? 'No primitive mapped'}</span>
        </span>
        <span className="hidden md:block">
          <OutcomeBar parts={SEGMENTS.map((s) => ({ tone: s.tone, value: count(row, s.key), label: s.label }))} />
          <span className="mt-2 block truncate text-[12px] text-ink-3 tabular-nums">
            {total ? summary : 'No evidence yet this run'}
            {tightened > 0 && <span className="text-ai-ink">, {formatCount(tightened)} tightened by AI</span>}
          </span>
        </span>
        <span className="hidden text-right text-[12px] text-ink-3 md:block">{acts.map((a) => `Act ${a}`).join(', ')}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: reduce ? 0 : 0.25, ease: EASE }} className="text-ink-3">
          <Icon name="chevron-down" size={18} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="px-5 pt-2 pb-8 md:pl-[108px]">
              <RiskDetail row={row} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Rise>
  );
}

export function CoveragePage() {
  const coverage = useCoverage();
  const scenarios = useScenarios();
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
    <div>
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Coverage' }]}
        title="Coverage"
        actions={rows.length > 0 ? <Ring value={evidenced} total={rows.length} /> : undefined}
      />
      {coverage.isPending && (
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {coverage.isError && <ErrorCard title="Could not load coverage" error={coverage.error} onRetry={() => void coverage.refetch()} />}
      {coverage.data && !rows.length && (
        <Card>
          <EmptyState icon="shield" title="No coverage data" body="The Gateway returned no risk mapping." />
        </Card>
      )}
      {rows.length > 0 && (
        <Card className="p-2">
          <Stagger as="ol" className="divide-y divide-line/70" step={0.045} delay={0.15}>
            {rows.map((row) => (
              <RiskRow key={row.asi_id} row={row} acts={acts[row.asi_id] ?? []} open={open === row.asi_id} onToggle={() => setOpen(open === row.asi_id ? null : row.asi_id)} />
            ))}
          </Stagger>
        </Card>
      )}
    </div>
  );
}
