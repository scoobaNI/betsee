import { useAgentMessages, useAgents, useConnectors, useToolDrift, useTraces, type Agent, type ApprovalState, type Decision } from '@betsee/api';
import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Icon, type IconName } from '../components/icon.tsx';
import { Avatar, Card, EmptyState, ErrorCard, PageHeader, Skeleton } from '../components/ui.tsx';
import { callerOf, type Caller, type CallerKind } from '../domain/caller.ts';
import { outcomeTone } from '../domain/decision.ts';
import { edgeStyle, stoppedByBreaker, type EdgeLatest } from '../domain/graph-style.ts';
import { groupByTeam, teamName } from '../domain/feed.ts';

const W = 216;
const H = 60;
const GAP = 12;
const TEAM_GAP = 24;
const COLUMN_X = [0, 340, 680];
// Agent-to-agent labels sit in the gutter between the humans and agents columns.
const GUTTER_X = (COLUMN_X[0]! + W + COLUMN_X[1]!) / 2;
const SUB_WIDTH = W - 28 - 32 - 12; // node padding, mark, gap
const SUB_LINE = 14;
const TOP = 28;
// The live stack has no background traffic; an hour keeps the acts on the graph through a rehearsal.
const WINDOW_MS = 60 * 60_000;

type NodeKind = 'human' | 'caller' | 'agent' | 'tool' | 'connector';

interface GraphNode {
  id: string;
  /** Grows when a state message wraps; names truncate, state messages never do. */
  h: number;
  stateMessage: boolean;
  callerKind?: CallerKind;
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

