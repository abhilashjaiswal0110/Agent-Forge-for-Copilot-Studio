import * as vscode from 'vscode';
import type { Telemetry } from '../telemetry';
import { mergeMcpConfig, parseMcpJson, PLAYWRIGHT_SERVER_ID, type BrowserProfile, type McpConfig } from './mcpConfig';

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Workspace folder to configure' });
}

async function exists(uri: vscode.Uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Writes the Playwright MCP browser co-pilot into .vscode/mcp.json, honouring agentForge.browser.profile. */
export async function configureBrowser(telemetry: Telemetry) {
  const folder = await pickFolder();
  if (!folder) return void vscode.window.showWarningMessage('Open a folder first.');
  const profile = vscode.workspace.getConfiguration('agentForge', folder).get<BrowserProfile>('browser.profile', 'isolated');
  const file = vscode.Uri.joinPath(folder.uri, '.vscode', 'mcp.json');

  let current: McpConfig | undefined;
  if (await exists(file)) {
    try {
      current = parseMcpJson(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
    } catch {
      return void vscode.window.showErrorMessage('.vscode/mcp.json could not be parsed. Fix it or remove it, then run this command again.');
    }
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(mergeMcpConfig(current, profile), null, 2) + '\n'));
  telemetry.event('command.configureBrowser', { profile });

  const open = 'Open mcp.json';
  const choice = await vscode.window.showInformationMessage(
    `Browser co-pilot "${PLAYWRIGHT_SERVER_ID}" configured with the ${profile} profile. Start it from mcp.json or "MCP: List Servers".`,
    open
  );
  if (choice === open) await vscode.window.showTextDocument(file);
}

/** Copies the bundled Agent Forge skills into <workspace>/.github/skills so Copilot agent sessions pick them up. */
export async function installSkills(context: vscode.ExtensionContext, telemetry: Telemetry) {
  const folder = await pickFolder();
  if (!folder) return void vscode.window.showWarningMessage('Open a folder first.');
  const source = vscode.Uri.joinPath(context.extensionUri, 'plugin', 'skills');
  const target = vscode.Uri.joinPath(folder.uri, '.github', 'skills');
  const skills = (await vscode.workspace.fs.readDirectory(source)).filter(([, t]) => t === vscode.FileType.Directory).map(([n]) => n);

  const existing: string[] = [];
  for (const s of skills) if (await exists(vscode.Uri.joinPath(target, s))) existing.push(s);
  if (existing.length) {
    const overwrite = 'Overwrite';
    const answer = await vscode.window.showWarningMessage(
      `These skills already exist in .github/skills and will be replaced: ${existing.join(', ')}`,
      { modal: true },
      overwrite
    );
    if (answer !== overwrite) return;
  }

  for (const s of skills) await vscode.workspace.fs.copy(vscode.Uri.joinPath(source, s), vscode.Uri.joinPath(target, s), { overwrite: true });
  telemetry.event('command.installSkills', undefined, { skills: skills.length });
  void vscode.window.showInformationMessage(`Installed ${skills.length} Agent Forge skill(s) into .github/skills.`);
}
