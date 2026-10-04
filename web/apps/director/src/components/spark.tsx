import { animate } from 'motion/react';
import { useEffect, useRef } from 'react';

/**
 * A glowing dot that runs once along an SVG path, inside an existing <svg>. It samples the path with
 * getPointAtLength, so it follows any curve in the SVG's own coordinates and scales with it.
 */
export function Spark({ d, color, duration = 0.7, delay = 0, reverse = false, radius = 5 }: { d: string; color: string; duration?: number; delay?: number; reverse?: boolean; radius?: number }) {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const line = path.current;
    const circle = dot.current;
    if (!line || !circle) return;
    const length = line.getTotalLength();
    const controls = animate(0, 1, {
      duration,
      delay,
      ease: [0.45, 0, 0.2, 1],
      onUpdate: (t) => {
        const point = line.getPointAtLength((reverse ? 1 - t : t) * length);
        circle.setAttribute('opacity', '1');
        circle.setAttribute('cx', String(point.x));
        circle.setAttribute('cy', String(point.y));
      },
      onComplete: () => circle.setAttribute('opacity', '0'),
    });
    return () => controls.stop();
  }, [d, duration, delay, reverse]);
  return (
    <g aria-hidden="true">
      <path ref={path} d={d} fill="none" stroke="none" />
      <circle ref={dot} r={radius} fill={color} opacity={0} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
    </g>
  );
}
