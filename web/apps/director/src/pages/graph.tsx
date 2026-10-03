import { toolKey, useAgentMessages, useAgents, useConnectors, useToolDrift, useTraces, type Agent, type Decision, type ApprovalState } from '@betsee/api';
import { Icon } from '@betsee/ui';
import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { ErrorCard, Skeleton } from '../components/states.tsx';
import { outcomeTone } from '../domain/decision.ts';
import { edgeStyle, stoppedByBreaker, type EdgeLatest } from '../domain/graph-style.ts';
import { groupByTeam, teamName } from '../domain/feed.ts';
import { initials } from '../domain/format.ts';

const W = 208;
const H = 56;
const GAP = 16;
const TEAM_GAP = 28;
const COLUMN_X = [0, 320, 636];
// Agent-to-agent labels sit in the gutter between the humans and agents columns (contract GraphCanvas).
const GUTTER_X = (COLUMN_X[0]! + W + COLUMN_X[1]!) / 2;
const SUB_WIDTH = W - 24 - 32 - 12; // node padding, mark, gap
const SUB_LINE = 14;
const TOP = 36;
const WINDOW_MS = 15 * 60_000;

type NodeKind = 'human' | 'agent' | 'tool' | 'connector';

interface GraphNode {
  id: string;
  /** Grows when a state message wraps; names truncate, state messages never do. */
  h: number;
  stateMessage: boolean;
  kind: NodeKind;
  label: string;
  sub: string;
  x: number;
  y: number;
  state?: Agent['state'];
  blocked?: boolean;
  team?: string;
}

type Latest = EdgeLatest;

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'session' | 'action' | 'message';
  latest: Latest | undefined;
  count: number;
  /** A message on this edge was stopped by the circuit breaker or by the quarantine it triggered. */
  breaker: boolean;
}




/** Height for a node whose sub line wraps; 11px text averages about 6.4px per character. */
const nodeHeight = (sub: string, stateMessage: boolean) =>
  stateMessage ? H + (Math.max(1, Math.ceil((sub.length * 6.4) / SUB_WIDTH)) - 1) * SUB_LINE : H;

