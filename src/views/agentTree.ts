import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AgentModel, Component, ComponentCategory, EnvironmentMatch, Finding, WorkspaceModel } from '../core';

const CATEGORY_LABEL: Record<ComponentCategory, string> = {
  skill: 'Skills',
  tool: 'Tools',
  knowledge: 'Knowledge',
  topic: 'Topics',
  action: 'Actions',
  childAgent: 'Child agents',
  variable: 'Variables',
  workflow: 'Workflows',
  connection: 'Connections',
  other: 'Other'
};

const CATEGORY_ICON: Record<ComponentCategory, string> = {
  skill: 'lightbulb',
  tool: 'tools',
  knowledge: 'book',
  topic: 'comment-discussion',
  action: 'zap',
  childAgent: 'hubot',
  variable: 'symbol-variable',
  workflow: 'git-merge',
  connection: 'plug',
  other: 'file'
};

export type Node =
  | { type: 'agent'; agent: AgentModel }
  | { type: 'category'; agent: AgentModel; category: ComponentCategory; items: Component[] }
  | { type: 'component'; agent: AgentModel; component: Component };

const HARNESS_LABEL = { githubCopilot: 'GitHub Copilot harness', standard: 'Standard harness', mixed: 'Mixed harness (error)', unknown: 'Unknown harness' };

export class AgentTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private model: WorkspaceModel = { agents: [], parseErrors: [] };
  private findings: Finding[] = [];

  constructor(private readonly environmentOf: (a: AgentModel) => EnvironmentMatch) {}

  update(model: WorkspaceModel, findings: Finding[]) {
    this.model = model;
    this.findings = findings;
    this.emitter.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'agent') {
      const a = node.agent;
      const errors = this.findings.filter((f) => f.agent === a.name && f.severity === 'error').length;
      const warnings = this.findings.filter((f) => f.agent === a.name && f.severity === 'warning').length;
      const item = new vscode.TreeItem(a.name, vscode.TreeItemCollapsibleState.Collapsed);
      const env = this.environmentOf(a);
      const stage = env.kind === 'unknown' ? '' : `${env.kind.toUpperCase()} · `;
      item.description = `${stage}${HARNESS_LABEL[a.harness]}${errors || warnings ? ` · ${errors}E ${warnings}W` : ''}`;
      item.tooltip = new vscode.MarkdownString(
        `**${a.name}**\n\n- Harness: ${HARNESS_LABEL[a.harness]} (${a.harnessEvidence.join(', ') || 'no markers'})\n- Schema: \`${a.schemaName ?? 'n/a'}\`\n- Environment: ${env.label}`
      );
      item.iconPath = new vscode.ThemeIcon(
        a.components.some((c) => c.kind === 'ConnectedAgentTool') ? 'organization' : 'hubot',
        env.kind === 'prod' ? new vscode.ThemeColor('charts.red') : undefined
      );
      item.contextValue = 'agent';
      item.resourceUri = vscode.Uri.file(a.root);
      return item;
    }
    if (node.type === 'category') {
      const item = new vscode.TreeItem(CATEGORY_LABEL[node.category], vscode.TreeItemCollapsibleState.Collapsed);
      item.description = String(node.items.length);
      item.iconPath = new vscode.ThemeIcon(CATEGORY_ICON[node.category]);
      return item;
    }
    const c = node.component;
    const item = new vscode.TreeItem(c.name, vscode.TreeItemCollapsibleState.None);
    item.description = c.kind;
    item.tooltip = c.description ?? 'No description';
    item.iconPath = new vscode.ThemeIcon(c.kind === 'ConnectedAgentTool' ? 'hubot' : CATEGORY_ICON[c.category]);
    item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(c.skillMdFile ?? c.file)] };
    item.contextValue = 'component';
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.model.agents.map((agent) => ({ type: 'agent', agent }));
    if (node.type === 'agent') {
      const groups = new Map<ComponentCategory, Component[]>();
      for (const c of node.agent.components) groups.set(c.category, [...(groups.get(c.category) ?? []), c]);
      return [...groups.entries()].map(([category, items]) => ({ type: 'category', agent: node.agent, category, items }));
    }
    if (node.type === 'category') {
      return [...node.items]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((component) => ({ type: 'component', agent: node.agent, component }));
    }
    return [];
  }

  agentFor(uri?: vscode.Uri): AgentModel | undefined {
    if (!uri) return undefined;
    return this.model.agents.find((a) => uri.fsPath === a.root || uri.fsPath.startsWith(a.root + path.sep));
  }

  get agents() {
    return this.model.agents;
  }
}
