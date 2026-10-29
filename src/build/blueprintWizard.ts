import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { applyAgentPlan, blueprintReadme, planBlueprint, schemaFor, validateSpec, type BlueprintAgent, type BlueprintSpec } from '../core';
import type { Lifecycle } from '../lifecycle/lifecycle';
import { pacInitArgs } from '../lifecycle/pacArgs';
import type { Telemetry } from '../telemetry';

const title = 'Agent Forge: New Orchestrator Blueprint';

async function ask(prompt: string, value = '', validate?: (v: string) => string | undefined, placeHolder?: string): Promise<string | undefined> {
  const v = await vscode.window.showInputBox({ title, prompt, value, placeHolder, ignoreFocusOut: true, validateInput: validate });
  return v?.trim();
}

const purposeCheck = (v: string) => (v.trim().length < 15 ? 'Describe what it does in at least 15 characters.' : undefined);

async function askAgent(kind: string, defaults: BlueprintAgent): Promise<BlueprintAgent | undefined> {
  const name = await ask(`${kind} name`, defaults.name, (v) => (!/[A-Za-z0-9]/.test(v) ? 'Use at least one letter or digit.' : v.length > 60 ? 'Keep it under 60 characters.' : undefined));
  if (!name) return undefined;
  const purpose = await ask(`What does "${name}" do? This becomes its instructions and routing description.`, defaults.purpose, purposeCheck);
  return purpose ? { name, purpose } : undefined;
}

/** Collects a blueprint spec through input boxes. Returns undefined when the user cancels. */
async function collectSpec(): Promise<BlueprintSpec | undefined> {
  const prefix = await ask('Publisher prefix used for schema names', 'contoso', (v) => (/^[a-z][a-z0-9]{1,7}$/.test(v) ? undefined : '2-8 lowercase letters or digits, starting with a letter.'));
  if (!prefix) return undefined;
  const orchestrator = await askAgent('Orchestrator', { name: 'Contoso IT Assistant', purpose: 'Single entry point for Contoso IT questions, incidents and requests' });
  if (!orchestrator) return undefined;

  const suggestions: BlueprintAgent[] = [
    { name: 'Incidents Agent', purpose: 'Investigates incidents and outages and suggests troubleshooting steps' },
    { name: 'Knowledge Agent', purpose: 'Answers how-to questions from the IT knowledge base with citations' },
    { name: 'Access Agent', purpose: 'Explains access and permission requests and checks their status' }
  ];
  const spokes: BlueprintAgent[] = [];
  for (;;) {
    const s = suggestions[spokes.length] ?? { name: '', purpose: '' };
    const name = await ask(`Read-only domain agent ${spokes.length + 1} name (leave empty to finish)`, s.name);
    if (name === undefined) return undefined;
    if (!name) break;
    const taken = [orchestrator, ...spokes].some((x) => schemaFor(prefix, x.name) === schemaFor(prefix, name));
    if (taken) {
      void vscode.window.showWarningMessage(`"${name}" duplicates an existing agent name.`);
      continue;
    }
    const purpose = await ask(`What does "${name}" do?`, s.name === name ? s.purpose : '', purposeCheck);
    if (purpose === undefined) return undefined;
    spokes.push({ name, purpose });
  }
  if (!spokes.length) {
    void vscode.window.showWarningMessage('A blueprint needs at least one domain agent.');
    return undefined;
  }

  const withWriter = await vscode.window.showQuickPick(
    [
      { label: 'Yes, add one write agent', description: 'Executes previewed, confirmed changes', value: true },
      { label: 'No, everything is read-only', value: false }
    ],
    { title, placeHolder: 'Does the solution change data (create, update, send)?', ignoreFocusOut: true }
  );
  if (!withWriter) return undefined;
  let writer: BlueprintSpec['writer'];
  if (withWriter.value) {
    const w = await askAgent('Write agent', { name: 'Actions Agent', purpose: 'Creates and updates service desk tickets after explicit confirmation' });
    if (!w) return undefined;
    const ops = await ask('Operations the write agent may perform (comma-separated)', 'create_ticket, update_ticket', (v) => (v.split(',').some((x) => x.trim()) ? undefined : 'List at least one operation.'));
    if (!ops) return undefined;
    writer = { ...w, operations: ops.split(',').map((x) => x.trim()).filter(Boolean) };
  }
  return { prefix, orchestrator, spokes, writer };
}

