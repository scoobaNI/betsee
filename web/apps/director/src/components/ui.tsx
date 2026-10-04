import { ApiRequestError, type ActionSummary, type LifecycleState, type Tier } from '@betsee/api';
import { animate, AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { decisionLabel, isObservation, isVoided, outcomeTone, resolutionOf } from '../domain/decision.ts';
import { formatCount, formatTime, initials } from '../domain/format.ts';
import { personByName, photoOf } from '../domain/people.ts';
import { useAgentPulse } from '../live.ts';
import { Icon, LogoMark, type IconName } from './icon.tsx';
import { Burst, EASE, TONE_COLOR, trackPointer, usePop, useShake } from './motion.tsx';

export { EASE };

export const ECOSYSTEM_URL = 'http://betsee.localhost';

export type Tone = 'ok' | 'bad' | 'wait' | 'verify' | 'ai' | 'quar' | 'muted' | 'accent';

const TONE: Record<Tone, { dot: string; soft: string; ink: string; bar: string }> = {
  ok: { dot: 'bg-ok', soft: 'bg-ok-soft', ink: 'text-ok-ink', bar: 'bg-ok' },
  bad: { dot: 'bg-bad', soft: 'bg-bad-soft', ink: 'text-bad-ink', bar: 'bg-bad' },
  wait: { dot: 'bg-wait', soft: 'bg-wait-soft', ink: 'text-wait-ink', bar: 'bg-wait' },
  verify: { dot: 'bg-verify', soft: 'bg-verify-soft', ink: 'text-verify-ink', bar: 'bg-verify' },
  ai: { dot: 'bg-ai', soft: 'bg-ai-soft', ink: 'text-ai-ink', bar: 'bg-ai' },
  quar: { dot: 'bg-quar', soft: 'bg-quar-soft', ink: 'text-quar-ink', bar: 'bg-quar' },
  muted: { dot: 'bg-ink-3', soft: 'bg-sunken', ink: 'text-ink-2', bar: 'bg-ink-4' },
  accent: { dot: 'bg-accent', soft: 'bg-accent-soft', ink: 'text-accent-ink', bar: 'bg-accent' },
};

export const toneClass = (tone: Tone) => TONE[tone];

/* Outcomes */

export interface Outcome {
  tone: Tone;
  label: string;
  waiting: boolean;
  /** What a fixed-width badge prints when `label` does not fit; `label` then goes in its title. */
  short?: string;
}

/** What an action finally reads as: one word and one colour, used everywhere an action appears. */
export function outcomeOf(action: Pick<ActionSummary, 'decision' | 'approval_state' | 'capability' | 'agent'> & { human?: { sub: string } }): Outcome {
  if (isObservation(action)) return { tone: 'muted', label: 'Observed', waiting: false };
  if (isVoided(action)) return { tone: 'bad', label: 'Voided', waiting: false };
  const resolution = resolutionOf(action);
  const tone = outcomeTone(action);
  const label = resolution ? `${resolution[0]!.toUpperCase()}${resolution.slice(1)}` : decisionLabel[action.decision];
  return {
    tone: tone === 'allow' ? 'ok' : tone === 'deny' ? 'bad' : tone === 'approval' ? 'wait' : 'verify',
    label,
    waiting: action.approval_state === 'pending' && (action.decision === 'require_approval' || action.decision === 'require_step_up'),
    short: resolution ? undefined : PENDING_SHORT[action.decision],
  };
}

const PENDING_SHORT: Partial<Record<ActionSummary['decision'], string>> = { require_approval: 'Approval', require_step_up: 'Step-up' };

/** Counts how often a value has changed since mount, so a change can trigger a one-shot animation. */
function useChangeCount(value: unknown): number {
  const previous = useRef(value);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setCount((c) => c + 1);
  }, [value]);
  return count;
}

export type BadgeSize = 'sm' | 'md' | 'lg';

const TONE_ICON: Record<Tone, IconName> = {
  ok: 'check',
  bad: 'x',
  wait: 'hourglass',
  verify: 'fingerprint',
  ai: 'sparkles',
  quar: 'power',
  muted: 'eye',
  accent: 'info',
};

