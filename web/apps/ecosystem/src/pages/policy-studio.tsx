import { useState } from "react";
import { useParams, Link } from "react-router";
import { ControlCard, Icon, IdToken, TierBadge } from "@betsee/ui";
import {
  useControlCatalog,
  usePolicies,
  useUseCases,
} from "@betsee/api/resources/ecosystem";
import { PageHeader, Tabs } from "../layout";
import { ResourceState } from "../resource-state";

const tabs = ["controls", "policies", "use-cases"].map((section) => ({
  href: `/policy-studio/${section}`,
  label:
    section === "use-cases"
      ? "Use cases"
      : section[0].toUpperCase() + section.slice(1),
}));
export function PolicyStudio() {
  const { section, id } = useParams();
  return (
    <>
      <PageHeader
        product="Policy Studio"
        icon="streamline-flex:justice-scale-1"
        title={
          section === "policies"
            ? "Cedar policies"
            : section === "use-cases"
              ? "Use cases"
              : "Controls catalog"
        }
        purpose="Controls, Cedar policies and use cases in one place."
      />
      <Tabs items={tabs} />
      {section === "controls" ? (
        <Controls selectedId={id} />
      ) : section === "policies" ? (
        <Policies selectedId={id} />
      ) : section === "use-cases" ? (
        <UseCases selectedId={id} />
      ) : (
        <p>Unknown Policy Studio section.</p>
      )}
    </>
  );
}