function path(a: GraphNode, b: GraphNode, sameColumn: boolean) {
  if (sameColumn) {
    // Agent-to-agent traffic loops into the gutter left of the agents column, away from tool edges;
    // a cubic with both control points at x - bulge reaches about x - 0.75 * bulge.
    const x1 = a.x;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const bulge = (x1 - GUTTER_X) / 0.75;
    return { d: `M ${x1} ${y1} C ${x1 - bulge} ${y1}, ${x2 - bulge} ${y2}, ${x2} ${y2}`, mx: GUTTER_X, my: (y1 + y2) / 2 };
  }
  const x1 = a.x + W;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  const dx = (x2 - x1) / 2;
  return { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}

function useGraph() {
  const agents = useAgents();
  const traces = useTraces();
  const messages = useAgentMessages();
  const connectors = useConnectors();
  const drift = useToolDrift();

  return useMemo(() => {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const now = Date.now();
    const recent = (traces.data ?? []).filter((t) => now - Date.parse(t.occurred_at) <= WINDOW_MS);

    // Agents, grouped by team in the middle column.
    let y = TOP;
    for (const [team, list] of groupByTeam(agents.data ?? [])) {
      y += TEAM_GAP;
      for (const agent of list) {
        const sub = `${teamName(team)} - ${agent.state}`;
        const stateMessage = agent.state !== 'active';
        const h = nodeHeight(sub, stateMessage);
        nodes.set(`agent:${agent.id}`, { id: `agent:${agent.id}`, kind: 'agent', label: agent.id, sub, x: COLUMN_X[1]!, y, h, stateMessage, state: agent.state, team });
        y += h + GAP;
      }
    }

    // Humans from sessions and traces, left column.
    const humans = new Map<string, string>();
    for (const agent of agents.data ?? []) if (agent.current_session) humans.set(agent.current_session.human.sub, agent.current_session.human.display_name);
    for (const t of recent) humans.set(t.human.sub, t.human.display_name);
    y = TOP + TEAM_GAP;
    for (const [sub, name] of [...humans].sort((a, b) => a[1].localeCompare(b[1]))) {
      nodes.set(`human:${sub}`, { id: `human:${sub}`, kind: 'human', label: name, sub: 'Human', x: COLUMN_X[0]!, y, h: H, stateMessage: false });
      y += H + GAP;
    }

    // Tools and connectors, right column: catalog first, then anything seen in traces.
    const tools = new Map<string, { kind: NodeKind; label: string; sub: string; blocked: boolean }>();
    for (const connector of connectors.data ?? []) {
      const list = (connector as { tools?: unknown[] }).tools ?? [];
      if (!list.length && (connector as { status?: string }).status === 'connected') {
        tools.set(`connector:${connector.id}`, { kind: 'connector', label: connector.id, sub: (connector as { model_label?: string | null }).model_label ?? 'Connector', blocked: false });
      }
      for (const raw of list) {
        const tool = raw as { name: string; pinned_hash?: string; status?: string };
        const blocked = tool.status === 'blocked';
        tools.set(`tool:${tool.name}`, { kind: 'tool', label: tool.name, sub: tool.pinned_hash ? `pinned ${tool.pinned_hash.slice(0, 14)}` : 'MCP tool', blocked });
      }
    }
    const targetOf = (tool: { name: string; connector: string }) => (tool.connector === 'mcp' ? `tool:${tool.name}` : `connector:${tool.connector}`);
    for (const t of recent) {
      if (!t.tool) continue;
      const key = targetOf(t.tool);
      if (!tools.has(key)) tools.set(key, { kind: key.startsWith('tool:') ? 'tool' : 'connector', label: key.startsWith('tool:') ? t.tool.name : t.tool.connector, sub: key.startsWith('tool:') ? 'MCP tool' : 'Connector', blocked: false });
    }
    for (const [key, change] of drift) {
      const name = key.split('/')[1]!;
      const existing = tools.get(`tool:${name}`);
      tools.set(`tool:${name}`, { kind: 'tool', label: name, sub: existing?.sub ?? 'MCP tool', blocked: change.status === 'blocked' });
    }
    y = TOP + TEAM_GAP;
    for (const [key, tool] of [...tools].sort((a, b) => a[0].localeCompare(b[0]))) {
      const sub = tool.blocked ? 'Descriptor changed - blocked' : tool.sub;
      const h = nodeHeight(sub, tool.blocked);
      nodes.set(key, { id: key, kind: tool.kind, label: tool.label, sub, x: COLUMN_X[2]!, y, h, stateMessage: tool.blocked, blocked: tool.blocked });
      y += h + GAP;
    }

    const bump = (id: string, from: string, to: string, kind: GraphEdge['kind'], latest: Latest | undefined) => {
      const edge = edges.get(id);
      const breaker = kind === 'message' && stoppedByBreaker(latest);
      if (!edge) {
        edges.set(id, { id, from, to, kind, latest, count: latest ? 1 : 0, breaker });
        return;
      }
      edge.breaker ||= breaker;
      if (latest) {
        edge.count++;
        if (!edge.latest || latest.at > edge.latest.at) edge.latest = latest;
      }
    };
    const latestOf = (t: { trace_id: string; decision: Decision; approval_state: ApprovalState; ai_tightened: boolean; control_ids: string[]; occurred_at: string }): Latest => ({
      trace_id: t.trace_id,
      decision: t.decision,
      approval_state: t.approval_state,
      ai_tightened: t.ai_tightened,
      control_ids: t.control_ids,
      at: t.occurred_at,
    });

    for (const agent of agents.data ?? []) {
      if (agent.current_session) bump(`s:${agent.current_session.human.sub}:${agent.id}`, `human:${agent.current_session.human.sub}`, `agent:${agent.id}`, 'session', undefined);
    }
    for (const t of recent) {
      bump(`s:${t.human.sub}:${t.agent.id}`, `human:${t.human.sub}`, `agent:${t.agent.id}`, 'session', latestOf(t));
      if (t.tool && t.capability !== 'agent.message') bump(`a:${t.agent.id}:${targetOf(t.tool)}`, `agent:${t.agent.id}`, targetOf(t.tool), 'action', latestOf(t));
    }
    for (const m of messages.data ?? []) {
      if (now - Date.parse(m.occurred_at) > WINDOW_MS) continue;
      bump(`m:${m.sender.id}:${m.receiver.id}`, `agent:${m.sender.id}`, `agent:${m.receiver.id}`, 'message', {
        trace_id: m.trace_id,
        decision: m.decision,
        approval_state: 'none',
        ai_tightened: false,
        control_ids: m.control_ids ?? [],
        at: m.occurred_at,
      });
    }
    const height = Math.max(...[...nodes.values()].map((n) => n.y + n.h), TOP + 200) + 24;
    return {
      nodes,
      edges: [...edges.values()].filter((e) => nodes.has(e.from) && nodes.has(e.to)),
      height,
      loading: agents.isPending || traces.isPending,
      error: agents.error ?? traces.error,
      agentsById: new Map((agents.data ?? []).map((a) => [a.id, a])),
    };
  }, [agents.data, agents.isPending, agents.error, traces.data, traces.isPending, traces.error, messages.data, connectors.data, drift]);
}

function NodeCard({ node, onClick }: { node: GraphNode; onClick?: () => void }) {
  const quarantined = node.state === 'quarantined';
  const border = node.blocked ? 'border-deny-fg' : quarantined ? 'border-quarantined-border dir-quarantined' : node.state === 'suspended' ? 'border-suspended-border dir-suspended' : 'border-line-default';
  const mark =
    node.kind === 'human' ? (
      <span className="flex h-8 w-8 items-center justify-center rounded-pill bg-surface-3 text-xs font-semibold text-fg-secondary">{initials(node.label)}</span>
    ) : (
      <span className={`flex h-8 w-8 items-center justify-center rounded-sm bg-surface-3 ${node.blocked ? 'text-deny-fg' : quarantined ? 'text-quarantined-fg' : node.kind === 'agent' ? 'text-accent-text' : 'text-fg-secondary'}`}>
        <Icon
          name={node.blocked ? 'streamline-flex:shield-cross' : node.kind === 'agent' ? 'streamline-flex:ai-chip-robot' : node.kind === 'tool' ? 'streamline-flex:wrench-hand' : 'streamline-flex:link-chain'}
          size={16}
        />
      </span>
    );
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{ left: node.x, top: node.y, width: W, height: node.h }}
      className={`absolute flex items-center gap-3 rounded-md border bg-surface-1 px-3 text-left shadow-e1 ${border} ${onClick ? 'hover:shadow-e2' : ''}`}
    >
      {mark}
      <span className="min-w-0">
        <span title={node.label} className={`block truncate text-sm ${node.kind === 'human' ? '' : 'font-mono font-medium'}`}>{node.label}</span>
        <span title={node.stateMessage ? undefined : node.sub} className={`block text-2xs ${node.stateMessage ? 'whitespace-normal' : 'truncate'} ${node.blocked ? 'text-deny-fg' : quarantined ? 'text-quarantined-fg' : node.kind === 'tool' ? 'font-mono text-fg-tertiary' : 'text-fg-secondary'}`}>{node.sub}</span>
      </span>
      <span aria-hidden="true" className="absolute -left-0.75 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-pill border border-line-strong bg-surface-3" />
      <span aria-hidden="true" className="absolute -right-0.75 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-pill border border-line-strong bg-surface-3" />
    </Tag>
  );
}

