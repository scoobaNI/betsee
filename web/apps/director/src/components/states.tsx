import { ApiRequestError } from '@betsee/api';
import { Icon } from '@betsee/ui';
import type { ReactNode } from 'react';
import { formatTime } from '../domain/format.ts';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-surface-2 [animation-delay:150ms] ${className}`} />;
}

export function EmptyState({ icon, title, body, children }: { icon: string; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-2 text-fg-tertiary">
        <Icon name={icon} size={28} />
      </span>
      <p className="text-md font-semibold">{title}</p>
      <p className="max-w-sm text-md text-fg-secondary">{body}</p>
      {children}
    </div>
  );
}

export function ErrorCard({
  title,
  error,
  onRetry,
  asOf,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  asOf?: string;
}) {
  const detail =
    error instanceof ApiRequestError
      ? error.status === 0
        ? 'Gateway unreachable'
        : `HTTP ${error.status} from the Gateway${error.traceId ? ` - trace ${error.traceId.slice(0, 8)}` : ''}`
      : error instanceof Error
        ? error.message
        : 'Unknown error';
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-line-subtle bg-surface-1 p-4">
      <Icon name="streamline-flex:warning-diamond" size={20} className="mt-0.5 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-md font-semibold">{title}</p>
        <p className="mt-1 font-mono text-xs text-fg-secondary">{detail}</p>
        {asOf && <p className="mt-1 text-xs text-fg-tertiary">Showing data as of {formatTime(asOf)}</p>}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-7 rounded-sm border border-line-default px-3 text-xs font-semibold hover:border-line-strong"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function OfflineBanner({ since, onRetry }: { since: string | undefined; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 border-l-2 border-danger bg-surface-1 px-4 py-2 text-sm">
      <Icon name="streamline-flex:warning-diamond" size={16} className="text-danger" />
      <span className="flex-1">
        Gateway unreachable.{since ? ` Showing data as of ${formatTime(since)}.` : ' Live updates are paused.'}
      </span>
      <button type="button" onClick={onRetry} className="h-7 rounded-sm border border-line-default px-3 text-xs font-semibold hover:border-line-strong">
        Retry
      </button>
    </div>
  );
}

export function FullPageMessage({
  title,
  body,
  action,
  children,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick?: () => void; href?: string };
  children?: ReactNode;
}) {
  return (
    <main className="dir-canvas flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-line-subtle bg-surface-1 p-8 text-center shadow-e2">
        <DirectorLockup className="justify-center" />
        <h1 className="mt-6 font-display text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-md text-fg-secondary">{body}</p>
        {action &&
          (action.href ? (
            <a href={action.href} className="mt-6 inline-flex h-9 items-center rounded-md bg-accent px-4 text-md font-semibold text-fg-on-accent hover:bg-accent-hover">
              {action.label}
            </a>
          ) : (
            <button type="button" onClick={action.onClick} className="mt-6 h-9 rounded-md bg-accent px-4 text-md font-semibold text-fg-on-accent hover:bg-accent-hover">
              {action.label}
            </button>
          ))}
        {children}
      </div>
    </main>
  );
}

export function DirectorLockup({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-surface-3 text-accent-text">
        <Icon name="streamline:eye-optic" size={16} />
      </span>
      <span className="flex flex-col text-left leading-tight">
        <span className="text-2xs font-semibold uppercase tracking-[var(--bs-font-tracking-caps)] text-fg-tertiary">Betsee</span>
        <span className="font-display text-xl font-semibold">Director</span>
      </span>
    </div>
  );
}
