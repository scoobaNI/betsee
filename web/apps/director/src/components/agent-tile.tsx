import type { ActionSummary, Agent } from '@betsee/api';
import { DecisionChip, IdToken, LifecycleBadge } from '@betsee/ui';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { resolutionOf } from '../domain/decision.ts';
import { teamName } from '../domain/feed.ts';
import { formatCents, formatTime } from '../domain/format.ts';
import { AgentMark, HumanAvatar } from './marks.tsx';
import { ReasonText } from './reason.tsx';

const MAX_CAPABILITIES = 4;
// Budgets arrive in cents; the demo use cases price in EUR (payment threshold 10,000.00 EUR).
const BUDGET_CURRENCY = 'EUR';

function BudgetMeter({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const fill = ratio >= 1 ? 'bg-deny-fg' : ratio >= 0.8 ? 'bg-approval-fg' : 'bg-brand-500';
  return (
    <div className="flex items-center gap-3">
      <div className="h-1 flex-1 overflow-hidden rounded-pill bg-surface-inset" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label="Session budget">
        <div className={`h-full rounded-pill ${fill}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="shrink-0 text-xs tabular-nums text-fg-secondary">
        Budget {formatCents(used)} / {formatCents(limit)} {BUDGET_CURRENCY}
      </p>
    </div>
  );
}

/** Fires a one-shot class when `value` changes after mount, e.g. the glow when the agent acts. */
function useOneShot(value: string | undefined, durationMs = 600) {
  const first = useRef(true);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!value) return;
    setOn(true);
    const timer = setTimeout(() => setOn(false), durationMs);
    return () => clearTimeout(timer);
  }, [value, durationMs]);
  return on;
}

export function AgentTile({ agent, recent, selected }: { agent: Agent; recent: ActionSummary[]; selected: boolean }) {
  const session = agent.current_session;
  const effective = session?.effective ?? [];
  const shown = effective.slice(0, MAX_CAPABILITIES);
  const hidden = effective.slice(MAX_CAPABILITIES);
  const acted = useOneShot(recent.at(-1)?.trace_id);
  const quarantinedNow = useOneShot(agent.state === 'quarantined' ? agent.state_changed_at ?? 'q' : undefined);
  const dimmed = agent.state === 'quarantined' ? 'opacity-70' : agent.state === 'suspended' ? 'opacity-55' : '';

  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.id)}`}
      aria-label={`${agent.id}, ${agent.state}`}
      className={`relative block w-73 shrink-0 overflow-hidden rounded-lg border bg-surface-1 p-4 shadow-e1 hover:bg-surface-2 hover:shadow-e2 ${
        agent.state === 'quarantined' ? 'dir-quarantined border-quarantined-border' : agent.state === 'suspended' ? 'dir-suspended border-suspended-border' : 'border-line-subtle'
      } ${selected ? 'shadow-selected' : ''} ${quarantinedNow ? 'dir-quarantine-ring' : ''}`}
    >
      <div className="flex items-center gap-2">
        <AgentMark state={agent.state} className={acted && agent.state === 'active' ? 'dir-act-glow' : ''} />
        <span className="shrink-0 font-mono text-sm font-medium">{agent.id}</span>
        {agent.state === 'active' && <LifecycleBadge state="active" className="ml-auto" />}
      </div>
      {agent.state !== 'active' && (
        // The reason carries the act 4 versus act 6 difference: its own full-width row, never clamped.
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <LifecycleBadge state={agent.state} className="shrink-0" />
            {agent.state_changed_at && <span className="font-mono text-2xs tabular-nums text-fg-tertiary">{formatTime(agent.state_changed_at)}</span>}
          </div>
          {agent.state_reason && (
            <p className={`text-xs ${agent.state === 'quarantined' ? 'text-quarantined-fg' : 'text-suspended-fg'}`}>
              <ReasonText text={agent.state_reason} linked={false} />
            </p>
          )}
        </div>
      )}
      <div className={dimmed}>
        {agent.state === 'active' ? (
          <p className="mt-2 truncate text-xs text-fg-secondary" title={`${teamName(agent.team)} - ${agent.provider} ${agent.model}`}>
            {teamName(agent.team)} - {agent.provider} <span className="whitespace-nowrap font-mono">{agent.model}</span>
          </p>
        ) : null}
        <p className="mt-2 flex min-w-0 items-center gap-2 text-sm">
          {session ? (
            <>
              <HumanAvatar name={session.human.display_name} size="xs" />
              <span className="shrink-0">{session.human.display_name}</span>
              <span className="truncate text-fg-secondary">for {session.use_case.name}</span>
            </>
          ) : (
            <span className="text-fg-tertiary">No active session</span>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {shown.map((capability) => (
            <IdToken key={capability} copy={false} className="text-2xs">
              {capability}
            </IdToken>
          ))}
          {hidden.length > 0 && (
            <span title={hidden.join(', ')} className="rounded-xs px-1 font-mono text-2xs text-fg-secondary">
              +{hidden.length}
            </span>
          )}
          {session && effective.length === 0 && <span className="text-xs text-fg-tertiary">No effective capability</span>}
        </div>
        <div className="mt-2">
          <BudgetMeter used={agent.budget.used} limit={agent.budget.limit} />
        </div>
        <div className="mt-2 flex h-3.5 items-end gap-0.75" aria-label={`Last ${recent.length} decisions`}>
          {recent.map((action) => (
            <DecisionChip
              key={action.trace_id}
              variant="tick"
              decision={action.decision}
              resolution={resolutionOf(action)}
              aiTightened={action.ai_tightened}
              modelLabel={action.analyzer.model_label}
              controlIds={action.control_ids}
            />
          ))}
          {recent.length === 0 && <span className="text-2xs text-fg-tertiary">No actions yet</span>}
        </div>
      </div>
    </Link>
  );
}
