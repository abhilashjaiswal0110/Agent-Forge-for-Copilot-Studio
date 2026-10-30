import * as vscode from 'vscode';
import { fixesFor, lint, loadWorkspace, RULES, type AgentModel, type Finding, type WorkspaceModel } from './core';
import { Lifecycle } from './lifecycle/lifecycle';
import { addEnvironmentProfile, matchFor, warnInvalidProfiles } from './lifecycle/environments';
import type { LifecycleStep } from './lifecycle/pacArgs';
import { configureBrowser, configureLintServer, installGitHook, installSkills, runBrowserRecipe } from './setup/setupCommands';
import { newBlueprint } from './build/blueprintWizard';
import { EvalCommands } from './evals/evalCommands';
import { Telemetry } from './telemetry';
import { AgentTreeProvider, type Node } from './views/agentTree';
import { GraphPanel } from './views/graphPanel';
import { AgentForgeCodeActions, toWorkspaceEdit } from './views/quickFixes';

const SEVERITY: Record<Finding['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information
};

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Agent Forge');
  const telemetry = new Telemetry(String(context.extension.packageJSON.version));
  const diagnostics = vscode.languages.createDiagnosticCollection('agentForge');
  const tree = new AgentTreeProvider(matchFor);
  const lifecycle = new Lifecycle(context, output, telemetry);
  const evalDiagnostics = vscode.languages.createDiagnosticCollection('agentForge.evals');
  const evals = new EvalCommands(evalDiagnostics, telemetry);
  context.subscriptions.push(evalDiagnostics);
  let model: WorkspaceModel = { agents: [], parseErrors: [] };
  let findings: Finding[] = [];

  context.subscriptions.push(output, telemetry, diagnostics, vscode.window.registerTreeDataProvider('agentForge.agents', tree));
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: 'file', pattern: '**/*.{yml,yaml}' }, { scheme: 'file', pattern: '**/SKILL.md' }],
      new AgentForgeCodeActions(() => ({ model, findings })),
      { providedCodeActionKinds: AgentForgeCodeActions.kinds }
    )
  );

  const refresh = () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const started = Date.now();
    model = loadWorkspace(folders);
    findings = lint(model, { disabledRules: vscode.workspace.getConfiguration('agentForge').get<string[]>('lint.disabledRules', []) });

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of findings) {
      const d = new vscode.Diagnostic(new vscode.Range(f.line, 0, f.line, Number.MAX_SAFE_INTEGER), f.message, SEVERITY[f.severity]);
      d.source = 'Agent Forge';
      d.code = f.ruleId;
      const key = vscode.Uri.file(f.file).toString();
      byFile.set(key, [...(byFile.get(key) ?? []), d]);
    }
    // Update in place instead of clear() + set(): clearing empties the Problems panel and code-action
    // context for a moment on every refresh.
    const stale: vscode.Uri[] = [];
    diagnostics.forEach((uri) => {
      if (!byFile.has(uri.toString())) stale.push(uri);
    });
    for (const uri of stale) diagnostics.delete(uri);
    for (const [uri, list] of byFile) diagnostics.set(vscode.Uri.parse(uri), list);

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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('agentForge')) return;
      if (e.affectsConfiguration('agentForge.environments')) warnInvalidProfiles();
      scheduleRefresh();
    }),
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
    vscode.commands.registerCommand('agentForge.installSkills', () => installSkills(context, telemetry)),
    vscode.commands.registerCommand('agentForge.configureLintServer', () => configureLintServer(context, telemetry)),
    vscode.commands.registerCommand('agentForge.fixAll', async () => {
      refresh();
      const fixes = findings.flatMap((f) => fixesFor(f, model)).filter((f) => f.safe);
      if (!fixes.length) return void vscode.window.showInformationMessage('Agent Forge: no safe quick fixes available.');
      const files = new Set(fixes.flatMap((f) => [...f.edits.map((e) => e.file), ...f.creates.map((c) => c.file)]));
      const touched = [...files].map((f) => vscode.Uri.file(f).toString());
      // Fix positions come from disk, so unsaved buffers would be edited at the wrong place.
      if (vscode.workspace.textDocuments.some((d) => d.isDirty && touched.includes(d.uri.toString()))) {
        return void vscode.window.showWarningMessage('Agent Forge: save the affected agent files before applying quick fixes.');
      }
      const apply = 'Apply';
      const answer = await vscode.window.showWarningMessage(
        `Apply ${fixes.length} safe quick fix(es) to ${files.size} file(s)? You can undo them in each editor.`,
        { modal: true },
        apply
      );
      if (answer !== apply) return;
      const ok = await vscode.workspace.applyEdit(toWorkspaceEdit(fixes));
      if (ok) {
        for (const doc of vscode.workspace.textDocuments) if (doc.isDirty && touched.includes(doc.uri.toString())) await doc.save();
      }
      const byRule: Record<string, number> = {};
      for (const f of fixes) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
      telemetry.event('command.fixAll', { success: String(ok) }, { fixes: fixes.length, files: files.size, ...byRule });
      refresh();
    }),
    vscode.commands.registerCommand('agentForge.disableRule', async (ruleId?: string) => {
      const id = ruleId ?? (await vscode.window.showQuickPick(RULES.map((r) => ({ label: r.id, description: r.title })), { title: 'Disable a lint rule' }))?.label;
      if (!id || !RULES.some((r) => r.id === id)) return;
      const config = vscode.workspace.getConfiguration('agentForge');
      const current = config.get<string[]>('lint.disabledRules', []);
      if (!current.includes(id)) {
        const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await config.update('lint.disabledRules', [...current, id], target);
      }
      telemetry.event('command.disableRule', { rule: id });
    }),
    vscode.commands.registerCommand('agentForge.openWalkthrough', () => {
      telemetry.event('command.openWalkthrough');
      return vscode.commands.executeCommand('workbench.action.openWalkthrough', `${context.extension.id}#agentForge.gettingStarted`, false);
    }),
    vscode.commands.registerCommand('agentForge.newBlueprint', () => newBlueprint(lifecycle, telemetry)),
    vscode.commands.registerCommand('agentForge.addEnvironmentProfile', async (arg?: Node | vscode.Uri) => {
      const agent = arg ? await pickAgent(arg) : undefined;
      await addEnvironmentProfile(agent, telemetry);
    }),
    vscode.commands.registerCommand('agentForge.openSample', async () => {
      const target = await vscode.window.showOpenDialog({ title: 'Folder to copy the Contoso sample into', canSelectFolders: true, canSelectFiles: false, openLabel: 'Copy sample here' });
      if (!target?.[0]) return;
      const dest = vscode.Uri.joinPath(target[0], 'contoso-it-helpdesk');
      try {
        await vscode.workspace.fs.stat(dest);
        return void vscode.window.showWarningMessage(`${dest.fsPath} already exists.`);
      } catch {
        // Expected: the destination does not exist yet.
      }
      await vscode.workspace.fs.copy(vscode.Uri.joinPath(context.extensionUri, 'samples', 'contoso-it-helpdesk'), dest);
      telemetry.event('command.openSample');
      await vscode.commands.executeCommand('vscode.openFolder', dest, { forceNewWindow: !!vscode.workspace.workspaceFolders?.length });
    }),
    vscode.commands.registerCommand('agentForge.newTestSet', async (arg?: Node | vscode.Uri) => {
      refresh();
      return evals.newTestSet(await pickAgent(arg), model.agents);
    }),
    vscode.commands.registerCommand('agentForge.validateTestSet', (uri?: vscode.Uri) => evals.validate(uri)),
    vscode.commands.registerCommand('agentForge.analyzeResults', (uri?: vscode.Uri) => evals.analyze(uri)),
    vscode.commands.registerCommand('agentForge.runBrowserRecipe', () => runBrowserRecipe(context, telemetry)),
    vscode.commands.registerCommand('agentForge.installGitHook', () => installGitHook(context, telemetry))
  );

  refresh();
  telemetry.event('activate', { harnesses: [...new Set(model.agents.map((a) => a.harness))].sort().join(',') }, { agents: model.agents.length, rules: RULES.length });
}

export function deactivate() {}
