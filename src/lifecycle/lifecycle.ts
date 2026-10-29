import { execFile } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { lint, loadWorkspace, type AgentModel } from '../core';
import type { Telemetry } from '../telemetry';
import { pacArgs, pacSupports, pacVersion, type LifecycleStep } from './pacArgs';

const MAX_SNAPSHOTS = 10;

export class Lifecycle {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly telemetry: Telemetry
  ) {}

  private storageDir(): string {
    const dir = (this.context.storageUri ?? this.context.globalStorageUri).fsPath;
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Copies the agent folder before any operation that changes local or remote state. */
  snapshot(agent: AgentModel, step: LifecycleStep): string {
    const base = path.join(this.storageDir(), 'snapshots');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(base, `${path.basename(agent.root)}-${step}-${stamp}`);
    cpSync(agent.root, dest, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git`) });
    const all = readdirSync(base).sort();
    for (const old of all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS))) rmSync(path.join(base, old), { recursive: true, force: true });
    return dest;
  }

  private evidence(entry: Record<string, unknown>) {
    appendFileSync(path.join(this.storageDir(), 'release-evidence.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  }

  private runPac(agent: AgentModel, step: LifecycleStep, args: string[]): Promise<number | undefined> {
    return this.runPacTask(`pac copilot ${step} (${agent.name})`, args, agent.root);
  }

  /** Runs pac as a VS Code task in a dedicated terminal and resolves with its exit code. */
  async runPacTask(label: string, args: string[], cwd: string): Promise<number | undefined> {
    const pac = vscode.workspace.getConfiguration('agentForge').get<string>('pacPath', 'pac');
    const task = new vscode.Task(
      { type: 'agentForge', step: label },
      vscode.TaskScope.Workspace,
      label,
      'Agent Forge',
      new vscode.ProcessExecution(pac, args, { cwd })
    );
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
    const execution = await vscode.tasks.executeTask(task);
    return new Promise((resolve) => {
      const sub = vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution === execution) {
          sub.dispose();
          resolve(e.exitCode);
        }
      });
    });
  }

  private readonly helpCache = new Map<string, string | undefined>();

  private copilotHelp(pac: string): Promise<string | undefined> {
    if (this.helpCache.has(pac)) return Promise.resolve(this.helpCache.get(pac));
    return new Promise((resolve) => {
      // pac is a .cmd shim on Windows, which execFile can only start through a shell.
      const windows = process.platform === 'win32';
      const file = windows && /\s/.test(pac) && !pac.startsWith('"') ? `"${pac}"` : pac;
      execFile(file, ['copilot', 'help'], { timeout: 60_000, windowsHide: true, shell: windows }, (_err, stdout, stderr) => {
        const text = `${stdout ?? ''}\n${stderr ?? ''}`;
        const result = /copilot/i.test(text) ? text : undefined;
        if (result) this.helpCache.set(pac, result);
        resolve(result);
      });
    });
  }

  /** Fails fast with guidance when pac is missing or too old for the step, instead of a failed terminal task. */
  async preflight(step: LifecycleStep | 'init'): Promise<boolean> {
    const pac = vscode.workspace.getConfiguration('agentForge').get<string>('pacPath', 'pac');
    const help = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Agent Forge: checking Power Platform CLI' },
      () => this.copilotHelp(pac)
    );
    if (!help) {
      const settings = 'Open Settings';
      const choice = await vscode.window.showErrorMessage(
        `Agent Forge: the Power Platform CLI ("${pac}") was not found. Install it and run "pac auth create", or set agentForge.pacPath.`,
        settings
      );
      if (choice === settings) await vscode.commands.executeCommand('workbench.action.openSettings', 'agentForge.pacPath');
      this.telemetry.event('lifecycle.preflight', { step, result: 'pacMissing' });
      return false;
    }
    if (!pacSupports(step, help)) {
      // Do not keep a stale answer: the user is about to update pac and retry.
      this.helpCache.delete(pac);
      const copy = 'Copy update command';
      const choice = await vscode.window.showErrorMessage(
        `Agent Forge: your Power Platform CLI (${pacVersion(help) ?? 'unknown version'}) has no "pac copilot ${step}". Update it with "pac install latest" (or your package manager), then try again.`,
        copy
      );
      if (choice === copy) await vscode.env.clipboard.writeText('pac install latest');
      this.telemetry.event('lifecycle.preflight', { step, result: 'pacTooOld' });
      return false;
    }
    return true;
  }

  async run(step: LifecycleStep, agent: AgentModel): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage('Agent Forge: lifecycle commands require a trusted workspace.');
      return;
    }
    if (!(await this.preflight(step))) return;
    const env = agent.sync.environmentDisplayName ?? agent.sync.environmentId ?? 'the environment linked to this workspace';

    if (step === 'push' || step === 'publish') {
      const findings = lint(loadWorkspace([path.dirname(agent.root)]), {
        disabledRules: vscode.workspace.getConfiguration('agentForge').get<string[]>('lint.disabledRules', [])
      }).filter((f) => f.agent === agent.name || f.file.startsWith(agent.root + path.sep));
      const errors = findings.filter((f) => f.severity === 'error');
      if (errors.length) {
        const choice = await vscode.window.showWarningMessage(
          `"${agent.name}" has ${errors.length} lint error(s). Fix them before ${step}?`,
          { modal: true },
          'Show Problems',
          `${step[0].toUpperCase()}${step.slice(1)} anyway`
        );
        if (choice === 'Show Problems') await vscode.commands.executeCommand('workbench.actions.view.problems');
        if (choice !== `${step[0].toUpperCase()}${step.slice(1)} anyway`) return;
      }
    }

    if (step === 'pull') {
      const ok = await vscode.window.showInformationMessage(
        `Pull merges the server state of "${agent.name}" into local files. A snapshot is taken first.`,
        { modal: true },
        'Pull'
      );
      if (ok !== 'Pull') return;
    } else if (step === 'push') {
      const ok = await vscode.window.showWarningMessage(
        `Push uploads local changes of "${agent.name}" to ${env} as a draft (not published). A snapshot is taken first.`,
        { modal: true },
        'Push'
      );
      if (ok !== 'Push') return;
    } else {
      const typed = await vscode.window.showInputBox({
        title: `Publish "${agent.name}" to ${env}`,
        prompt: 'Publishing makes the current draft live for every channel. Type the agent name to confirm.',
        validateInput: (v) => (v === agent.name ? undefined : `Type "${agent.name}" exactly`)
      });
      if (typed !== agent.name) return;
    }

    let args: string[];
    try {
      args = pacArgs(step, { root: agent.root, agentId: agent.sync.agentId, schemaName: agent.schemaName, environmentId: agent.sync.environmentId });
    } catch (e) {
      void vscode.window.showErrorMessage(`Agent Forge: ${(e as Error).message}`);
      return;
    }

    const snapshot = step === 'publish' ? undefined : this.snapshot(agent, step);
    if (snapshot) this.output.appendLine(`[${step}] snapshot: ${snapshot}`);
    this.output.appendLine(`[${step}] pac ${args.join(' ')}`);
    const started = Date.now();
    const exitCode = await this.runPac(agent, step, args);
    this.evidence({ step, agent: agent.name, harness: agent.harness, exitCode, durationMs: Date.now() - started, snapshot });
    this.telemetry.event(`lifecycle.${step}`, { harness: agent.harness, success: String(exitCode === 0) }, { durationMs: Date.now() - started });

    if (exitCode === 0) {
      const next = step === 'pull' ? 'Edit, lint, then push.' : step === 'push' ? 'Draft created. Publish when ready, then test in Preview.' : 'Published. Pull again to confirm no pending changes, then run your tests.';
      void vscode.window.showInformationMessage(`Agent Forge: ${step} succeeded for "${agent.name}". ${next}`);
    } else {
      void vscode.window.showErrorMessage(
        `Agent Forge: pac copilot ${step} failed (exit ${exitCode ?? 'unknown'}). ${step === 'push' ? 'If the server changed, pull first.' : 'Check the terminal and run "pac auth list".'}`
      );
    }
  }
}
