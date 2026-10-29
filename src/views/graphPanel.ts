import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { layout, toMermaid, type Finding, type WorkspaceModel } from '../core';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class GraphPanel {
  private static current: GraphPanel | undefined;
  private model: WorkspaceModel;
  private findings: Finding[];

  private constructor(private readonly panel: vscode.WebviewPanel, model: WorkspaceModel, findings: Finding[]) {
    this.model = model;
    this.findings = findings;
    panel.onDidDispose(() => (GraphPanel.current = undefined));
    panel.webview.onDidReceiveMessage(async (msg: { type: string; file?: string }) => {
      if (msg.type === 'copyMermaid') {
        await vscode.env.clipboard.writeText(toMermaid(this.model));
        void vscode.window.showInformationMessage('Agent Forge: Mermaid diagram copied to clipboard.');
      } else if (msg.type === 'open' && msg.file && this.model.agents.some((a) => a.settingsFile === msg.file || a.agentFile === msg.file)) {
        await vscode.window.showTextDocument(vscode.Uri.file(msg.file));
      }
    });
    this.render();
  }

  static show(model: WorkspaceModel, findings: Finding[]) {
    if (GraphPanel.current) {
      GraphPanel.current.update(model, findings);
      GraphPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('agentForge.graph', 'Agent Architecture', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: []
    });
    GraphPanel.current = new GraphPanel(panel, model, findings);
  }

  static refresh(model: WorkspaceModel, findings: Finding[]) {
    GraphPanel.current?.update(model, findings);
  }

  private update(model: WorkspaceModel, findings: Finding[]) {
    this.model = model;
    this.findings = findings;
    this.render();
  }

  private render() {
    const nonce = randomBytes(16).toString('hex');
    const { nodes, edges, width, height } = layout(this.model);
    const pos = new Map(nodes.map((n) => [n.key, n]));
    const W = 260;
    const H = 64;
    const issues = (name: string) => this.findings.filter((f) => f.agent === name && f.severity !== 'info').length;

    const edgeSvg = edges
      .map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return '';
        const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
        return `<path class="edge" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" marker-end="url(#arrow)"><title>${esc(e.label)}</title></path>`;
      })
      .join('');

    const nodeSvg = nodes
      .map((n) => {
        const count = issues(n.label);
        const cls = n.external ? 'node external' : n.orchestrator ? 'node orchestrator' : 'node';
        return `<g class="${cls}" data-file="${esc(n.file ?? '')}" tabindex="0" role="button" aria-label="${esc(n.label)}">
          <rect x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="8"/>
          <text x="${n.x + 12}" y="${n.y + 26}" class="title">${esc(n.label.length > 32 ? n.label.slice(0, 31) + '…' : n.label)}</text>
          <text x="${n.x + 12}" y="${n.y + 46}" class="sub">${esc(n.subtitle)}</text>
          ${count ? `<text x="${n.x + W - 12}" y="${n.y + 26}" class="badge" text-anchor="end">⚠ ${count}</text>` : ''}
        </g>`;
      })
      .join('');

    const summary = `${this.model.agents.length} agents · ${edges.length} delegations · ${this.findings.filter((f) => f.severity === 'error').length} errors · ${this.findings.filter((f) => f.severity === 'warning').length} warnings`;

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  header { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; }
  .node rect { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-editorWidget-border, #888); stroke-width: 1.5; }
  .node.orchestrator rect { stroke: var(--vscode-focusBorder); stroke-width: 2.5; }
  .node.external rect { stroke-dasharray: 5 4; opacity: .7; }
  .node { cursor: pointer; } .node:focus rect, .node:hover rect { stroke: var(--vscode-focusBorder); }
  .title { fill: var(--vscode-foreground); font-weight: 600; font-size: 13px; }
  .sub { fill: var(--vscode-descriptionForeground); font-size: 11px; }
  .badge { fill: var(--vscode-editorWarning-foreground); font-size: 12px; }
  .edge { fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 1.5; }
  #arrow path { fill: var(--vscode-descriptionForeground); }
</style></head>
<body>
<header><strong>Agent architecture</strong><span>${esc(summary)}</span><button id="copy">Copy as Mermaid</button></header>
${nodes.length ? '' : '<p>No agents found. Clone an agent into this workspace and refresh.</p>'}
<svg width="${width}" height="${height}" role="img" aria-label="Agent architecture graph">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
  ${edgeSvg}${nodeSvg}
</svg>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copyMermaid' }));
  for (const g of document.querySelectorAll('.node')) {
    const open = () => g.dataset.file && vscode.postMessage({ type: 'open', file: g.dataset.file });
    g.addEventListener('click', open);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(); });
  }
</script>
</body></html>`;
  }
}