    // Humans from sessions and traces, left column; non-human callers (unauthenticated requests,
    // the Gateway's own observer) go below them under OTHER CALLERS (p-420), never as humans.
    const callers = new Map<string, Caller>();
    for (const agent of agents.data ?? []) {
      if (agent.current_session) {
        const caller = callerOf(agent.current_session.human);
        callers.set(caller.id, caller);
      }
    }
    for (const t of recent) {
      const caller = callerOf(t.human, t.agent.id);
      callers.set(caller.id, caller);
    }
    y = TOP + TEAM_GAP;
    const byName = (a: Caller, b: Caller) => a.name.localeCompare(b.name);
    const people = [...callers.values()].filter((c) => c.kind === 'human').sort(byName);
    const others = [...callers.values()].filter((c) => c.kind !== 'human').sort(byName);
    for (const c of people) {
      nodes.set(`human:${c.id}`, { id: `human:${c.id}`, kind: 'human', label: c.name, sub: 'Human', x: COLUMN_X[0]!, y, h: H, stateMessage: false });
      y += H + GAP;
    }
    if (others.length) y += TEAM_GAP;
    for (const c of others) {
      nodes.set(`human:${c.id}`, { id: `human:${c.id}`, kind: 'caller', callerKind: c.kind, label: c.name, sub: c.id, x: COLUMN_X[0]!, y, h: H, stateMessage: false });
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
    // Live MCP traffic arrives on the mcp-demo connector: an action lands on its tool node.
    const mcpConnectors = new Set(
      (connectors.data ?? []).filter((c) => (c as { kind?: string }).kind === 'mcp').map((c) => c.id),
    );
    const isMcp = (connector: string) => mcpConnectors.has(connector) || connector.startsWith('mcp');
    const targetOf = (tool: { name: string; connector: string }) => (isMcp(tool.connector) ? `tool:${tool.name}` : `connector:${tool.connector}`);
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
      if (agent.current_session) {
        const caller = callerOf(agent.current_session.human).id;
        bump(`s:${caller}:${agent.id}`, `human:${caller}`, `agent:${agent.id}`, 'session', undefined);
      }
    }
    for (const t of recent) {
      const caller = callerOf(t.human, t.agent.id).id;
      bump(`s:${caller}:${t.agent.id}`, `human:${caller}`, `agent:${t.agent.id}`, 'session', latestOf(t));
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
  const frame =
    node.kind === 'caller'
      ? 'border-dashed border-line-strong bg-surface'
      : node.blocked
        ? 'border-bad/40 bg-bad-soft'
        : quarantined
          ? 'border-quar/40 bg-quar-soft'
          : node.state === 'suspended'
            ? 'border-line-strong bg-sunken'
            : 'border-line bg-surface';
  const icon: IconName = node.blocked ? 'shield-x' : node.kind === 'agent' ? 'bot' : node.kind === 'tool' ? 'wrench' : node.kind === 'caller' ? (node.callerKind === 'gateway' ? 'shield' : 'shield-x') : 'link';
  const mark =
    node.kind === 'human' ? (
      <Avatar name={node.label} size={32} />
    ) : (
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          node.blocked ? 'bg-surface text-bad-ink' : quarantined ? 'bg-surface text-quar-ink' : node.kind === 'agent' ? 'bg-accent-soft text-accent-ink' : 'bg-sunken text-ink-2'
        }`}
      >
        <Icon name={icon} size={16} />
      </span>
    );
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{ left: node.x, top: node.y, width: W, height: node.h }}
      className={`absolute flex items-center gap-3 rounded-xl border px-3.5 text-left shadow-card ${frame} ${onClick ? 'lift' : ''}`}
    >
      {mark}
      <span className="min-w-0">
        <span title={node.label} className="block truncate text-[13px] font-medium text-ink">
          {node.label}
        </span>
        <span
          title={node.stateMessage ? undefined : node.sub}
          className={`block text-[11px] ${node.kind === 'caller' || node.kind === 'tool' ? 'font-mono' : ''} ${node.stateMessage ? 'whitespace-normal' : 'truncate'} ${
            node.blocked ? 'text-bad-ink' : quarantined ? 'text-quar-ink' : 'text-ink-3'
          }`}
        >
          {node.sub}
        </span>
      </span>
    </Tag>
  );
}

const LEGEND = [
  { label: 'Allowed', stroke: 'var(--color-accent)', opacity: 0.55 },
  { label: 'Denied', stroke: 'var(--color-bad)' },
  { label: 'Awaiting approval', stroke: 'var(--color-wait)', dash: '4 4' },
  { label: 'Tightened by AI', stroke: 'var(--color-ai)' },
  { label: 'Quarantined sender', stroke: 'var(--color-quar)', dash: '4 4' },
];

const COLUMNS = ['People', 'Agents', 'Tools and connectors'];

export function GraphPage() {
  const graph = useGraph();
  const navigate = useNavigate();
  // Pulses only for events that arrive while the page is open, not for history on first paint.
  const seenAtMount = useRef<Set<string> | null>(null);
  if (!seenAtMount.current && !graph.loading) seenAtMount.current = new Set(graph.edges.map((e) => e.latest?.trace_id ?? ''));

  const header = (
    <PageHeader
      crumbs={[{ label: 'Overview', to: '/' }, { label: 'Graph' }]}
      title="Graph"
      description="Who launched which agent, what each agent touched, and which agents talked to each other, over the last hour. Click an agent to open it, a line to open its latest trace."
    />
  );

  if (graph.loading) {
    return (
      <div>
        {header}
        <Skeleton className="h-[600px]" />
      </div>
    );
  }
  if (graph.error) {
    return (
      <div>
        {header}
        <ErrorCard title="Could not load the graph" error={graph.error} />
      </div>
    );
  }
  if (graph.edges.every((e) => !e.latest)) {
    return (
      <div>
        {header}
        <Card>
          <EmptyState icon="map" title="No agent has acted in the last hour" body="Launch Act 1 from the demo controls, or start an agent." />
        </Card>
      </div>
    );
  }

  const width = COLUMN_X[2]! + W + 8;
  const firstCaller = [...graph.nodes.values()].find((n) => n.kind === 'caller');
  const teamLabels = [...graph.nodes.values()]
    .filter((n) => n.kind === 'agent')
    .reduce<{ team: string; y: number }[]>((acc, n) => (acc.some((t) => t.team === n.team) ? acc : [...acc, { team: n.team!, y: n.y - 20 }]), []);
  return (
    <div>
      {header}
      <Card className="scrollbar-quiet overflow-x-auto px-6 pt-6 pb-8 md:px-10">
        <ul className="mb-8 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-ink-2">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-2">
              <svg width="22" height="6" aria-hidden="true">
                <line x1="1" y1="3" x2="21" y2="3" stroke={item.stroke} strokeOpacity={item.opacity ?? 1} strokeWidth="2" strokeLinecap="round" strokeDasharray={item.dash} />
              </svg>
              {item.label}
            </li>
          ))}
        </ul>
        <div className="relative mx-auto" style={{ width, height: graph.height }}>
          {COLUMNS.map((title, i) => (
            <p key={title} style={{ left: COLUMN_X[i], top: 0, width: W }} className="absolute text-[12px] font-medium text-ink-3">
              {title}
            </p>
          ))}
          {firstCaller && (
            <p style={{ left: COLUMN_X[0], top: firstCaller.y - 20 }} className="absolute text-[11px] font-medium text-ink-3">
              Other callers
            </p>
          )}
          {teamLabels.map(({ team, y }) => (
            <p key={team} style={{ left: COLUMN_X[1], top: y }} className="absolute text-[11px] font-medium text-ink-3">
              {teamName(team)}
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
                  <path d={d} fill="none" stroke={style.stroke} strokeOpacity={style.opacity} strokeWidth={1.5} strokeLinecap="round" strokeDasharray={style.dash} />
                  {fresh && (
                    <path
                      key={edge.latest!.trace_id}
                      d={d}
                      fill="none"
                      className="edge-flow"
                      stroke={edge.latest!.decision === 'deny' ? 'var(--color-bad)' : 'var(--color-accent)'}
                      strokeWidth={3}
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
                      <title>{`${a.label} to ${b.label}: ${edge.count} in the last hour. Open the latest trace.`}</title>
                    </path>
                  )}
                </g>
              );
            })}
          </svg>
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
                className={`pointer-events-none absolute flex max-w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-lg border bg-surface px-2 py-1 text-center text-[11px] leading-tight font-medium shadow-card ${
                  denied ? 'border-bad/30 text-bad-ink' : 'border-line text-ink-2'
                }`}
              >
                <span className="flex items-center gap-1">
                  {breaker && <Icon name="power" size={11} />}
                  {breaker ? 'breaker open' : denied ? 'denied' : ''}
                </span>
                {edge.count > 1 && <span className="font-mono text-ink-3 tabular-nums">x{edge.count}</span>}
              </span>
            );
          })}
          {[...graph.nodes.values()].map((node) => (
            <NodeCard key={node.id} node={node} onClick={node.kind === 'agent' ? () => navigate(`/agents/${encodeURIComponent(node.label)}`) : undefined} />
          ))}
        </div>
      </Card>
    </div>
  );
}