// Fixed widths so badges stack into a clean column in lists; sized for "Quarantined" plus the AI
// marker at each size.
const BADGE_BOX: Record<BadgeSize, { box: string; dot: number; icon: number; mark: number }> = {
  sm: { box: 'w-[124px] h-7 pl-[5px] pr-2 gap-1.5 text-[12.5px]', dot: 18, icon: 11, mark: 16 },
  md: { box: 'w-[136px] h-8 pl-[5px] pr-2.5 gap-2 text-[13.5px]', dot: 22, icon: 13, mark: 18 },
  lg: { box: 'w-[164px] h-10 pl-1.5 pr-3 gap-2.5 text-[16px]', dot: 28, icon: 16, mark: 22 },
};

/**
 * The one status badge: a fixed-width pill with its icon in a tone-coloured circle. Pending states
 * animate while they wait; an AI-tightened decision carries the AI marker inside the badge. When the
 * outcome changes in place (a wait a human resolved, an agent that was quarantined) the colour
 * slides over, the word rolls, and a ring announces the change.
 */
export function StatusBadge({
  outcome,
  size = 'md',
  title,
  icon,
  ai,
}: {
  outcome: Outcome;
  size?: BadgeSize;
  title?: string;
  icon?: IconName;
  /** AI analysis tightened this decision: true, or the analyzer's model label. */
  ai?: boolean | string;
}) {
  const t = TONE[outcome.tone];
  const s = BADGE_BOX[size];
  const reduce = useReducedMotion();
  const changes = useChangeCount(outcome.label);
  const scope = usePop<HTMLSpanElement>(changes, 1.12);
  const text = outcome.short ?? outcome.label;
  const aiNote = ai ? `AI analysis made this decision stricter${typeof ai === 'string' ? ` (${ai})` : ''}.` : '';
  const fullTitle = [title ?? (outcome.short ? outcome.label : ''), aiNote].filter(Boolean).join(' ') || undefined;
  const glyph = icon ?? TONE_ICON[outcome.tone];
  return (
    <span
      ref={scope}
      title={fullTitle}
      style={{ '--badge-ring': TONE_COLOR[outcome.tone] } as CSSProperties}
      className={`relative inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap transition-colors duration-500 ${s.box} ${t.soft} ${t.ink}`}
    >
      <Burst trigger={changes || undefined} color={TONE_COLOR[outcome.tone]} strength={1.5} />
      <span
        style={{ width: s.dot, height: s.dot }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full text-white transition-colors duration-500 ${t.dot} ${outcome.waiting ? 'badge-waiting' : ''}`}
      >
        <span className={`inline-flex ${outcome.waiting && glyph === 'hourglass' ? 'hourglass-flip' : ''}`}>
          <Icon name={glyph} size={s.icon} />
        </span>
      </span>
      <span className="relative inline-grid min-w-0 flex-1">
        <AnimatePresence initial={false}>
          <motion.span
            key={text}
            className="col-start-1 row-start-1 truncate"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -7 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </span>
      {ai && (
        <span
          aria-label="AI tightened"
          style={{ width: s.mark, height: s.mark }}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-ai text-white ring-2 ring-white/70"
        >
          <Icon name="sparkles" size={Math.round(s.mark * 0.62)} />
        </span>
      )}
    </span>
  );
}

/** The action's outcome with its AI modifier, the one way an action's verdict is drawn. */
export function ActionVerdict({ action, size = 'md' }: { action: ActionSummary; size?: BadgeSize }) {
  const title = isVoided(action) ? 'The session ended before a human decided; the approval was voided.' : undefined;
  const ai = action.ai_tightened && !isObservation(action) ? (action.analyzer.model_label ?? true) : undefined;
  return <StatusBadge outcome={outcomeOf(action)} size={size} title={title} ai={ai} />;
}

/** The last decisions of one agent as quiet bars, oldest first. */
export function TickStrip({ actions, className = '', tall = false }: { actions: readonly ActionSummary[]; className?: string; tall?: boolean }) {
  const reduce = useReducedMotion();
  if (!actions.length) return <span className={`text-[12px] text-ink-3 ${className}`}>No actions yet</span>;
  const [low, high] = tall ? ['h-4', 'h-7'] : ['h-2.5', 'h-4'];
  return (
    <span className={`relative flex items-end gap-[3px] ${tall ? 'h-7' : 'h-4'} ${className}`} aria-label={`Last ${actions.length} decisions`}>
      <AnimatePresence initial={false} mode="popLayout">
        {actions.map((action) => {
          const outcome = outcomeOf(action);
          return (
            <motion.span
              key={action.trace_id}
              layout={reduce ? false : 'position'}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scaleY: 0 }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scaleY: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 28 }}
              title={`${formatTime(action.occurred_at)} ${action.capability}: ${outcome.label}`}
              className={`origin-bottom rounded-full transition-colors duration-500 ${tall ? 'w-[5px]' : 'w-[4px]'} ${TONE[outcome.tone].bar} ${outcome.tone === 'ok' ? `${low} opacity-60` : high}`}
            />
          );
        })}
      </AnimatePresence>
    </span>
  );
}

/** Proportions of outcomes as one thin bar; empty reads as a hatched track. */
export function OutcomeBar({ parts, className = '' }: { parts: { tone: Tone; value: number; label: string }[]; className?: string }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (!total) return <div className={`hatch h-1.5 rounded-full ${className}`} />;
  return (
    <div className={`flex h-1.5 gap-[2px] overflow-hidden rounded-full ${className}`} role="img" aria-label={parts.filter((p) => p.value).map((p) => `${p.value} ${p.label}`).join(', ')}>
      {parts.map((p) =>
        p.value ? (
          <motion.span
            key={p.label}
            title={`${p.label}: ${p.value}`}
            className={`${TONE[p.tone].bar} ${p.tone === 'ok' ? 'opacity-70' : ''}`}
            initial={false}
            animate={{ flexGrow: p.value }}
            transition={{ duration: 0.6, ease: EASE }}
          />
        ) : null,
      )}
    </div>
  );
}

/* Identity marks */

/** A person's photo from the directory, or their initials when they have none. */
export function Avatar({ name, size = 28, className = '' }: { name: string; size?: number; className?: string }) {
  const person = personByName(name);
  const [failed, setFailed] = useState(false);
  if (person && !failed) {
    return (
      <img
        src={photoOf(person)}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-full bg-sunken object-cover ring-1 ring-black/5 ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-sunken font-semibold text-ink-2 ring-1 ring-line ${className}`}
    >
      {initials(name)}
    </span>
  );
}

