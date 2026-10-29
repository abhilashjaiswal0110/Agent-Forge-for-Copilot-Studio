import * as vscode from 'vscode';
import { lint, loadWorkspace, RULES, type AgentModel, type Finding, type WorkspaceModel } from './core';
import { Lifecycle } from './lifecycle/lifecycle';
import type { LifecycleStep } from './lifecycle/pacArgs';
import { configureBrowser, installSkills } from './setup/setupCommands';
import { Telemetry } from './telemetry';
import { AgentTreeProvider, type Node } from './views/agentTree';
import { GraphPanel } from './views/graphPanel';

const SEVERITY: Record<Finding['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information
};

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Agent Forge');
  const telemetry = new Telemetry(String(context.extension.packageJSON.version));
  const diagnostics = vscode.languages.createDiagnosticCollection('agentForge');
  const tree = new AgentTreeProvider();
  const lifecycle = new Lifecycle(context, output, telemetry);
  let model: WorkspaceModel = { agents: [], parseErrors: [] };
  let findings: Finding[] = [];

  context.subscriptions.push(output, telemetry, diagnostics, vscode.window.registerTreeDataProvider('agentForge.agents', tree));

  const refresh = () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const started = Date.now();
    model = loadWorkspace(folders);
    findings = lint(model, { disabledRules: vscode.workspace.getConfiguration('agentForge').get<string[]>('lint.disabledRules', []) });

    diagnostics.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of findings) {
      const d = new vscode.Diagnostic(new vscode.Range(f.line, 0, f.line, Number.MAX_SAFE_INTEGER), f.message, SEVERITY[f.severity]);
      d.source = 'Agent Forge';
      d.code = f.ruleId;
      byFile.set(f.file, [...(byFile.get(f.file) ?? []), d]);
    }
    for (const [file, list] of byFile) diagnostics.set(vscode.Uri.file(file), list);

    tree.update(model, findings);
    GraphPanel.refresh(model, findings);
    void vscode.commands.executeCommand('setContext', 'agentForge.hasAgents', model.agents.length > 0);
    output.appendLine(`Scanned ${model.agents.length} agent(s), ${findings.length} finding(s) in ${Date.now() - started} ms.`);
    return Date.now() - started;
  };

  let timer: NodeJS.Timeout | undefined;
  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 400);
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{yml,yaml,md,json}');
  watcher.onDidChange(scheduleRefresh);
  watcher.onDidCreate(scheduleRefresh);
  watcher.onDidDelete(scheduleRefresh);
  context.subscriptions.push(
    watcher,
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('agentForge') && scheduleRefresh()),
    { dispose: () => timer && clearTimeout(timer) }
  );

  const pickAgent = async (arg?: Node | vscode.Uri): Promise<AgentModel | undefined> => {
    if (arg && 'type' in arg && arg.type === 'agent') return arg.agent;
    const fromUri = tree.agentFor(arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri);
    if (fromUri) return fromUri;
    if (tree.agents.length === 1) return tree.agents[0];
    const pick = await vscode.window.showQuickPick(
      tree.agents.map((a) => ({ label: a.name, description: a.harness, agent: a })),
      { title: 'Select an agent' }
    );
    return pick?.agent;
  };

  const lifecycleCommand = (step: LifecycleStep) => async (arg?: Node | vscode.Uri) => {
    const agent = await pickAgent(arg);
    if (agent) await lifecycle.run(step, agent);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('agentForge.refresh', () => {
      refresh();
      telemetry.event('command.refresh');
    }),
    vscode.commands.registerCommand('agentForge.lint', async () => {
      const ms = refresh();
      const byRule: Record<string, number> = {};
      for (const f of findings) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
      telemetry.event('command.lint', undefined, { agents: model.agents.length, findings: findings.length, durationMs: ms, ...byRule });
      await vscode.commands.executeCommand('workbench.actions.view.problems');
    }),
    vscode.commands.registerCommand('agentForge.showGraph', () => {
      refresh();
      GraphPanel.show(model, findings);
      telemetry.event('command.showGraph', undefined, { agents: model.agents.length });
    }),
    vscode.commands.registerCommand('agentForge.pull', lifecycleCommand('pull')),
    vscode.commands.registerCommand('agentForge.push', lifecycleCommand('push')),
    vscode.commands.registerCommand('agentForge.publish', lifecycleCommand('publish')),
    vscode.commands.registerCommand('agentForge.configureBrowser', () => configureBrowser(telemetry)),
    vscode.commands.registerCommand('agentForge.installSkills', () => installSkills(context, telemetry))
  );

  refresh();
  telemetry.event('activate', { harnesses: [...new Set(model.agents.map((a) => a.harness))].sort().join(',') }, { agents: model.agents.length, rules: RULES.length });
}

export function deactivate() {}