function Controls({ selectedId }: { selectedId?: string }) {
  const query = useControlCatalog();
  const [search, setSearch] = useState("");
  const [asi, setAsi] = useState("all");
  const items =
    query.data?.filter(
      (c) =>
        `${c.id} ${c.name} ${c.description}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (asi === "all" || c.asi.includes(asi)),
    ) ?? [];
  const selected = query.data?.find((c) => c.id === selectedId);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-secondary">
          {query.data?.length ?? "—"} controls · one explainable guarantee per
          control
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 rounded-sm border border-line-default bg-surface-3 px-3">
            <Icon name="streamline-flex:magnifying-glass" />
            <input
              aria-label="Search controls"
              placeholder="Find a control"
              className="h-9 min-w-0 bg-transparent text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Filter by ASI risk"
            className="h-9 rounded-sm border border-line-default bg-surface-3 px-3 text-sm"
            value={asi}
            onChange={(e) => setAsi(e.target.value)}
          >
            <option value="all">All ASI risks</option>
            {Array.from(
              { length: 10 },
              (_, i) => `ASI${String(i + 1).padStart(2, "0")}`,
            ).map((risk) => (
              <option key={risk}>{risk}</option>
            ))}
          </select>
        </div>
      </div>
      <ResourceState
        query={query}
        noun="controls"
        empty={!items.length}
        emptyTitle={
          search || asi !== "all"
            ? "No matching controls"
            : "No controls registered"
        }
        emptyHint={
          search || asi !== "all"
            ? "Change the search or risk filter."
            : undefined
        }
      >
        {selected ? (
          <div className="eco-detail">
            <ControlCard control={selected} selected />
            <section className="eco-detail-panel rounded-lg border border-line-subtle bg-surface-1 p-5">
              <h2 className="font-display text-xl font-semibold">
                {selected.name}
              </h2>
              <p className="mt-3 text-md text-fg-secondary">
                {selected.description}
              </p>
              <h3 className="mt-6 text-md font-semibold">Attachment points</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.attachment_points.map((point) => (
                  <IdToken key={point} copy={false}>
                    {point}
                  </IdToken>
                ))}
              </div>
              <h3 className="mt-6 text-md font-semibold">Attached to</h3>
              {selected.attachments.length ? (
                <dl className="mt-3 space-y-3">
                  {selected.attachments.map((a) => (
                    <div key={a.id}>
                      <dt className="text-sm text-fg-secondary">
                        {a.target_type.replaceAll("_", " ")}
                      </dt>
                      <dd className="mt-1">
                        <IdToken>{a.target_id}</IdToken>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-fg-secondary">
                  Organization baseline or no explicit attachment.
                </p>
              )}
              <h3 className="mt-6 text-md font-semibold">Deciding policies</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.policy_ids.map((policy) => (
                  <IdToken
                    key={policy}
                    id={policy}
                    href={`/policy-studio/policies/${encodeURIComponent(policy)}`}
                  />
                ))}
              </div>
              <Link
                className="mt-6 inline-block text-sm text-accent-text"
                to="/policy-studio/controls"
              >
                All controls
              </Link>
            </section>
          </div>
        ) : selectedId ? (
          <p role="alert">Control not found.</p>
        ) : (
          <div className="eco-grid">
            {items.map((control) => (
              <ControlCard key={control.id} control={control} />
            ))}
          </div>
        )}
      </ResourceState>
    </>
  );
}

function Policies({ selectedId }: { selectedId?: string }) {
  const query = usePolicies();
  const selected =
    query.data?.find((policy) => policy.id === selectedId) ?? query.data?.[0];
  return (
    <ResourceState query={query} noun="policies" empty={!query.data?.length}>
      <div className="eco-detail">
        <div className="space-y-2">
          {query.data?.map((policy) => (
            <Link
              key={policy.id}
              to={`/policy-studio/policies/${encodeURIComponent(policy.id)}`}
              className={`block rounded-lg border border-line-subtle p-4 ${selected?.id === policy.id ? "bg-surface-2 shadow-selected" : "bg-surface-1 hover:bg-surface-2"}`}
            >
              <IdToken copy={false}>{policy.id}</IdToken>
              <p className="mt-2 text-sm text-fg-secondary">{policy.name}</p>
            </Link>
          ))}
        </div>
        {selected && (
          <article className="eco-detail-panel rounded-lg border border-line-subtle bg-surface-1 p-5">
            <h2 className="text-lg font-semibold">{selected.name}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {selected.control_ids.map((control) => (
                <IdToken
                  key={control}
                  id={control}
                  href={`/policy-studio/controls/${encodeURIComponent(control)}`}
                />
              ))}
            </div>
            <pre className="mt-5 overflow-x-auto rounded-sm bg-surface-inset p-4 font-mono text-sm leading-relaxed">
              {selected.cedar}
            </pre>
            <p className="mt-4 text-sm text-fg-secondary">
              Cedar evaluates the execution context. An explicit deny always
              wins.
            </p>
          </article>
        )}
      </div>
    </ResourceState>
  );
}

function UseCases({ selectedId }: { selectedId?: string }) {
  const query = useUseCases();
  const items = selectedId
    ? query.data?.filter((useCase) => useCase.id === selectedId)
    : query.data;
  return (
    <ResourceState query={query} noun="use cases" empty={!items?.length}>
      <div className="eco-grid">
        {items?.map((useCase) => (
          <article
            key={useCase.id}
            className="rounded-lg border border-line-subtle bg-surface-1 p-5"
          >
            <Icon
              name="streamline-flex:target"
              size={28}
              className="text-fg-secondary"
            />
            <h2 className="mt-4 font-display text-xl font-semibold">
              {useCase.name}
            </h2>
            <div className="mt-3">
              <IdToken
                id={useCase.id}
                href={`/policy-studio/use-cases/${encodeURIComponent(useCase.id)}`}
              />
            </div>
            <div className="mt-4">
              <TierBadge tier={useCase.tier_ceiling} />
            </div>
            <h3 className="mt-5 text-sm font-semibold">Capability ceiling</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {useCase.permitted.map((c) => (
                <IdToken key={c}>{c}</IdToken>
              ))}
            </div>
            <h3 className="mt-5 text-sm font-semibold">Approval rules</h3>
            <p className="mt-2 text-sm text-fg-secondary">
              {useCase.approval_required.length
                ? `${useCase.approval_required.join(", ")} requires a human decision.`
                : "No additional approval obligation."}
            </p>
            {useCase.step_up_required.length > 0 && (
              <p className="mt-2 text-sm text-fg-secondary">
                {useCase.step_up_required.join(", ")} requires step-up
                {useCase.approval_threshold_cents > 0
                  ? ` above ${(useCase.approval_threshold_cents / 100).toLocaleString("en-US")} EUR`
                  : ""}
                .
              </p>
            )}
            <p className="mt-5 border-t border-line-subtle pt-4 text-sm text-fg-secondary">
              Budget ceiling{" "}
              <span className="font-mono text-fg-primary">
                {(useCase.budget.limit / 100).toLocaleString("en-US")} EUR
              </span>
            </p>
          </article>
        ))}
      </div>
    </ResourceState>
  );
}