export const STATE_TONE: Record<LifecycleState, Tone> = { active: 'ok', quarantined: 'quar', suspended: 'muted' };

/**
 * An agent's mark with its lifecycle dot. Given the agent's id it also pings in the colour of each
 * new decision as it arrives; a state change shakes it and rings in the new state's colour.
 */
export function AgentGlyph({ state = 'active', size = 36, agentId }: { state?: LifecycleState; size?: number; agentId?: string }) {
  const { pulse } = useAgentPulse(agentId);
  const stateChanges = useChangeCount(state);
  const shake = useShake<HTMLSpanElement>(stateChanges, state !== 'active');
  const pingTone = pulse.action ? outcomeOf(pulse.action).tone : 'accent';
  const offline = state !== 'active';
  return (
    <span
      ref={shake}
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-xl transition-colors duration-500 ${
        offline ? (state === 'quarantined' ? 'bg-quar-soft text-quar-ink' : 'bg-sunken text-ink-3') : 'bg-accent-soft text-accent-ink'
      }`}
    >
      <Burst trigger={pulse.seq} color={TONE_COLOR[pingTone]} radius="12px" strength={1.55} />
      <Burst trigger={stateChanges || undefined} color={TONE_COLOR[STATE_TONE[state]]} radius="12px" strength={1.9} />
      <Icon name={state === 'quarantined' ? 'power' : 'bot'} size={Math.round(size * 0.5)} />
      <span className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface transition-colors duration-500 ${TONE[STATE_TONE[state]].dot}`} />
    </span>
  );
}

const STATE_ICON: Record<LifecycleState, IconName> = { active: 'check', quarantined: 'power', suspended: 'pause' };

export function StatePill({ state }: { state: LifecycleState }) {
  const label = { active: 'Active', quarantined: 'Quarantined', suspended: 'Suspended' }[state];
  return <StatusBadge outcome={{ tone: STATE_TONE[state], label, waiting: false }} size="sm" icon={STATE_ICON[state]} />;
}

const TIER_TONE: Record<Tier, string> = {
  public: 'text-ink-3',
  internal: 'text-ink-2',
  confidential: 'text-wait-ink',
  restricted: 'text-bad-ink',
};

