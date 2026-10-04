import { useAgents, useMe, type ActionSummary, type Tier } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccess, useApplyAccess } from '../access.ts';
import { AccessMatrix } from '../components/access-matrix.tsx';
import { Suggestions } from '../components/access-suggestions.tsx';
import { Icon, type IconName } from '../components/icon.tsx';
import { Burst, EASE, Rise, SPRING, Stagger, TONE_COLOR } from '../components/motion.tsx';
import { notify } from '../components/toasts.tsx';
import { AnimatedNumber, Avatar, Card, EmptyState, ErrorCard, PageHeader, Section, Skeleton } from '../components/ui.tsx';
import {
  changeKey,
  describe,
  preview,
  stage,
  suggestAccess,
  TIERS,
  type AccessChange,
  type AccessChangeRequest,
  type AccessSnapshot,
  type PersonAccess,
  type Staged,
  type Suggestion,
} from '../domain/access.ts';
import { formatAge } from '../domain/format.ts';
import { personByName } from '../domain/people.ts';
import { useActions, useNow } from '../hooks.ts';

const HOUR = 60 * 60_000;
const DISMISSED_KEY = 'betsee.director.access.dismissed';

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage blocked (private window): dismissals last for this visit only.
  }
}

function Stat({ icon, label, value, tone = 'accent' }: { icon: IconName; label: string; value: number; tone?: 'accent' | 'ai' | 'wait' | 'ok' }) {
  const tint = { accent: 'bg-accent-soft text-accent-ink', ai: 'bg-ai-soft text-ai-ink', wait: 'bg-wait-soft text-wait-ink', ok: 'bg-ok-soft text-ok-ink' }[tone];
  return (
    <Card className="flex items-center gap-4 p-5">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tint}`}>
        <Icon name={icon} size={20} />
      </span>
      <span className="min-w-0">
        <span className="block text-[28px] leading-none font-bold tracking-[-0.03em] text-ink">
          <AnimatedNumber value={value} />
        </span>
        <span className="mt-1 block truncate text-[13px] font-medium text-ink-3">{label}</span>
      </span>
    </Card>
  );
}

function Switch({ on, staged, disabled, label, onToggle }: { on: boolean; staged: boolean; disabled?: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`press relative flex h-7 w-12 shrink-0 items-center rounded-full px-0.5 transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-ok' : 'bg-ink-4'} ${
        staged ? `staged-pulse ring-2 ring-offset-2 ring-offset-surface ${on ? 'ring-ok' : 'ring-bad'}` : ''
      }`}
    >
      <motion.span layout transition={SPRING} className={`h-6 w-6 rounded-full bg-white shadow-card ${on ? 'ml-auto' : ''}`} />
    </button>
  );
}

/** Four notches from public to restricted; the thumb slides, and a staged value shows what it was. */
function TierSlider({ sub, value, current, disabled, onChange }: { sub: string; value: Tier | null; current: Tier | null; disabled: boolean; onChange: (tier: Tier) => void }) {
  const changed = value !== current;
  return (
    <div>
      <div role="radiogroup" aria-label="Tier ceiling" className={`relative grid grid-cols-4 gap-1 rounded-[14px] bg-sunken p-1 ${disabled ? 'opacity-50' : ''}`}>
        {TIERS.map((tier, i) => {
          const selected = tier === value;
          const within = value !== null && i <= TIERS.indexOf(value);
          return (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(tier)}
              className={`relative z-[1] h-8 rounded-[10px] text-[12px] font-semibold capitalize transition-colors disabled:cursor-not-allowed ${selected ? 'text-white' : within ? 'text-accent-ink' : 'text-ink-3 hover:text-ink'}`}
            >
              {selected && (
                <motion.span
                  layoutId={`tier-thumb-${sub}`}
                  transition={SPRING}
                  className={`absolute inset-0 -z-[1] rounded-[10px] bg-accent shadow-card ${changed ? 'staged-pulse ring-2 ring-wait ring-offset-1 ring-offset-sunken' : ''}`}
                />
              )}
              {tier}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 h-4 text-[12px] text-ink-3">
        {disabled ? 'Not exposed by the Gateway' : changed && current ? `Was ${current}; staged` : 'Caps every session they start'}
      </p>
    </div>
  );
}

function PersonCard({
  person,
  next,
  staged,
  stats,
  focused,
  applied,
  onStage,
}: {
  person: PersonAccess;
  next: PersonAccess;
  staged: Staged;
  stats: { chats: number; flagged: number; aboveTier: number };
  focused: boolean;
  applied: boolean;
  onStage: (r: AccessChangeRequest) => void;
}) {
  const directory = personByName(person.display_name);
  const deskStaged = staged.has(changeKey({ kind: 'person_desk', sub: person.sub, enabled: true }));
  return (
    <motion.div
      layout
      className={`relative rounded-[22px] border bg-surface p-5 shadow-card transition-[box-shadow,border-color] duration-300 ${focused ? 'border-ai/40 ring-4 ring-ai-soft' : 'border-line'}`}
    >
      <Burst trigger={applied ? 'applied' : undefined} onMount color={TONE_COLOR.accent} radius="22px" strength={1.04} />
      <div className="flex items-center gap-3">
        <Avatar name={person.display_name} size={48} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold tracking-[-0.015em] text-ink">{person.display_name}</span>
          <span className="block truncate text-[13px] text-ink-3">{directory?.title ?? person.sub}</span>
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Chat requests', value: stats.chats, cls: 'text-ink' },
          { label: 'Flagged by AI', value: stats.flagged, cls: stats.flagged ? 'text-ai-ink' : 'text-ink' },
          { label: 'Above tier', value: stats.aboveTier, cls: stats.aboveTier ? 'text-bad-ink' : 'text-ink' },
        ].map((s) => (
          <span key={s.label} className="rounded-xl bg-sunken/70 px-2 py-2">
            <span className={`block text-[18px] leading-none font-bold ${s.cls}`}>
              <AnimatedNumber value={s.value} />
            </span>
            <span className="mt-1 block truncate text-[11px] font-medium text-ink-3">{s.label}</span>
          </span>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-line p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
          <Icon name="chat" size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-ink">Betsee Desk</span>
          <span className="block truncate text-[12px] text-ink-3">
            {next.desk === null ? 'Not exposed by the Gateway' : next.desk ? 'May chat with the assistant' : 'Off: open chats end, new ones are refused'}
          </span>
        </span>
        <Switch
          on={next.desk ?? true}
          staged={deskStaged}
          disabled={person.desk === null}
          label={`Betsee Desk for ${person.display_name}`}
          onToggle={() => onStage({ kind: 'person_desk', sub: person.sub, enabled: !(next.desk ?? true) })}
        />
      </div>
      <div className="mt-4">
        <p className="mb-2 text-[12px] font-bold tracking-[0.06em] text-ink-3 uppercase">Tier ceiling</p>
        <TierSlider sub={person.sub} value={next.tier_ceiling} current={person.tier_ceiling} disabled={person.tier_ceiling === null} onChange={(tier) => onStage({ kind: 'person_tier', sub: person.sub, tier_ceiling: tier })} />
      </div>
    </motion.div>
  );
}

/** The staged changes, sliding up from the bottom: review, give a reason, apply in one batch. */
function ChangeTray({
  staged,
  nameOf,
  writable,
  actor,
  pending,
  onUnstage,
  onDiscard,
  onApply,
}: {
  staged: Staged;
  nameOf: (sub: string) => string;
  writable: boolean;
  actor: string;
  pending: boolean;
  onUnstage: (key: string) => void;
  onDiscard: () => void;
  onApply: (reason: string) => void;
}) {
  const reduce = useReducedMotion();
  const [reason, setReason] = useState('');
  const apply = useCallback(() => {
    if (!writable || pending) return;
    onApply(reason.trim());
    setReason('');
  }, [writable, pending, onApply, reason]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') apply();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply]);
  const entries = [...staged.entries()];
  return (
    <motion.div
      role="region"
      aria-label="Staged access changes"
      initial={reduce ? { opacity: 0 } : { y: 140, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { y: 140, opacity: 0, transition: { duration: 0.3, ease: EASE } }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="glass fixed bottom-24 left-1/2 z-40 w-[min(820px,calc(100vw-32px))] -translate-x-1/2 rounded-[26px] p-4 shadow-pop lg:bottom-6"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-accent px-2 text-[14px] font-bold text-white">
          <AnimatedNumber value={staged.size} />
        </span>
        <span className="text-[15px] font-bold text-ink">{staged.size === 1 ? 'change staged' : 'changes staged'}</span>
        <span className="ml-auto text-[12.5px] text-ink-3">Applied as {actor}</span>
      </div>
      <ul className="scrollbar-quiet mt-3 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
        <AnimatePresence mode="popLayout" initial={false}>
          {entries.map(([key, r]) => {
            const d = describe(r, nameOf);
            const tone = d.sign === '+' ? 'bg-ok-soft text-ok-ink' : d.sign === '-' ? 'bg-bad-soft text-bad-ink' : 'bg-wait-soft text-wait-ink';
            return (
              <motion.li
                key={key}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={SPRING}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full pr-1 pl-3 text-[13px] font-semibold ${tone}`}
              >
                <span className="font-mono text-[14px]">{d.sign === '~' ? '~' : d.sign}</span>
                {d.text}
                <button type="button" onClick={() => onUnstage(key)} aria-label={`Undo: ${d.text}`} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/5">
                  <Icon name="x" size={12} />
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason, recorded with the change"
          aria-label="Reason"
          className="h-10 w-full min-w-0 rounded-xl border sm:flex-1 border-line bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-4 focus:border-accent/50 focus:ring-4 focus:ring-accent-soft"
        />
        <span className="flex gap-2">
          <button type="button" onClick={onDiscard} className="press h-10 flex-1 rounded-xl px-4 text-[14px] font-semibold text-ink-2 hover:bg-hover sm:flex-none">
            Discard
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!writable || pending}
            title={writable ? 'Apply (Ctrl or Cmd + Enter)' : 'The live Gateway has no write API for access yet (proposed: POST /api/v1/access/changes)'}
            className="press inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[14px] font-semibold text-white shadow-card transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            {pending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Icon name="shield-check" size={15} />}
            Apply {staged.size === 1 ? 'change' : `${staged.size} changes`}
          </button>
        </span>
      </div>
      {!writable && <p className="mt-2 text-[12.5px] text-ink-3">The live Gateway has no write API for access yet, so changes can be staged and reviewed but not applied.</p>}
    </motion.div>
  );
}

