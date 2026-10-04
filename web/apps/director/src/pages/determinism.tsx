import type { Decision } from '@betsee/api';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BoundaryVisual } from '../components/boundary.tsx';
import { Icon, type IconName } from '../components/icon.tsx';
import { EASE, Rise, Stagger, TONE_COLOR } from '../components/motion.tsx';
import { AgentGlyph, AnimatedNumber, Card, Code, controlHref, EmptyState, PageHeader, Section, Segmented, Skeleton, StatusBadge, type Tone } from '../components/ui.tsx';
import { decisionLabel } from '../domain/decision.ts';
import { determinismStats, repeatGroups, type RepeatGroup } from '../domain/determinism.ts';
import { formatCount } from '../domain/format.ts';
import { useActions, useMediaQuery } from '../hooks.ts';

const DECISION_TONE: Record<Decision, Tone> = { allow: 'ok', require_approval: 'wait', require_step_up: 'verify', deny: 'bad' };

function Figure({ icon, label, value, suffix, sub, tone }: { icon: IconName; label: string; value: number; suffix?: string; sub: string; tone: Tone }) {
  return (
    <Card spotlight className="h-full p-6">
      <p className="flex items-center gap-2.5 text-[14px] font-semibold text-ink-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px]" style={{ background: `color-mix(in srgb, ${TONE_COLOR[tone]} 12%, transparent)`, color: TONE_COLOR[tone] }}>
          <Icon name={icon} size={16} />
        </span>
        {label}
      </p>
      <p className="mt-5 text-[40px] leading-none font-bold tracking-[-0.03em] text-ink">
        <AnimatedNumber value={value} />
        {suffix && <span className="text-[22px] text-ink-3">{suffix}</span>}
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-3">{sub}</p>
    </Card>
  );
}

