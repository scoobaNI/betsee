import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@betsee/ui";
import { ApiRequestError } from "@betsee/api";

interface QueryState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: unknown;
  dataUpdatedAt: number;
  refetch: () => unknown;
}
export function ResourceState({
  query,
  noun,
  empty = false,
  emptyTitle,
  emptyHint,
  children,
}: {
  query: QueryState;
  noun: string;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  children: ReactNode;
}) {
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowSkeleton(true), 150);
    return () => clearTimeout(timer);
  }, []);
  if (query.isPending)
    return (
      <div
        aria-busy="true"
        aria-label={`Loading ${noun}`}
        className="eco-grid min-h-48"
      >
        {showSkeleton &&
          [0, 1, 2].map((n) => (
            <div key={n} className="bs-skeleton h-48 rounded-lg bg-surface-2" />
          ))}
      </div>
    );
  if (query.isError && !query.data) {
    const forbidden =
      query.error instanceof ApiRequestError && query.error.status === 403;
    return (
      <div
        role="alert"
        className="rounded-lg border border-line-default bg-surface-1 p-6"
      >
        <Icon
          name={
            forbidden
              ? "streamline-flex:padlock-square-1"
              : "streamline-flex:warning-diamond"
          }
          size={28}
          className="text-danger"
        />
        <h2 className="mt-4 text-lg font-semibold">
          {forbidden ? "Permission required" : `Could not load ${noun}`}
        </h2>
        <p className="mt-2 break-all font-mono text-sm text-fg-secondary">
          {query.error instanceof Error
            ? query.error.message
            : "Gateway unreachable"}
        </p>
        {query.error instanceof ApiRequestError && query.error.traceId && (
          <p className="mt-2 break-all font-mono text-sm text-fg-secondary">
            Trace: {query.error.traceId}
          </p>
        )}
        {forbidden ? (
          <p className="mt-3 text-md text-fg-secondary">
            {noun === "approvals"
              ? "Approvals require the approver or security-officer role. Contact your organization admin."
              : `Your role cannot access ${noun}. Contact your organization admin.`}
          </p>
        ) : (
          <button
            className="mt-4 rounded-md border border-line-default px-4 py-2"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      {query.isError && (
        <div
          role="alert"
          className="mb-5 flex items-center justify-between gap-4 border-l-2 border-danger bg-surface-1 p-4 text-sm text-fg-secondary"
        >
          <span>
            Gateway unreachable. Showing data as of{" "}
            {new Date(query.dataUpdatedAt).toLocaleTimeString([], {
              hour12: false,
            })}
            .
          </span>
          <button
            onClick={() => {
              void query.refetch();
            }}
            className="rounded-md border border-line-default px-3 py-2"
          >
            Retry
          </button>
        </div>
      )}
      {empty ? (
        <div className="rounded-lg border border-line-subtle bg-surface-1 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-surface-2">
            <Icon
              name="streamline-flex:inbox"
              size={28}
              className="text-fg-tertiary"
            />
          </span>
          <h2 className="mt-4 text-md font-semibold">
            {emptyTitle ?? `No ${noun} yet`}
          </h2>
          <p className="mt-2 px-5 text-md text-fg-secondary">
            {emptyHint ??
              "Run scripts/bootstrap to register the initial organization."}
          </p>
        </div>
      ) : (
        children
      )}
    </>
  );
}