export function TierText({ tier }: { tier: Tier }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium capitalize ${TIER_TONE[tier]}`}>
      <Icon name="layers" size={12} />
      {tier}
    </span>
  );
}

/** An identifier the Gateway uses verbatim: capabilities, control ids, policy ids. */
export function Code({ children, href, title, className = '' }: { children: ReactNode; href?: string; title?: string; className?: string }) {
  const cls = `inline-flex max-w-full items-center rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[12px] leading-[18px] text-ink-2 ${className}`;
  if (href) {
    return (
      <a href={href} title={title} onClick={(e) => e.stopPropagation()} className={`${cls} transition-colors hover:bg-accent-soft hover:text-accent-ink`}>
        {children}
      </a>
    );
  }
  return (
    <span title={title} className={cls}>
      {children}
    </span>
  );
}

export const controlHref = (id: string) => `${ECOSYSTEM_URL}/policy-studio/controls/${encodeURIComponent(id)}`;
export const policyHref = (id: string) => `${ECOSYSTEM_URL}/policy-studio/policies/${encodeURIComponent(id)}`;

export function CopyId({ value, shown = value.slice(0, 8) }: { value: string; shown?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? 'Copied' : `Copy ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[12px] text-ink-3 transition-colors hover:bg-sunken hover:text-ink-2"
    >
      {shown}
      <Icon name={copied ? 'check' : 'copy'} size={12} />
    </button>
  );
}

/* Layout */

export function Card({ children, className = '', as: Tag = 'div', spotlight = false }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article'; spotlight?: boolean }) {
  return (
    <Tag onPointerMove={spotlight ? trackPointer : undefined} className={`rounded-[22px] border border-line bg-surface shadow-card ${spotlight ? 'spotlight' : ''} ${className}`}>
      {children}
    </Tag>
  );
}

