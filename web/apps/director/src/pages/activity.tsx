import type { ActionSummary } from '@betsee/api';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { ActivityList } from '../components/activity.tsx';
import { Icon } from '../components/icon.tsx';
import { Card, ECOSYSTEM_URL, EmptyState, ErrorCard, PageHeader, Segmented, Skeleton, TextLink } from '../components/ui.tsx';
import { isAwaitingHuman, isObservation } from '../domain/decision.ts';
import { useActions } from '../hooks.ts';

type Show = 'all' | 'denied' | 'awaiting' | 'ai' | 'observed';

const FILTERS: { value: Show; label: string; test: (a: ActionSummary) => boolean }[] = [
  { value: 'all', label: 'Everything', test: () => true },
  { value: 'denied', label: 'Denied', test: (a) => !isObservation(a) && a.decision === 'deny' },
  { value: 'awaiting', label: 'Awaiting a human', test: (a) => !isObservation(a) && isAwaitingHuman(a) },
  { value: 'ai', label: 'Tightened by AI', test: (a) => !isObservation(a) && a.ai_tightened },
  { value: 'observed', label: 'Observed', test: (a) => isObservation(a) },
];

const EMPTY: Record<Show, string> = {
  all: 'No agent has acted yet. Launch Act 1 from the demo controls, or start an agent.',
  denied: 'Nothing was denied in the feed.',
  awaiting: 'No action is waiting for a person.',
  ai: 'AI analysis has not tightened any decision in the feed.',
  observed: 'The Gateway has not reported an observation.',
};

export function ActivityPage() {
  const { actions, query } = useActions();
  const [params, setParams] = useSearchParams();
  const show = (FILTERS.some((f) => f.value === params.get('show')) ? params.get('show') : 'all') as Show;
  const agent = params.get('agent');

  const scoped = useMemo(() => (agent ? actions.filter((a) => a.agent.id === agent) : actions), [actions, agent]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, scoped.filter(f.test).length])) as Record<Show, number>, [scoped]);
  const shown = useMemo(() => scoped.filter(FILTERS.find((f) => f.value === show)!.test), [scoped, show]);

  const update = (next: { show?: Show; agent?: string | null }) => {
    const out = new URLSearchParams(params);
    if (next.show !== undefined) {
      if (next.show === 'all') out.delete('show');
      else out.set('show', next.show);
    }
    if (next.agent === null) out.delete('agent');
    setParams(out, { replace: true });
  };

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Activity' }]}
        title="Live activity"
        description="Every request an agent made, as the Gateway decided it, newest first. Open any row to see who asked, why, and which control decided."
        actions={show === 'awaiting' ? <TextLink href={`${ECOSYSTEM_URL}/approvals`}>Open approvals</TextLink> : undefined}
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented label="Show" value={show} onChange={(value) => update({ show: value })} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />
        {agent && (
          <button
            type="button"
            onClick={() => update({ agent: null })}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium text-ink shadow-card transition-colors hover:bg-hover"
          >
            Agent {agent}
            <Icon name="x" size={13} className="text-ink-3" />
          </button>
        )}
      </div>
      <Card className="p-2">
        {query.isPending ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : query.isError && !query.data ? (
          <ErrorCard title="Could not load activity" error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <ActivityList actions={shown} empty={<EmptyState icon="activity" title="Nothing here" body={EMPTY[show]} />} />
        )}
      </Card>
      <p className="mt-5 flex items-center gap-2 px-2 text-[13px] text-ink-3">
        <Icon name="info" size={14} />
        Every row is a request the Gateway decided or an event it observed. Repeats within two seconds fold into one row.
      </p>
    </div>
  );
}