function History({ changes, nameOf }: { changes: AccessChange[]; nameOf: (sub: string) => string }) {
  const now = useNow(15_000);
  if (!changes.length) return <EmptyState icon="clock" title="No access changes yet" body="Grants, revokes, suspensions and tier changes land here with who made them and why." />;
  return (
    <ol className="relative space-y-1 pl-2">
      <span aria-hidden="true" className="absolute top-3 bottom-3 left-[27px] w-px bg-line" />
      <AnimatePresence initial={false}>
        {changes.slice(0, 20).map((c) => {
          const d = describe(c.request, nameOf);
          const tone = d.sign === '+' ? 'bg-ok text-white' : d.sign === '-' ? 'bg-bad text-white' : 'bg-wait text-white';
          return (
            <motion.li
              key={c.id}
              layout
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              transition={{ duration: 0.4, ease: EASE }}
              className="relative flex gap-4 rounded-2xl p-3 hover:bg-hover"
            >
              <span className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface ${tone}`}>
                <Icon name={d.sign === '+' ? 'check' : d.sign === '-' ? 'ban' : 'layers'} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[14.5px] font-semibold text-ink">{d.text}</span>
                  {c.suggestion_id && (
                    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-ai-soft px-1.5 text-[11px] font-bold text-ai-ink">
                      <Icon name="sparkles" size={10} />
                      Suggested
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[13px] text-ink-3">
                  <span className="font-mono text-[12px]">{c.before}</span> <Icon name="arrow-right" size={11} className="inline" /> <span className="font-mono text-[12px] text-ink-2">{c.after}</span>
                </span>
                {c.reason && <span className="mt-1 block text-[13px] text-ink-2 italic">"{c.reason}"</span>}
              </span>
              <span className="flex shrink-0 items-start gap-2 text-[12.5px] text-ink-3">
                <Avatar name={c.actor.display_name} size={22} />
                <span className="hidden sm:inline">{c.actor.display_name},</span>
                {formatAge(c.at, now)}
              </span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

function usageOf(actions: readonly ActionSummary[], now: number) {
  const usage = new Map<string, Map<string, number>>();
  for (const a of actions) {
    if (now - Date.parse(a.occurred_at) > HOUR || a.decision === 'deny') continue;
    const row = usage.get(a.agent.id) ?? new Map<string, number>();
    row.set(a.capability, (row.get(a.capability) ?? 0) + 1);
    usage.set(a.agent.id, row);
  }
  return usage;
}

function personStats(actions: readonly ActionSummary[], snapshot: AccessSnapshot, now: number) {
  const chatAgents = new Set(snapshot.agents.filter((a) => a.use_case.id === 'employee-assistance').map((a) => a.agent_id));
  const out = new Map<string, { chats: number; flagged: number; aboveTier: number }>();
  for (const a of actions) {
    if (!a.human || !chatAgents.has(a.agent.id) || now - Date.parse(a.occurred_at) > HOUR) continue;
    const s = out.get(a.human.sub) ?? { chats: 0, flagged: 0, aboveTier: 0 };
    s.chats++;
    if (a.ai_tightened) s.flagged++;
    if (a.control_ids.includes('CTL-TIER-001')) s.aboveTier++;
    out.set(a.human.sub, s);
  }
  return out;
}

/**
 * Who may do what, and the director's hand on it: grant and revoke agents' capabilities, suspend
 * agents, switch Betsee Desk off for a person or lower their tier ceiling, all staged and applied in
 * one batch with a reason. Suggestions come from AI analysis findings and denials in the feed.
 */
export function AccessPage() {
  const { snapshot, writable, isPending, error, refetch } = useAccess();
  const { actions } = useActions();
  const agents = useAgents();
  const me = useMe();
  const now = useNow(15_000);
  const apply = useApplyAccess();
  const [staged, setStaged] = useState<Map<string, AccessChangeRequest>>(new Map());
  const [sources, setSources] = useState<Map<string, string>>(new Map());
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [focus, setFocus] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const nameOf = useCallback((sub: string) => snapshot?.people.find((p) => p.sub === sub)?.display_name ?? sub, [snapshot]);
  const suggestions = useMemo(() => (snapshot ? suggestAccess(snapshot, actions, now).filter((s) => !dismissed.has(s.id)) : []), [snapshot, actions, now, dismissed]);
  const usage = useMemo(() => usageOf(actions, now), [actions, now]);
  const stats = useMemo(() => (snapshot ? personStats(actions, snapshot, now) : new Map()), [actions, snapshot, now]);
  const owners = useMemo(() => new Map((agents.data ?? []).map((a) => [a.id, a.current_session?.human.display_name ?? ''])), [agents.data]);
  const next = useMemo(() => (snapshot ? preview(snapshot, staged) : undefined), [snapshot, staged]);

  useEffect(() => {
    if (!applied.size) return;
    const timer = setTimeout(() => setApplied(new Set()), 1_600);
    return () => clearTimeout(timer);
  }, [applied]);

  const onStage = useCallback(
    (r: AccessChangeRequest) => {
      if (!snapshot) return;
      setStaged((prev) => stage(snapshot, prev, r));
    },
    [snapshot],
  );
  const isStaged = (s: Suggestion) => s.changes.every((c) => staged.get(changeKey(c)) && JSON.stringify(staged.get(changeKey(c))) === JSON.stringify(c));
  const stageSuggestion = (s: Suggestion) => {
    if (!snapshot) return;
    if (isStaged(s)) {
      setStaged((prev) => {
        const out = new Map(prev);
        for (const c of s.changes) out.delete(changeKey(c));
        return out;
      });
      return;
    }
    setStaged((prev) => s.changes.reduce((acc, c) => stage(snapshot, acc, c), new Map(prev)));
    setSources((prev) => {
      const out = new Map(prev);
      for (const c of s.changes) out.set(changeKey(c), s.id);
      return out;
    });
  };
  const dismiss = (s: Suggestion) =>
    setDismissed((prev) => {
      const out = new Set(prev).add(s.id);
      writeDismissed(out);
      return out;
    });
  const unstage = (key: string) =>
    setStaged((prev) => {
      const out = new Map(prev);
      out.delete(key);
      return out;
    });
  const applyStaged = (reason: string) => {
    const keys = [...staged.keys()];
    const fromSuggestions = new Set(keys.map((k) => sources.get(k)).filter(Boolean) as string[]);
    const suggestionId = fromSuggestions.size === 1 && keys.every((k) => sources.has(k)) ? [...fromSuggestions][0] : undefined;
    apply.mutate(
      { changes: [...staged.values()], reason, suggestionId },
      {
        onSuccess: ({ items }) => {
          setApplied(new Set(keys));
          setStaged(new Map());
          setSources(new Map());
          notify({
            key: 'access',
            tone: 'ok',
            icon: 'shield-check',
            title: items.length === 1 ? 'Access change applied' : `${items.length} access changes applied`,
            body: items.map((c) => describe(c.request, nameOf).text).join('; '),
            to: '/access',
          });
        },
        onError: (e) => notify({ key: 'access', tone: 'bad', icon: 'alert', title: 'Access changes not applied', body: e instanceof Error ? e.message : 'The request failed.', to: '/access' }),
      },
    );
  };

  const delegatedCount = snapshot?.agents.reduce((n, a) => n + a.effective.length, 0) ?? 0;
  const unused = snapshot?.agents.reduce((n, a) => n + a.effective.filter((c) => !usage.get(a.agent_id)?.get(c)).length, 0) ?? 0;
  const flagged = actions.filter((a) => a.ai_tightened && now - Date.parse(a.occurred_at) <= HOUR).length;

  return (
    <div className={staged.size ? 'pb-56' : ''}>
      <PageHeader
        crumbs={[{ label: 'Overview', to: '/' }, { label: 'Access' }]}
        title="Access"
        actions={
          <span className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3.5 pl-1 text-[13px] font-semibold text-ink-2 shadow-card">
            <Avatar name={me.data?.human.display_name ?? 'Daniel Ortiz'} size={26} />
            {me.data?.human.display_name ?? 'Signed in'}
            {!writable && <span className="ml-1 rounded-full bg-sunken px-2 py-0.5 text-[11.5px] text-ink-3">Review only</span>}
          </span>
        }
      />
      {isPending ? (
        <Skeleton className="h-[640px]" />
      ) : error || !snapshot || !next ? (
        <ErrorCard title="Could not load access" error={error} onRetry={refetch} />
      ) : (
        <Stagger className="space-y-14" step={0.07}>
          <Rise>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat icon="key" label="Capabilities delegated" value={delegatedCount} />
              <Stat icon="pause" label="Unused this hour" value={unused} tone="wait" />
              <Stat icon="sparkles" label="Flagged by AI this hour" value={flagged} tone="ai" />
              <Stat icon="checks" label="Access changes made" value={snapshot.changes.length} tone="ok" />
            </div>
          </Rise>
          <Rise>
            <Section title="Suggestions" hint="From AI analysis findings and denials in the last hour">
              <Suggestions suggestions={suggestions} isStaged={isStaged} onStage={stageSuggestion} onDismiss={dismiss} onFocus={setFocus} />
            </Section>
          </Rise>
          <Rise>
            <Section title="Agents" hint="Click a capability to grant or revoke it; hatched cells are outside the agent's use case">
              <Card className="overflow-hidden">
                <AccessMatrix snapshot={snapshot} staged={staged} usage={usage} focus={focus} applied={applied} onStage={onStage} owners={owners} />
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/70 px-6 py-3 text-[12.5px] text-ink-3">
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-accent" />Delegated</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded ring-2 ring-ok" />Grant staged</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded ring-2 ring-bad" />Revoke staged</span>
                  <span className="flex items-center gap-1.5"><span className="hatch h-3 w-3 rounded" />Outside the use case</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-wait" />Approval</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-verify" />Step-up</span>
                  <span className="flex items-center gap-1.5"><span className="h-[3px] w-5 rounded-full bg-ok/70" />Use this hour</span>
                </div>
              </Card>
            </Section>
          </Rise>
          <Rise>
            <Section title="People" hint="Betsee Desk access and the tier ceiling on everything they start">
              {snapshot.people.length ? (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {snapshot.people.map((person) => (
                    <PersonCard
                      key={person.sub}
                      person={person}
                      next={next.people.find((p) => p.sub === person.sub) ?? person}
                      staged={staged}
                      stats={stats.get(person.sub) ?? { chats: 0, flagged: 0, aboveTier: 0 }}
                      focused={focus === person.sub}
                      applied={applied.has(changeKey({ kind: 'person_desk', sub: person.sub, enabled: true })) || applied.has(changeKey({ kind: 'person_tier', sub: person.sub, tier_ceiling: 'public' }))}
                      onStage={onStage}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState icon="users" title="No principals yet" body="People appear here once they have signed in to Betsee." />
              )}
            </Section>
          </Rise>
          <Rise>
            <Section title="History" hint="Every access change, who made it and why">
              <Card className="p-3">
                <History changes={snapshot.changes} nameOf={nameOf} />
              </Card>
            </Section>
          </Rise>
        </Stagger>
      )}
      <AnimatePresence>
        {staged.size > 0 && (
          <ChangeTray
            staged={staged}
            nameOf={nameOf}
            writable={writable}
            actor={me.data?.human.display_name ?? 'you'}
            pending={apply.isPending}
            onUnstage={unstage}
            onDiscard={() => setStaged(new Map())}
            onApply={applyStaged}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
