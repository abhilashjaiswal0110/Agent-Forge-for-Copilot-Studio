import * as vscode from 'vscode';
import {
  ENVIRONMENT_KINDS,
  guardDecision,
  hostOf,
  matchEnvironment,
  targetFromInput,
  usableProfiles,
  validateProfiles,
  type AgentModel,
  type EnvironmentKind,
  type EnvironmentMatch,
  type EnvironmentProfile,
  type GuardMode
} from '../core';
import type { Telemetry } from '../telemetry';

const config = () => vscode.workspace.getConfiguration('agentForge');

export function environmentProfiles(): EnvironmentProfile[] {
  return usableProfiles(config().get<unknown>('environments', []));
}

export function matchFor(agent: AgentModel): EnvironmentMatch {
  return matchEnvironment(agent.sync, environmentProfiles());
}

/**
 * Applies agentForge.productionGuard and requireProfile before a step that changes an
 * environment. Returns true when the step may continue.
 */
export async function passGuard(match: EnvironmentMatch, action: string, telemetry: Telemetry): Promise<boolean> {
  const decision = guardDecision(match, config().get<GuardMode>('productionGuard', 'confirm'), config().get<boolean>('requireEnvironmentProfile', false));
  telemetry.event('environment.guard', { kind: match.kind, decision: decision.action });
  if (decision.action === 'allow') return true;
  if (decision.action === 'block') {
    const open = 'Open Settings';
    const add = 'Add Environment Profile';
    const choice = await vscode.window.showErrorMessage(`Agent Forge: ${action} stopped. ${decision.reason}`, open, ...(match.kind === 'unknown' && !match.unsynced ? [add] : []));
    if (choice === open) await vscode.commands.executeCommand('workbench.action.openSettings', 'agentForge.environments');
    if (choice === add) await vscode.commands.executeCommand('agentForge.addEnvironmentProfile');
    return false;
  }
  const typed = await vscode.window.showInputBox({
    title: `PRODUCTION: ${action}`,
    prompt: `This targets the production environment "${decision.phrase}". Type the environment name to continue.`,
    ignoreFocusOut: true,
    validateInput: (v) => (v === decision.phrase ? undefined : `Type "${decision.phrase}" exactly`)
  });
  return typed === decision.phrase;
}

/** Adds or updates a profile in workspace settings, from an agent's sync metadata or a typed URL. */
export async function addEnvironmentProfile(agent: AgentModel | undefined, telemetry: Telemetry): Promise<void> {
  const title = 'Agent Forge: Add Environment Profile';
  let url = agent?.sync.dataverseEndpoint;
  let id = agent?.sync.environmentId;
  if (!url && !id) {
    const typed = await vscode.window.showInputBox({
      title,
      prompt: 'Dataverse environment URL or environment id',
      placeHolder: 'https://contoso-dev.crm.dynamics.com/',
      ignoreFocusOut: true,
      validateInput: (v) => (/^https:\/\/\S+$/i.test(v.trim()) || /^[0-9a-f-]{36}$/i.test(v.trim()) ? undefined : 'Enter an https URL or an environment id.')
    });
    if (!typed) return;
    ({ dataverseEndpoint: url, environmentId: id } = targetFromInput(typed));
  }
  const current: EnvironmentProfile[] = config().get<EnvironmentProfile[]>('environments', []) ?? [];
  const existing = current.find((p) => (id && p.id?.toLowerCase() === id.toLowerCase()) || (url && hostOf(p.url) === hostOf(url)));
  const kindPick = await vscode.window.showQuickPick(
    ENVIRONMENT_KINDS.map((k) => ({ label: k, description: k === 'prod' ? 'Push and publish need typed confirmation (or are blocked)' : undefined })),
    { title, placeHolder: `Stage of ${hostOf(url) ?? id}`, ignoreFocusOut: true }
  );
  if (!kindPick) return;
  const name = await vscode.window.showInputBox({
    title,
    prompt: 'Profile name (shown in the Agent Forge view and typed to confirm production steps)',
    value: existing?.name ?? `${kindPick.label[0].toUpperCase()}${kindPick.label.slice(1)}`,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() && !current.some((p) => p !== existing && p.name.toLowerCase() === v.trim().toLowerCase()) ? undefined : 'Enter a unique name.')
  });
  if (!name) return;
  const profile: EnvironmentProfile = { name: name.trim(), kind: kindPick.label as EnvironmentKind, ...(url ? { url } : {}), ...(id ? { id } : {}) };
  const next = existing ? current.map((p) => (p === existing ? profile : p)) : [...current, profile];
  const errors = validateProfiles(next);
  if (errors.length) return void vscode.window.showErrorMessage(`Profile not saved: ${errors.join(' ')}`);
  const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await config().update('environments', next, target);
  telemetry.event('command.addEnvironmentProfile', { kind: profile.kind, updated: String(!!existing) });
  void vscode.window.showInformationMessage(`Environment profile "${profile.name}" (${profile.kind}) saved to ${target === vscode.ConfigurationTarget.Workspace ? 'workspace' : 'user'} settings.`);
}

/** Reports invalid entries in agentForge.environments once per change. */
export function warnInvalidProfiles(): void {
  const errors = validateProfiles(config().get<unknown>('environments', []));
  if (errors.length) {
    void vscode.window.showWarningMessage(`Agent Forge: some environment profiles are ignored. ${errors.slice(0, 3).join(' ')}`, 'Open Settings').then((c) => {
      if (c) void vscode.commands.executeCommand('workbench.action.openSettings', 'agentForge.environments');
    });
  }
}
