import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router';
import type { Severity, Suggestion } from '../domain/access.ts';
import { personByName } from '../domain/people.ts';
import { Icon } from './icon.tsx';
import { EASE, SPRING, TONE_COLOR, trackPointer } from './motion.tsx';
import { AgentGlyph, AnimatedNumber, Avatar, EmptyState, type Tone } from './ui.tsx';

const SEVERITY: Record<Severity, { tone: Tone; label: string; chip: string }> = {
  critical: { tone: 'bad', label: 'Critical', chip: 'bg-bad-soft text-bad-ink' },
  elevated: { tone: 'wait', label: 'Elevated', chip: 'bg-wait-soft text-wait-ink' },
  hygiene: { tone: 'accent', label: 'Least privilege', chip: 'bg-accent-soft text-accent-ink' },
};

/** How strongly the evidence points at the change, drawn as a ring that fills on arrival. */
function ScoreRing({ score, tone }: { score: number; tone: Tone }) {
  const reduce = useReducedMotion();
  const r = 19;
  return (
    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center" title={`Evidence strength ${score} of 100`}>
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--color-sunken)" strokeWidth="4.5" />
        <motion.circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth="4.5"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: score / 100 }}
          transition={{ duration: 1.1, ease: EASE, delay: 0.2 }}
        />
      </svg>
      <span className="text-[13px] font-bold text-ink tabular-nums">
        <AnimatedNumber value={score} />
      </span>
    </span>
  );
}

function SuggestionCard({
  suggestion,
  staged,
  onStage,
  onDismiss,
  onFocus,
}: {
  suggestion: Suggestion;
  staged: boolean;
  onStage: () => void;
  onDismiss: () => void;
  onFocus: (id: string | null) => void;
}) {
  const s = SEVERITY[suggestion.severity];
  const subject = suggestion.subject;
  const evidenceLink =
    subject.kind === 'agent' ? `/activity?agent=${encodeURIComponent(subject.id)}` : `/agents?person=${encodeURIComponent(personByName(subject.name)?.id ?? '')}`;
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.25, ease: EASE } }}
      transition={SPRING}
      onPointerEnter={() => onFocus(subject.id)}
      onPointerLeave={() => onFocus(null)}
      onPointerMove={trackPointer}
      className={`spotlight hover-lift relative flex h-full flex-col overflow-hidden rounded-[22px] border bg-surface p-5 shadow-card ${staged ? 'border-accent/40 ring-4 ring-accent-soft' : 'border-line'}`}
    >
      {suggestion.ai && <span aria-hidden="true" className="ai-sheen absolute inset-x-0 top-0 h-[3px]" />}
      <div className="flex items-start gap-3">
        {subject.kind === 'agent' ? <AgentGlyph size={40} agentId={subject.id} /> : <Avatar name={subject.name} size={40} />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex h-6 items-center rounded-full px-2 text-[11.5px] font-bold ${s.chip}`}>{s.label}</span>
            {suggestion.ai && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-ai-soft px-2 text-[11.5px] font-bold text-ai-ink">
                <Icon name="sparkles" size={11} />
                AI analysis
              </span>
            )}
          </span>
          <h3 className="mt-2 text-[16px] leading-snug font-bold tracking-[-0.015em] text-ink">{suggestion.title}</h3>
        </span>
        <ScoreRing score={suggestion.score} tone={s.tone} />
      </div>
      <ul className="mt-3 flex-1 space-y-1.5">
        {suggestion.evidence.map((line, i) => (
          <li key={i} className={`flex gap-2 text-[13.5px] leading-snug ${i ? 'text-ink-3 italic' : 'text-ink-2'}`}>
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-4" />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <motion.button
          type="button"
          onClick={onStage}
          whileTap={{ scale: 0.95 }}
          className={`press inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[13.5px] font-semibold transition-colors ${
            staged ? 'bg-ok-soft text-ok-ink' : 'bg-accent text-white shadow-card hover:brightness-110'
          }`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={staged ? 'staged' : 'stage'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="inline-flex items-center gap-1.5">
              <Icon name={staged ? 'check' : 'layers'} size={14} />
              {staged ? 'Staged' : 'Stage change'}
            </motion.span>
          </AnimatePresence>
        </motion.button>
        <button type="button" onClick={onDismiss} className="press h-9 rounded-xl px-3 text-[13.5px] font-semibold text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          Dismiss
        </button>
        {suggestion.traceIds.length > 0 && (
          <Link to={evidenceLink} className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-accent-ink hover:text-accent">
            Evidence
            <Icon name="arrow-right" size={12} />
          </Link>
        )}
      </div>
    </motion.article>
  );
}

export function Suggestions({
  suggestions,
  isStaged,
  onStage,
  onDismiss,
  onFocus,
}: {
  suggestions: Suggestion[];
  isStaged: (s: Suggestion) => boolean;
  onStage: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onFocus: (id: string | null) => void;
}) {
  if (!suggestions.length) {
    return (
      <div className="rounded-[22px] border border-line bg-surface shadow-card">
        <EmptyState icon="shield-check" title="Nothing to tighten" body="AI analysis has not flagged an agent or a person this hour, and every busy agent uses what it holds." />
      </div>
    );
  }
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      <AnimatePresence mode="popLayout" initial={false}>
        {suggestions.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} staged={isStaged(s)} onStage={() => onStage(s)} onDismiss={() => onDismiss(s)} onFocus={onFocus} />
        ))}
      </AnimatePresence>
    </div>
  );
}
