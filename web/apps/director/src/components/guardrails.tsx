import type { Analyzer, AnalyzerVerdict, EvaluationDecision, GuardrailAction, Hit, MaskedValue } from '@betsee/api';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { analyzerVerdictLabel } from '../domain/decision.ts';
import { classLabel, percent, splitMarkers } from '../domain/guardrails.ts';
import { formatDuration } from '../domain/pipeline.ts';
import { Icon, type IconName } from './icon.tsx';
import { Code, EASE, toneClass, type Outcome, type Tone } from './ui.tsx';

export const DECISION_LOOK: Record<EvaluationDecision, { outcome: Outcome; icon: IconName; sentence: string }> = {
  allow: { outcome: { tone: 'ok', label: 'Allowed', waiting: false }, icon: 'check', sentence: 'Goes on unchanged.' },
  allow_redacted: {
    outcome: { tone: 'accent', label: 'Allowed with redactions', short: 'Redacted', waiting: false },
    icon: 'filter',
    sentence: 'Goes on with the marked parts taken out.',
  },
  flag_untrusted: {
    outcome: { tone: 'wait', label: 'Allowed, flagged as untrusted', short: 'Untrusted', waiting: false },
    icon: 'alert',
    sentence: 'Goes on, and the session is marked as holding untrusted input: its high-impact actions need a person.',
  },
  block: { outcome: { tone: 'bad', label: 'Blocked', waiting: false }, icon: 'ban', sentence: 'Refused. Nothing goes on to the agent or a model.' },
  withhold: { outcome: { tone: 'bad', label: 'Withheld', waiting: false }, icon: 'lock', sentence: 'The whole result is withheld from the agent.' },
};

