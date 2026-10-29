import type { AgentModel, WorkspaceModel } from './model';

const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
const label = (s: string) => s.replace(/["<>]/g, "'");

function counts(a: AgentModel): string {
  const by = (cat: string) => a.components.filter((c) => c.category === cat).length;
  const parts =
    a.harness === 'standard'
      ? [`topics ${by('topic')}`, `actions ${by('action')}`, `knowledge ${by('knowledge')}`]
      : [`skills ${by('skill')}`, `tools ${a.components.filter((c) => c.category === 'tool' && c.kind !== 'ConnectedAgentTool').length}`, `knowledge ${by('knowledge')}`];
  return parts.join(' · ');
}

/** Simple layered layout (orchestrators left, delegated agents right) used by the SVG graph view. */
export interface LayoutNode {
  key: string;
  label: string;
  subtitle: string;
  x: number;
  y: number;
  orchestrator: boolean;
  external: boolean;
  file?: string;
}
export interface LayoutEdge {
  from: string;
  to: string;
  label: string;
}

export function layout(ws: WorkspaceModel): { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number } {
  const keyOf = (a: AgentModel) => a.schemaName ?? a.name;
  const edges: LayoutEdge[] = [];
  for (const a of ws.agents) {
    for (const c of a.components.filter((x) => x.kind === 'ConnectedAgentTool')) {
      edges.push({ from: keyOf(a), to: c.targetAgentSchema ?? c.name, label: c.name });
    }
  }
  const targets = new Set(edges.map((e) => e.to));
  const sources = new Set(edges.map((e) => e.from));
  const known = new Map(ws.agents.map((a) => [keyOf(a), a]));
  const layers: string[][] = [[], [], []];
  for (const a of ws.agents) {
    const k = keyOf(a);
    if (sources.has(k) && !targets.has(k)) layers[0].push(k);
    else if (targets.has(k)) layers[1].push(k);
    else layers[2].push(k);
  }
  for (const t of targets) if (!known.has(t)) layers[1].push(t);

  const W = 260;
  const H = 64;
  const nodes: LayoutNode[] = [];
  let maxRows = 0;
  layers.forEach((layer, li) => {
    maxRows = Math.max(maxRows, layer.length);
    layer.forEach((k, i) => {
      const a = known.get(k);
      nodes.push({
        key: k,
        label: a?.name ?? k,
        subtitle: a ? `${a.harness} · ${counts(a)}` : 'not cloned in workspace',
        x: 40 + li * (W + 140),
        y: 40 + i * (H + 24),
        orchestrator: sources.has(k),
        external: !a,
        file: a?.settingsFile ?? a?.agentFile
      });
    });
  });
  return { nodes, edges, width: 40 + 3 * (W + 140), height: 80 + maxRows * (H + 24) };
}

/** Mermaid flowchart of agents and their connected-agent edges. */
export function toMermaid(ws: WorkspaceModel): string {
  const lines = ['flowchart LR'];
  const bySchema = new Map(ws.agents.filter((a) => a.schemaName).map((a) => [a.schemaName!, a]));
  const external = new Set<string>();

  for (const a of ws.agents) {
    lines.push(`  ${id(a.schemaName ?? a.name)}["${label(a.name)}<br/><small>${a.harness} · ${counts(a)}</small>"]`);
  }
  for (const a of ws.agents) {
    for (const c of a.components.filter((x) => x.kind === 'ConnectedAgentTool')) {
      const target = c.targetAgentSchema ?? c.name;
      if (!bySchema.has(target) && !external.has(target)) {
        external.add(target);
        lines.push(`  ${id(target)}(["${label(target)} (not cloned)"])`);
      }
      lines.push(`  ${id(a.schemaName ?? a.name)} -->|${label(c.name)}| ${id(target)}`);
    }
  }
  const orchestrators = ws.agents.filter((a) => a.components.some((c) => c.kind === 'ConnectedAgentTool'));
  if (orchestrators.length) {
    lines.push('  classDef orchestrator fill:#2b6cb0,color:#fff,stroke:#1a4971');
    lines.push(`  class ${orchestrators.map((o) => id(o.schemaName ?? o.name)).join(',')} orchestrator`);
  }
  return lines.join('\n');
}