export async function newBlueprint(lifecycle: Lifecycle, telemetry: Telemetry): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = folders.length > 1 ? await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Folder for the new agents' }) : folders[0];
  if (!folder) return void vscode.window.showWarningMessage('Open a folder first; the blueprint is written into it.');

  const spec = await collectSpec();
  if (!spec) return;
  const errors = validateSpec(spec);
  if (errors.length) return void vscode.window.showErrorMessage(`Blueprint not created: ${errors.join(' ')}`);

  const plans = planBlueprint(spec);
  const root = folder.uri.fsPath;
  const clash = plans.find((p) => existsSync(path.join(root, p.folder)));
  if (clash) return void vscode.window.showErrorMessage(`Folder "${clash.folder}" already exists. Rename the agent or move the folder first.`);

  const mode = vscode.workspace.isTrusted
    ? await vscode.window.showQuickPick(
        [
          { label: 'Create files only', description: 'Review and lint first; create the agents later', live: false },
          { label: 'Create files and the agents in an environment', description: 'Runs pac copilot init --environment for each agent', live: true }
        ],
        { title, placeHolder: `Create ${plans.length} agents`, ignoreFocusOut: true }
      )
    : { live: false };
  if (!mode) return;

  const started = Date.now();
  if (!mode.live) {
    for (const p of plans) applyAgentPlan(path.join(root, p.folder), p);
  } else {
    const environment = await ask(
      'Environment URL or id (use dev or test, not production)',
      '',
      (v) => (/^https:\/\/\S+$|^[0-9a-f-]{36}$/i.test(v) ? undefined : 'Enter an https URL or an environment id.'),
      'https://contoso-dev.crm.dynamics.com/'
    );
    if (!environment) return;
    const ok = await vscode.window.showWarningMessage(
      `Create ${plans.length} new agents (${plans.map((p) => p.schemaName).join(', ')}) in ${environment}? Each runs "pac copilot init --environment", which imports a solution. Existing agents are not changed.`,
      { modal: true },
      'Create agents'
    );
    if (ok !== 'Create agents' || !(await lifecycle.preflight('init'))) return;
    for (const p of plans) {
      const dir = path.join(root, p.folder);
      const code = await lifecycle.runPacTask(`pac copilot init (${p.name})`, pacInitArgs({ name: p.name, prefix: spec.prefix, schemaName: p.schemaName, projectDir: dir, environment }), root);
      if (code !== 0) {
        telemetry.event('command.newBlueprint', { mode: 'environment', success: 'false' }, { agents: plans.length });
        return void vscode.window.showErrorMessage(`pac copilot init failed for "${p.name}" (exit ${code ?? 'unknown'}). Agents created so far stay in place; check the terminal.`);
      }
      applyAgentPlan(dir, p);
    }
  }

  const readme = vscode.Uri.file(path.join(root, 'BLUEPRINT.md'));
  await vscode.workspace.fs.writeFile(readme, new TextEncoder().encode(blueprintReadme(spec, plans)));
  telemetry.event('command.newBlueprint', { mode: mode.live ? 'environment' : 'files', success: 'true' }, { spokes: spec.spokes.length, writer: spec.writer ? 1 : 0, durationMs: Date.now() - started });
  await vscode.commands.executeCommand('agentForge.refresh');
  await vscode.commands.executeCommand('markdown.showPreview', readme);
  void vscode.window.showInformationMessage(
    mode.live
      ? `Created ${plans.length} agents. Push the domain agents first, then the orchestrator (right-click → Push Agent as Draft).`
      : `Blueprint written: ${plans.length} agent folders. Review BLUEPRINT.md and lint; run the wizard again in environment mode to create the agents.`
  );
}