function RepeatRow({ group }: { group: RepeatGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="group row-hover grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-4 rounded-2xl px-4 py-4 text-left md:grid-cols-[40px_minmax(0,1.2fr)_minmax(0,1fr)_200px]">
        <AgentGlyph size={40} agentId={group.agent} />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-ink">{group.agent}</span>
          <span className="mt-0.5 block truncate text-[13px] text-ink-3">
            <span className="font-mono text-[12px] text-ink-2">{group.capability}</span> on {group.resource}
          </span>
        </span>
        <span className="hidden min-w-0 items-center gap-1 md:flex" aria-label={`${group.decisions.length} identical requests`}>
          {group.decisions.slice(-24).map((d, i) => (
            <motion.span
              key={d.traceId}
              title={decisionLabel[d.decision]}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 26, delay: i * 0.02 }}
              className="h-6 w-2 origin-bottom rounded-full"
              style={{ background: TONE_COLOR[DECISION_TONE[d.decision]], opacity: d.decision === 'allow' ? 0.7 : 1 }}
            />
          ))}
          <span className="ml-2 text-[13px] font-semibold text-ink-3 tabular-nums">x{group.decisions.length}</span>
        </span>
        <span className="flex items-center justify-end gap-2 text-[13px] font-semibold">
          {group.consistent ? (
            <StatusBadge outcome={{ tone: 'ok', label: 'Same every time', short: 'Consistent', waiting: false }} icon="equal" />
          ) : (
            <StatusBadge outcome={{ tone: 'wait', label: 'Changed with state', short: 'Changed', waiting: false }} icon="git-branch" />
          )}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
            <div className="px-4 pt-1 pb-5 md:pl-[76px]">
              <p className="text-[14px] leading-relaxed text-ink-2">
                {group.consistent
                  ? `All ${group.decisions.length} identical requests got the deterministic decision "${decisionLabel[group.decisions[0]!.decision]}".`
                  : 'The controls read state as well as the request: a tripped breaker, a spent budget or a quarantine changes the answer, and the deciding control says which.'}
              </p>
              {group.changedBy.length > 0 && (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                  Changed by
                  {group.changedBy.map((id) => (
                    <Code key={id} href={controlHref(id)}>
                      {id}
                    </Code>
                  ))}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {group.decisions.slice(-8).map((d, i) => (
                  <Link
                    key={d.traceId}
                    to={`/traces/${encodeURIComponent(d.traceId)}`}
                    className="press inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: TONE_COLOR[DECISION_TONE[d.decision]] }} />
                    Request {group.decisions.length - Math.min(8, group.decisions.length) + i + 1}
                  </Link>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Guarantee({ tone, icon, title, items }: { tone: Tone; icon: IconName; title: string; items: string[] }) {
  return (
    <Card className="h-full p-7">
      <p className="flex items-center gap-3 text-[16px] font-bold text-ink">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${TONE_COLOR[tone]} 12%, transparent)`, color: TONE_COLOR[tone] }}>
          <Icon name={icon} size={18} />
        </span>
        {title}
      </p>
      <ul className="mt-5 space-y-3.5">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
            <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} />
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}

type Show = 'all' | 'changed';

export function DeterminismPage() {
  const { actions, query } = useActions();
  const stats = useMemo(() => determinismStats(actions), [actions]);
  const repeats = useMemo(() => repeatGroups(actions), [actions]);
  const [show, setShow] = useState<Show>('all');
  // The boundary drawing needs room; on a phone the figures below tell the same story.
  const wide = useMediaQuery('(min-width: 768px)');
  const consistent = repeats.filter((g) => g.consistent).length;
  const shown = (show === 'changed' ? repeats.filter((g) => !g.consistent) : repeats).slice(0, 10);
  const share = repeats.length ? Math.round((consistent / repeats.length) * 100) : 100;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Determinism' }]}
        title="Determinism"
      />

      {query.isPending ? (
        <Skeleton className="h-[420px]" />
      ) : stats.total === 0 ? (
        <Card>
          <EmptyState icon="cpu" title="No decision yet" body="Launch Act 1 from the demo controls, or start an agent." />
        </Card>
      ) : (
        <Stagger className="space-y-16" step={0.1}>
          {wide && (
            <Rise>
              <Card className="overflow-hidden p-8 lg:p-10">
                <h2 className="mb-8 text-[20px] font-bold tracking-[-0.015em] text-ink">The boundary, live</h2>
                <BoundaryVisual stats={stats} />
              </Card>
            </Rise>
          )}

          <Rise>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              <Figure icon="scale" tone="accent" label="Decided by policy" value={stats.total} sub="Every decision started from the deterministic controls; none came from a model alone." />
              <Figure icon="sparkles" tone="ai" label="Tightened by AI" value={stats.tightened} sub={`AI analysis ran on ${formatCount(stats.analyzed)} requests and made these stricter.`} />
              <Figure icon="shield-check" tone="ok" label="Loosened by AI" value={stats.loosened} sub={stats.loosened ? 'A decision ended less strict than policy. Open Activity to inspect it.' : 'No decision ended less strict than its deterministic decision.'} />
              <Figure icon="user-star" tone="wait" label="Resolved by a person" value={stats.resolvedByPerson} sub="Approvals and step-ups a human decided; the Gateway records who." />
            </div>
          </Rise>

          <Rise>
            <Section
              title="Same request, same decision"
              hint={repeats.length ? `${consistent} of ${repeats.length} repeated requests always got the same answer (${share}%)` : 'No request repeated yet'}
              action={
                repeats.some((g) => !g.consistent) ? (
                  <Segmented
                    label="Show"
                    value={show}
                    onChange={setShow}
                    options={[
                      { value: 'all', label: 'All repeats' },
                      { value: 'changed', label: 'Changed with state' },
                    ]}
                  />
                ) : undefined
              }
            >
              <Card className="p-2">
                {shown.length ? (
                  <div className="divide-y divide-line/70">
                    <AnimatePresence initial={false}>
                      {shown.map((group) => (
                        <motion.div key={group.key} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                          <RepeatRow group={group} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                ) : (
                  <EmptyState icon="repeat" title="No request has repeated yet" body="When an agent asks for the same thing twice, the two decisions are compared here." />
                )}
              </Card>
            </Section>
          </Rise>

          <Rise>
            <div className="grid gap-5 md:grid-cols-2">
              <Guarantee
                tone="ai"
                icon="sparkles"
                title="What AI analysis can do"
                items={['Flag a request as suspicious or malicious, with its finding and model label shown.', 'Make a decision stricter: an allow can become an approval, a step-up or a deny.']}
              />
              <Guarantee
                tone="accent"
                icon="lock"
                title="What it cannot do"
                items={[
                  'Make any decision less strict: a deterministic deny stays a deny.',
                  'Remove a required approval or step-up; only a named person resolves those.',
                ]}
              />
            </div>
          </Rise>
        </Stagger>
      )}
    </div>
  );
}