export function Chip({ tone, icon, children, title }: { tone: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  const t = toneClass(tone);
  return (
    <span title={title} className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-semibold whitespace-nowrap ${t.soft} ${t.ink}`}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

const ACTION_LOOK: Record<GuardrailAction, { tone: Tone; icon: IconName; label: string }> = {
  block: { tone: 'bad', icon: 'ban', label: 'Block' },
  redact: { tone: 'accent', icon: 'filter', label: 'Redact' },
  allow: { tone: 'ok', icon: 'check', label: 'Allow' },
};

export function ActionChip({ action }: { action: GuardrailAction }) {
  const look = ACTION_LOOK[action];
  return (
    <Chip tone={look.tone} icon={look.icon} title={action === 'allow' ? 'Recorded in the trace, nothing else' : undefined}>
      {look.label}
    </Chip>
  );
}

export function SignatureAction({ action }: { action: Hit['action'] }) {
  return action === 'block' ? (
    <Chip tone="bad" icon="ban">
      Block
    </Chip>
  ) : (
    <Chip tone="wait" icon="alert" title="Flags the session as holding untrusted input">
      Review
    </Chip>
  );
}

const SEVERITY_TONE: Record<string, Tone> = { critical: 'bad', high: 'quar', medium: 'wait', low: 'muted' };

/** Square-cornered so a severity never reads as a decision. */
export function SeverityMark({ severity }: { severity: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-line px-1.5 text-[12px] font-semibold text-ink-2 capitalize">
      <span className={`h-2 w-2 rounded-[2px] ${toneClass(SEVERITY_TONE[severity] ?? 'muted').dot}`} />
      {severity}
    </span>
  );
}

export function SourceChip({ source }: { source: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-sunken px-1.5 text-[12px] font-medium text-ink-2" title={source === 'feed' ? 'From the external threat feed' : 'Shipped with the Gateway'}>
      {source === 'feed' ? 'Feed' : 'Baseline'}
    </span>
  );
}

/** Text as the Gateway rewrote it, its redaction and removal tokens set apart. */
export function MarkedText({ text }: { text: string }) {
  return (
    <p className="rounded-xl bg-sunken p-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink">
      {splitMarkers(text).map((run, i) =>
        run.marker ? (
          <mark
            key={i}
            title={run.marker.kind === 'redacted' ? `${classLabel(run.marker.id)} redacted` : `Removed by signature ${run.marker.id}`}
            className={`rounded-md px-1 py-0.5 font-semibold ${run.marker.kind === 'redacted' ? 'bg-accent-soft text-accent-ink' : 'bg-bad-soft text-bad-ink'}`}
          >
            {run.text}
          </mark>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </p>
  );
}

export function MaskedList({ items, empty }: { items: readonly MaskedValue[]; empty?: string }) {
  if (!items.length) return empty ? <p className="text-[13px] text-ink-3">{empty}</p> : null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <li key={`${item.class}-${i}`} className="inline-flex items-center gap-2 rounded-lg border border-line px-2.5 py-1">
          <span className="text-[13px] text-ink-2">{classLabel(item.class)}</span>
          <span className="font-mono text-[12px] text-ink">{item.masked}</span>
        </li>
      ))}
    </ul>
  );
}

export function SignatureList({ hits, empty }: { hits: readonly Hit[]; empty?: string }) {
  if (!hits.length) return empty ? <p className="text-[13px] text-ink-3">{empty}</p> : null;
  return (
    <ul className="space-y-2">
      {hits.map((hit, i) => (
        <li key={`${hit.id}-${hit.target}-${i}`} className="rounded-xl border border-line p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Code>{hit.id}</Code>
            <span className="min-w-0 flex-1 text-[14px] font-semibold text-ink">{hit.name}</span>
            <SeverityMark severity={hit.severity} />
            <SignatureAction action={hit.action} />
            <SourceChip source={hit.source} />
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">
            Matched in <span className="font-mono">{hit.target}</span>
            {hit.references.length > 0 && <> - {hit.references.join('; ')}</>}
          </p>
          <p className="mt-2 rounded-lg bg-sunken px-3 py-2 font-mono text-[12px] break-all text-ink-2">{hit.evidence}</p>
        </li>
      ))}
    </ul>
  );
}

const VERDICT_TONE: Record<AnalyzerVerdict, Tone> = { clean: 'ok', suspicious: 'wait', malicious: 'bad', unavailable: 'muted', skipped: 'muted' };

/** The classifier score on a 0 to 1 track, with the profile's review and block thresholds marked. */
export function ScoreBar({ score, reviewAt, blockAt, tone }: { score: number; reviewAt?: number; blockAt?: number; tone: Tone }) {
  const reduce = useReducedMotion();
  const markers = [
    { at: reviewAt, label: 'review' },
    { at: blockAt, label: 'block' },
  ].filter((m): m is { at: number; label: string } => typeof m.at === 'number');
  // Review sits under the track and block over it, so the two labels never collide when close.
  return (
    <div className="pt-6 pb-6">
      <div className="relative h-2 rounded-full bg-sunken" role="meter" aria-label="Classifier score" aria-valuemin={0} aria-valuemax={1} aria-valuenow={score}>
        <motion.span
          className={`absolute inset-y-0 left-0 rounded-full ${toneClass(tone).bar}`}
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${Math.max(1, score * 100)}%` }}
          transition={{ duration: 0.6, ease: EASE }}
        />
        {markers.map((m) => (
          <span key={m.label} className="absolute -top-1 -bottom-1 w-px bg-ink-2" style={{ left: `${m.at * 100}%` }}>
            <span className={`absolute -translate-x-1/2 text-[11.5px] whitespace-nowrap text-ink-3 tabular-nums ${m.label === 'block' ? 'bottom-4' : 'top-4'}`}>
              {m.label} at {percent(m.at)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

const VARIANT_LABEL: Record<string, string> = {
  plain: 'the plain text',
  leetspeak: 'a leetspeak reading',
  spaced_letters: 'a spaced-letters reading',
  decoded: 'a decoded (base64) reading',
};

/** What the semantic classifier said and why, always with the Gateway's model label. */
export function SemanticDetail({ analyzer, rationale = true }: { analyzer: Analyzer; rationale?: boolean }) {
  const detail = analyzer.classifier?.detail;
  const score = analyzer.score ?? detail?.score;
  const tone = VERDICT_TONE[analyzer.verdict];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={tone} icon={analyzer.verdict === 'clean' ? 'check' : analyzer.verdict === 'malicious' ? 'ban' : 'alert'}>
          {analyzerVerdictLabel[analyzer.verdict]}
        </Chip>
        {typeof score === 'number' && <span className="text-[14px] font-semibold text-ink tabular-nums">score {score.toFixed(2)}</span>}
        {analyzer.profile && <span className="text-[13px] text-ink-3">profile {analyzer.profile}</span>}
        <span className="ml-auto rounded-full bg-sunken px-2.5 py-1 text-[12px] text-ink-3">{analyzer.model_label}</span>
      </div>
      {typeof score === 'number' && <ScoreBar score={score} reviewAt={analyzer.thresholds?.review_at} blockAt={analyzer.thresholds?.block_at} tone={tone} />}
      {detail && (
        <p className="text-[13px] text-ink-2">
          Highest score on {VARIANT_LABEL[detail.variant] ?? detail.variant}
          {analyzer.classifier && <span className="text-ink-3"> - classifier {formatDuration(analyzer.classifier.latency_ms)}</span>}
        </p>
      )}
      {detail && detail.terms.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Strongest terms">
          {detail.terms.map((t) => (
            <span key={t.term} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 font-mono text-[12px] text-ink">
              {t.term}
              <span className="text-ink-3 tabular-nums">+{t.weight.toFixed(2)}</span>
            </span>
          ))}
        </div>
      )}
      {detail && detail.intents.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-3">
          Intents
          {detail.intents.map((intent) => (
            <Code key={intent}>{intent}</Code>
          ))}
        </p>
      )}
      {rationale && analyzer.rationale && <p className="text-[13.5px] leading-relaxed text-ink-2">{analyzer.rationale}</p>}
    </div>
  );
}
