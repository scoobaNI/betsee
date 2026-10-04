import { animate } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icon.tsx';

const MIN = 0.4;
const MAX = 1.4;
const STEP = 0.1;

/**
 * A canvas that fits its content to the available width and lets the reader zoom. It uses CSS zoom
 * rather than a transform, so the page still scrolls to whatever the zoomed content needs.
 */
export function ZoomCanvas({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<number | 'fit'>('fit');
  const [fit, setFit] = useState(1);
  const current = useRef(1);
  const [shown, setShown] = useState(1);

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const measure = () => {
      const natural = content.getBoundingClientRect().width / current.current;
      const style = getComputedStyle(box);
      const available = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setFit(Math.max(MIN, Math.min(1, available / Math.max(1, natural))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const target = mode === 'fit' ? fit : mode;
  useEffect(() => {
    const content = inner.current;
    if (!content) return;
    const controls = animate(current.current, target, {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        current.current = v;
        content.style.zoom = String(v);
      },
      onComplete: () => setShown(target),
    });
    return () => controls.stop();
  }, [target]);

  const step = (delta: number) => setMode(Math.max(MIN, Math.min(MAX, Math.round((target + delta) * 10) / 10)));
  const button = 'press flex h-9 min-w-9 items-center justify-center rounded-xl px-2 text-ink-2 transition-colors hover:bg-ink/[0.05] hover:text-ink';

  return (
    <div className="relative">
      <div ref={outer} className="scrollbar-quiet overflow-x-auto px-6 py-12 sm:px-10">
        <div ref={inner} className="mx-auto w-max">
          {children}
        </div>
      </div>
      <div className="glass sticky bottom-6 z-20 mr-6 mb-6 ml-auto flex w-max items-center gap-1 rounded-2xl p-1.5 text-[13px] font-semibold">
        <button type="button" aria-label="Zoom out" onClick={() => step(-STEP)} className={button}>
          <Icon name="zoom-out" size={17} />
        </button>
        <span className="w-12 text-center text-ink tabular-nums">{Math.round((mode === 'fit' ? fit : shown) * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => step(STEP)} className={button}>
          <Icon name="zoom-in" size={17} />
        </button>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
        <button type="button" onClick={() => setMode('fit')} className={`${button} gap-1.5 px-3 ${mode === 'fit' ? 'text-accent-ink' : ''}`}>
          <Icon name="fit" size={15} />
          Fit
        </button>
      </div>
    </div>
  );
}
