import { subscribeToEvents, type StreamEvent } from '@betsee/api';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { isObservation, isVoided } from '../domain/decision.ts';
import { Icon, type IconName } from './icon.tsx';
import { EASE, TONE_COLOR, usePop } from './motion.tsx';
import { toneClass, type Tone } from './ui.tsx';

interface Toast {
  id: number;
  /** Toasts with the same key within MERGE_MS fold into one with a count (act 6 bursts). */
  key: string;
  tone: Tone;
  icon: IconName;
  title: string;
  body: string;
  to: string;
  count: number;
  at: number;
}

export type ToastDraft = Omit<Toast, 'id' | 'count' | 'at'>;

const noticeListeners = new Set<(draft: ToastDraft) => void>();

/** Shows a notification for something the reader did here (a demo act started), not a stream event. */
export function notify(draft: ToastDraft) {
  for (const listener of noticeListeners) listener(draft);
}

const SHOWN = 3;
const MERGE_MS = 5_000;
const LIFETIME_MS = 6_500;

const trace = (id: string) => `/traces/${encodeURIComponent(id)}`;

/** Only what a security officer would turn their head for; allowed actions never toast. */
export function toastFor(event: StreamEvent): ToastDraft | null {
  switch (event.type) {
    case 'action.decided': {
      const a = event.data;
      if (isObservation(a)) return null;
      const what = `${a.capability} on ${a.resource.id}`;
      if (a.decision === 'deny') {
        return a.ai_tightened
          ? { key: `deny:${a.agent.id}:${a.capability}`, tone: 'ai', icon: 'sparkles', title: `AI analysis stopped ${a.agent.id}`, body: what, to: trace(a.trace_id) }
          : { key: `deny:${a.agent.id}:${a.capability}`, tone: 'bad', icon: 'ban', title: `${a.agent.id} was denied`, body: what, to: trace(a.trace_id) };
      }
      if (a.approval_state === 'pending' && a.decision === 'require_approval') {
        return { key: `wait:${a.trace_id}`, tone: 'wait', icon: 'hourglass', title: `${a.agent.id} is waiting for approval`, body: `${what}${a.human ? `, for ${a.human.display_name}` : ''}`, to: trace(a.trace_id) };
      }
      if (a.approval_state === 'pending' && a.decision === 'require_step_up') {
        return { key: `wait:${a.trace_id}`, tone: 'verify', icon: 'lock', title: `${a.agent.id} needs a step-up`, body: what, to: trace(a.trace_id) };
      }
      return null;
    }
    case 'action.updated': {
      const a = event.data;
      const what = `${a.agent.id}: ${a.capability} on ${a.resource.id}`;
      if (isVoided(a)) return { key: `done:${a.trace_id}`, tone: 'muted', icon: 'x', title: 'Approval voided', body: `${what}. The session ended first.`, to: trace(a.trace_id) };
      const stepUp = a.decision === 'require_step_up';
      if (a.approval_state === 'approved') return { key: `done:${a.trace_id}`, tone: 'ok', icon: 'circle-check', title: stepUp ? 'Step-up verified' : 'Approved by a human', body: what, to: trace(a.trace_id) };
      if (a.approval_state === 'rejected') return { key: `done:${a.trace_id}`, tone: 'bad', icon: 'ban', title: stepUp ? 'Step-up failed' : 'Rejected by a human', body: what, to: trace(a.trace_id) };
      return null;
    }
    case 'agent.state_changed': {
      const { agent_id: id, state, reason } = event.data;
      const to = `/agents/${encodeURIComponent(id)}`;
      if (state === 'quarantined') return { key: `state:${id}`, tone: 'quar', icon: 'power', title: `${id} quarantined`, body: reason || 'Every action it attempts is denied until it is released.', to };
      if (state === 'suspended') return { key: `state:${id}`, tone: 'muted', icon: 'power', title: `${id} suspended`, body: reason || 'Suspended by a security officer.', to };
      return { key: `state:${id}`, tone: 'ok', icon: 'circle-check', title: `${id} released`, body: 'The agent is active again.', to };
    }
    case 'message.mediated': {
      const m = event.data;
      if (m.decision !== 'deny') return null;
      return { key: `msg:${m.sender.id}:${m.receiver.id}`, tone: 'bad', icon: 'message', title: `Message ${m.sender.id} to ${m.receiver.id} blocked`, body: m.capability, to: trace(m.trace_id) };
    }
    case 'tool.descriptor_changed': {
      const d = event.data;
      if (d.status !== 'blocked') return { key: `tool:${d.tool}`, tone: 'ok', icon: 'shield-check', title: `Tool ${d.tool} restored`, body: `Re-pinned on ${d.connector_id}.`, to: '/graph' };
      return { key: `tool:${d.tool}`, tone: 'bad', icon: 'shield-x', title: `Tool ${d.tool} blocked`, body: 'Its description changed; the Gateway blocks it until an admin re-pins it.', to: '/graph' };
    }
    default:
      return null;
  }
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState(false);
  const countPop = usePop<HTMLSpanElement>(toast.count, 1.3);
  const t = toneClass(toast.tone);
  return (
    <div
      role="status"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      className="group relative overflow-hidden rounded-2xl border border-line bg-surface/95 shadow-pop backdrop-blur-xl"
    >
      <button
        type="button"
        onClick={() => {
          navigate(toast.to);
          onClose();
        }}
        className="flex w-full items-start gap-3 p-3.5 pr-10 text-left"
      >
        <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.soft} ${t.ink}`}>
          <Icon name={toast.icon} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-ink">{toast.title}</span>
            {toast.count > 1 && (
              <span ref={countPop} className={`inline-block shrink-0 rounded-md px-1.5 text-[12px] font-semibold tabular-nums ${t.soft} ${t.ink}`}>
                x{toast.count}
              </span>
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-ink-2">{toast.body}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="press absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 opacity-60 transition-all hover:bg-sunken hover:text-ink group-hover:opacity-100"
      >
        <Icon name="x" size={14} />
      </button>
      <span
        key={`${toast.id}-${toast.count}`}
        onAnimationEnd={onClose}
        style={{ animationDuration: `${LIFETIME_MS}ms`, background: TONE_COLOR[toast.tone] }}
        className={`toast-timer absolute inset-x-0 bottom-0 h-[2px] opacity-70 ${hover ? 'paused' : ''}`}
      />
    </div>
  );
}

/** Live notifications for the events that matter, stacked at the top right, newest first. */
export function LiveToasts() {
  const reduce = useReducedMotion();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let next = 0;
    const push = (draft: ToastDraft | null) => {
      if (!draft) return;
      const now = Date.now();
      setToasts((prev) => {
        const same = prev.find((t) => t.key === draft.key && now - t.at < MERGE_MS);
        if (same) return [{ ...same, ...draft, count: same.count + 1, at: now }, ...prev.filter((t) => t !== same)];
        return [{ ...draft, id: ++next, count: 1, at: now }, ...prev].slice(0, SHOWN);
      });
    };
    const unsubscribe = subscribeToEvents((event) => push(toastFor(event)));
    noticeListeners.add(push);
    return () => {
      unsubscribe();
      noticeListeners.delete(push);
    };
  }, []);

  const close = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <div aria-live="polite" className="pointer-events-none fixed top-4 right-4 z-50 flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2.5">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout={!reduce}
            className="pointer-events-auto"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.94, transition: { duration: 0.22, ease: EASE } }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <ToastCard toast={toast} onClose={() => close(toast.id)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