/** Breaks out of the centred column to (almost) the full viewport width, for canvases and charts. */
export function Bleed({ children, className = '' }: { children: ReactNode; className?: string }) {
  // --rail is the floating sidebar's footprint; it only takes room from the large breakpoint up.
  return (
    <div className={`relative left-1/2 w-[max(100%,min(1600px,calc(100vw-48px)))] -translate-x-1/2 lg:w-[max(100%,min(1600px,calc(100vw-var(--rail,0px)-56px)))] ${className}`}>
      {children}
    </div>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[14px] font-medium text-ink-3">
      {items.map((item, i) => (
        <Fragment key={`${item.label}-${i}`}>
          {i > 0 && <Icon name="chevron-right" size={13} className="text-ink-4" />}
          {item.to ? (
            <Link to={item.to} className="truncate transition-colors hover:text-ink">
              {item.label}
            </Link>
          ) : (
            <span className="truncate text-ink-2">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

/**
 * The page's place in the Director: breadcrumbs on the left, the page's own controls on the right.
 * The title is for assistive technology only; the page's content says what it is.
 */
export function PageHeader({ crumbs, title, actions }: { crumbs?: Crumb[]; title: string; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex min-h-11 flex-wrap items-center gap-x-6 gap-y-3">
      <h1 className="sr-only">{title}</h1>
      {crumbs && (
        <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <Breadcrumbs items={crumbs} />
        </motion.div>
      )}
      {actions && (
        <motion.div className="ml-auto flex shrink-0 items-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.1 }}>
          {actions}
        </motion.div>
      )}
    </header>
  );
}

export function Section({ title, hint, action, children, className = '' }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className} aria-label={title}>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-[21px] font-bold tracking-[-0.02em] text-ink">{title}</h2>
        {hint && <span className="text-[14px] text-ink-3">{hint}</span>}
        {action && <span className="ml-auto text-[14px]">{action}</span>}
      </div>
      {children}
    </section>
  );
}

export function TextLink({ to, href, children }: { to?: string; href?: string; children: ReactNode }) {
  const cls = 'group inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-accent-ink transition-colors hover:text-accent';
  const inner = (
    <>
      {children}
      <Icon name={href ? 'external' : 'arrow-right'} size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" />
    </>
  );
  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to ?? '/'} className={cls}>
      {inner}
    </Link>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'secondary',
  icon,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
  type?: 'button' | 'submit';
}) {
  const look = {
    primary: 'bg-ink text-white hover:bg-[#1f2a3d] shadow-card',
    secondary: 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-hover shadow-card',
    ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`press inline-flex h-11 items-center gap-2 rounded-[14px] px-4.5 text-[14.5px] font-semibold transition-colors disabled:opacity-50 ${look}`}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

/** A pill switch whose highlight glides between options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap items-center gap-1 rounded-[14px] bg-ink/[0.05] p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`press relative inline-flex h-10 items-center gap-2 rounded-[11px] px-4 text-[14px] font-semibold transition-colors ${active ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-[11px] bg-surface shadow-[0_1px_2px_rgb(16_24_40/0.08),0_2px_8px_-2px_rgb(16_24_40/0.1)]"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative">{option.label}</span>
            {option.count !== undefined && (
              <span className="relative text-[12px] text-ink-3">
                <AnimatedNumber value={option.count} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A section that opens in place; deep detail stays one click away instead of on screen. */
export function Disclosure({
  title,
  hint,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: ReactNode;
  icon?: IconName;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const reduce = useReducedMotion();
  return (
    <Card as="section">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="group flex w-full items-center gap-4 rounded-[22px] px-7 py-6 text-left">
        {icon && (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunken text-ink-2 transition-colors group-hover:bg-accent-soft group-hover:text-accent-ink">
            <Icon name={icon} size={18} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[16.5px] font-bold text-ink">{title}</span>
          {hint && <span className="mt-0.5 block text-[14px] text-ink-3">{hint}</span>}
        </span>
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
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-7 pt-6 pb-7">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/** A count that glides to its new value instead of jumping, with a small pop when it moves. */
export function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const reduce = useReducedMotion();
  const pop = usePop<HTMLSpanElement>(value, 1.06);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    const node = ref.current;
    if (!node) return;
    if (reduce || from === value) {
      node.textContent = formatCount(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.7,
      ease: EASE,
      onUpdate: (v) => {
        node.textContent = formatCount(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <span ref={pop} className="inline-block origin-bottom-left">
      <span ref={ref} className="tabular-nums">
        {formatCount(value)}
      </span>
    </span>
  );
}

export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-6 gap-y-3 text-[14px]">
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-ink-3">{key}</dt>
          <dd className="min-w-0 text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Raw key/value data as the Gateway sent it, for the deepest level of detail. */
export function RawTable({ entries, prefix = '' }: { entries: [string, unknown][]; prefix?: string }) {
  return (
    <dl className="grid grid-cols-[minmax(140px,auto)_1fr] gap-x-6 gap-y-2 rounded-xl bg-sunken p-4 font-mono text-[12px]">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-ink-3">
            {prefix}
            {key}
          </dt>
          <dd className="break-all text-ink-2">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Meter({ ratio, label, className = '' }: { ratio: number; label: string; className?: string }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const fill = clamped >= 1 ? 'bg-bad' : clamped >= 0.8 ? 'bg-wait' : 'bg-accent';
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-sunken ${className}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
      <motion.div className={`h-full rounded-full ${fill}`} initial={false} animate={{ width: `${clamped * 100}%` }} transition={{ duration: 0.6, ease: EASE }} />
    </div>
  );
}

/* States */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-2xl ${className}`} />;
}

export function EmptyState({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <motion.span
        initial={{ opacity: 0, scale: 0.8, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sunken text-ink-3"
      >
        <Icon name={icon} size={22} />
      </motion.span>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="max-w-sm text-[14px] leading-relaxed text-ink-2">{body}</p>}
      {children}
    </div>
  );
}

export function errorDetail(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 0) return 'Gateway unreachable';
    return `HTTP ${error.status} from the Gateway${error.traceId ? `, trace ${error.traceId.slice(0, 8)}` : ''}`;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}

export function ErrorCard({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert">
    <Card className="flex items-start gap-4 p-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bad-soft text-bad-ink">
        <Icon name="alert" size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        <p className="mt-1 font-mono text-[12px] text-ink-3">{errorDetail(error)}</p>
      </div>
      {onRetry && (
        <Button onClick={onRetry} icon="reset">
          Retry
        </Button>
      )}
    </Card>
    </div>
  );
}

export function FullPageMessage({ title, body, action }: { title: string; body: string; action?: { label: string; onClick?: () => void; href?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="w-full max-w-md rounded-3xl border border-line bg-surface p-10 text-center shadow-lift"
      >
        <Wordmark className="justify-center" />
        <h1 className="mt-8 text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{body}</p>
        {action &&
          (action.href ? (
            <a href={action.href} className="mt-8 inline-flex h-10 items-center rounded-xl bg-ink px-5 text-[14px] font-medium text-white">
              {action.label}
            </a>
          ) : (
            <button type="button" onClick={action.onClick} className="mt-8 h-10 rounded-xl bg-ink px-5 text-[14px] font-medium text-white">
              {action.label}
            </button>
          ))}
      </motion.div>
    </main>
  );
}

export function Wordmark({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-ink text-white">
        <LogoMark size={20} />
      </span>
      <span className={`flex-col text-left leading-none ${compact ? 'hidden sm:flex' : 'flex'}`}>
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Director</span>
        <span className="mt-1 text-[11px] font-medium text-ink-3">Betsee</span>
      </span>
    </span>
  );
}