const LEGEND = [
  { label: 'Allowed', stroke: 'var(--bs-color-accent-default)', opacity: 0.55 },
  { label: 'Denied', stroke: 'var(--bs-color-decision-deny-fg)' },
  { label: 'Awaiting approval', stroke: 'var(--bs-color-decision-approval-fg)', dash: '4 4' },
  { label: 'AI-tightened', stroke: 'var(--bs-color-modifier-ai-tightened-fg)' },
  { label: 'Quarantined sender', stroke: 'var(--bs-color-lifecycle-quarantined-fg)', dash: '4 4' },
];

export function GraphPage() {
  const graph = useGraph();
  const navigate = useNavigate();
  // Pulses only for events that arrive while the page is open, not for history on first paint.
  const seenAtMount = useRef<Set<string> | null>(null);
  if (!seenAtMount.current && !graph.loading) seenAtMount.current = new Set(graph.edges.map((e) => e.latest?.trace_id ?? ''));

  if (graph.loading) return <Skeleton className="h-[640px]" />;
  if (graph.error) return <ErrorCard title="Could not load the graph" error={graph.error} />;

  const width = COLUMN_X[2]! + W + 8;
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-[var(--bs-font-tracking-display)]">Agent graph</h1>
          <p className="mt-1 text-sm text-fg-secondary">Who launched which agent, what each agent touched, and which agents talked, over the last 15 minutes.</p>
        </div>
        <ul className="ml-auto flex flex-wrap gap-4 text-xs text-fg-secondary">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <svg width="22" height="6" aria-hidden="true">
                <line x1="1" y1="3" x2="21" y2="3" stroke={item.stroke} strokeOpacity={item.opacity ?? 1} strokeWidth="2" strokeDasharray={item.dash} />
              </svg>
              {item.label}
            </li>
          ))}
        </ul>
      </header>
      <div className="overflow-x-auto rounded-xl border border-line-subtle p-4">
        <div className="relative mx-auto" style={{ width, height: graph.height }}>
          {['Humans', 'Agents', 'Tools and connectors'].map((title, i) => (
            <p key={title} style={{ left: COLUMN_X[i], top: 0, width: W }} className="absolute text-2xs font-semibold uppercase tracking-[var(--bs-font-tracking-caps)] text-fg-tertiary">
              {title}
            </p>
          ))}
          <svg className="absolute inset-0 overflow-visible" width={width} height={graph.height} aria-hidden="true">
            {graph.edges.map((edge) => {
              const a = graph.nodes.get(edge.from)!;
              const b = graph.nodes.get(edge.to)!;
              const { d } = path(a, b, edge.kind === 'message');
              const sourceState = graph.agentsById.get(a.label)?.state;
              const style = edgeStyle(edge, a.kind === 'agent' ? sourceState : undefined);
              const fresh = edge.kind !== 'session' && edge.latest && seenAtMount.current && !seenAtMount.current.has(edge.latest.trace_id);
              return (
                <g key={edge.id}>
                  <path d={d} fill="none" stroke={style.stroke} strokeOpacity={style.opacity} strokeWidth={1.5} strokeDasharray={style.dash} />
                  {fresh && (
                    <path
                      key={edge.latest!.trace_id}
                      d={d}
                      fill="none"
                      className="dir-edge-flow"
                      stroke={edge.latest!.decision === 'deny' ? 'var(--bs-color-decision-deny-fg)' : 'var(--bs-color-accent-edge)'}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                    />
                  )}
                  {edge.latest && (
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={12}
                      className="pointer-events-auto cursor-pointer"
                      onClick={() => navigate(`/traces/${encodeURIComponent(edge.latest!.trace_id)}`)}
                    >
                      <title>{`${a.label} to ${b.label}: ${edge.count} in 15 min. Open the latest trace.`}</title>
                    </path>
                  )}
                </g>
              );
            })}
          </svg>
          {[...graph.nodes.values()]
            .filter((n) => n.kind === 'agent' && graph.nodes.get(`agent:${n.label}`) === n)
            .reduce<{ team: string; y: number }[]>((acc, n) => (acc.some((t) => t.team === n.team) ? acc : [...acc, { team: n.team!, y: n.y - 20 }]), [])
            .map(({ team, y }) => (
              <p key={team} style={{ left: COLUMN_X[1], top: y }} className="absolute bg-app px-0.5 text-2xs text-fg-tertiary">
                {teamName(team)}
              </p>
            ))}
          {graph.edges.map((edge) => {
            const latest = edge.latest;
            const denied = latest && outcomeTone(latest) === 'deny';
            // Labels only on agent-to-agent traffic; on tool edges the colour says it and labels pile up.
            if (edge.kind !== 'message' || (!denied && edge.count < 2)) return null;
            const a = graph.nodes.get(edge.from)!;
            const b = graph.nodes.get(edge.to)!;
            const { mx, my } = path(a, b, edge.kind === 'message');
            const breaker = edge.breaker && denied;
            return (
              <span
                key={`label-${edge.id}`}
                style={{ left: mx, top: my }}
                className={`dir-overlay pointer-events-none absolute flex max-w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-md border border-line-subtle px-1.5 py-0.5 text-center text-2xs font-semibold leading-tight ${
                  denied ? 'text-deny-fg' : 'text-fg-secondary'
                }`}
              >
                <span className="flex items-center gap-1">
                  {breaker && <Icon name="streamline-flex:button-power-1" size={12} />}
                  {breaker ? 'breaker open' : denied ? 'denied' : ''}
                </span>
                {edge.count > 1 && <span className="font-mono tabular-nums text-fg-secondary">x{edge.count}</span>}
              </span>
            );
          })}
          {[...graph.nodes.values()].map((node) => (
            <NodeCard key={node.id} node={node} onClick={node.kind === 'agent' ? () => navigate(`/agents/${encodeURIComponent(node.label)}`) : undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}
