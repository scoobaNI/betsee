import { AnimatePresence, motion, useAnimate, useReducedMotion, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

export const EASE = [0.22, 1, 0.36, 1] as const;
export const SPRING = { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } as const;

/** The CSS colour of each outcome tone, for strokes, glows and rings drawn outside Tailwind classes. */
export const TONE_COLOR = {
  ok: 'var(--color-ok)',
  bad: 'var(--color-bad)',
  wait: 'var(--color-wait)',
  verify: 'var(--color-verify)',
  ai: 'var(--color-ai)',
  quar: 'var(--color-quar)',
  muted: 'var(--color-ink-3)',
  accent: 'var(--color-accent)',
} as const;

export const TONE_SOFT = {
  ok: 'var(--color-ok-soft)',
  bad: 'var(--color-bad-soft)',
  wait: 'var(--color-wait-soft)',
  verify: 'var(--color-verify-soft)',
  ai: 'var(--color-ai-soft)',
  quar: 'var(--color-quar-soft)',
  muted: 'var(--color-sunken)',
  accent: 'var(--color-accent-soft)',
} as const;

/** Moves the .spotlight glow under the pointer. */
export function trackPointer(event: PointerEvent<HTMLElement>) {
  const node = event.currentTarget;
  const rect = node.getBoundingClientRect();
  node.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  node.style.setProperty('--my', `${event.clientY - rect.top}px`);
}

const container = (step: number, delay: number): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});

const ITEM: Variants = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  // A lingering filter would make this a containing block for fixed descendants; drop it once settled.
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.55, ease: EASE }, transitionEnd: { filter: 'none' } },
};

const ITEM_REDUCED: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
};

/** Children marked <Rise> cascade in one after another when this mounts. */
export function Stagger({
  children,
  className,
  step = 0.07,
  delay = 0,
  style,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  step?: number;
  delay?: number;
  style?: CSSProperties;
  as?: 'div' | 'ol' | 'ul';
}) {
  const Tag = as === 'ol' ? motion.ol : as === 'ul' ? motion.ul : motion.div;
  return (
    <Tag className={className} style={style} variants={container(step, delay)} initial="hidden" animate="show">
      {children}
    </Tag>
  );
}

export function Rise({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'li' }) {
  const reduce = useReducedMotion();
  const Tag = as === 'section' ? motion.section : as === 'li' ? motion.li : motion.div;
  return (
    <Tag className={className} variants={reduce ? ITEM_REDUCED : ITEM}>
      {children}
    </Tag>
  );
}

const WORD: Variants = {
  hidden: { opacity: 0, y: 12, filter: 'blur(8px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: EASE }, transitionEnd: { filter: 'none' } },
};

/** Words that settle in one after another, for a headline that changes meaning. */
export function WordReveal({ text, className, delay = 0, emphasis }: { text: string; className?: string; delay?: number; emphasis?: { index: number; className: string } }) {
  const reduce = useReducedMotion();
  const words = text.split(' ');
  return (
    <motion.span className={className} variants={container(0.045, delay)} initial="hidden" animate="show" aria-label={text}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          aria-hidden="true"
          className={`inline-block whitespace-pre ${emphasis?.index === i ? emphasis.className : ''}`}
          variants={reduce ? ITEM_REDUCED : WORD}
        >
          {i < words.length - 1 ? `${word} ` : word}
        </motion.span>
      ))}
    </motion.span>
  );
}

/**
 * A ring that expands from its parent and fades whenever `trigger` changes after mount; the parent
 * must be positioned. Used for status changes and live pings.
 */
export function Burst({
  trigger,
  color,
  radius = '9999px',
  strength = 2.2,
  delay = 0,
  onMount = false,
}: {
  trigger: number | string | undefined;
  color: string;
  radius?: string;
  strength?: number;
  delay?: number;
  /** Also ring once when first shown, not only on later changes. */
  onMount?: boolean;
}) {
  const reduce = useReducedMotion();
  const first = useRef(trigger);
  if (reduce || trigger === undefined || (!onMount && trigger === first.current)) return null;
  return (
    <AnimatePresence>
      <motion.span
        key={String(trigger)}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ borderRadius: radius, boxShadow: `0 0 0 2px ${color}` }}
        initial={{ opacity: 0, scale: 1 }}
        animate={{ opacity: [0.8, 0], scale: [1, strength] }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay }}
      />
    </AnimatePresence>
  );
}

/** Counts how often a number went up since mount, so only a rise (not a sliding window) rings. */
export function useRises(value: number): number {
  const last = useRef(value);
  const [rises, setRises] = useState(0);
  useEffect(() => {
    if (value > last.current) setRises((n) => n + 1);
    last.current = value;
  }, [value]);
  return rises;
}

/** Scales an element up and back when `trigger` changes after mount: a count that just moved. */
export function usePop<T extends HTMLElement>(trigger: unknown, scale = 1.08) {
  const [scope, animate] = useAnimate<T>();
  const reduce = useReducedMotion();
  const previous = useRef(trigger);
  useEffect(() => {
    if (previous.current === trigger) return;
    previous.current = trigger;
    if (reduce || !scope.current) return;
    void animate(scope.current, { scale: [1, scale, 1] }, { duration: 0.45, ease: EASE });
  }, [trigger, reduce, animate, scope, scale]);
  return scope;
}

/** Shakes an element sideways when `trigger` changes after mount: an agent that was just stopped. */
export function useShake<T extends HTMLElement>(trigger: unknown, when: boolean) {
  const [scope, animate] = useAnimate<T>();
  const reduce = useReducedMotion();
  const previous = useRef(trigger);
  useEffect(() => {
    if (previous.current === trigger) return;
    previous.current = trigger;
    if (reduce || !when || !scope.current) return;
    void animate(scope.current, { x: [0, -4, 4, -3, 3, -1, 0] }, { duration: 0.5, ease: 'easeOut' });
  }, [trigger, when, reduce, animate, scope]);
  return scope;
}

/** Content that swaps with a short vertical cross-fade when its key changes. */
export function Swap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={`relative inline-grid ${className ?? ''}`}>
      <AnimatePresence initial={false}>
        <motion.span
          key={id}
          className="col-start-1 row-start-1 inline-flex min-w-0 items-center"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, filter: 'blur(4px)' }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
