import * as vscode from 'vscode';
import type { Telemetry } from '../telemetry';
import { LINT_SERVER_ID, lintServer, mergeServer, parseMcpJson, PLAYWRIGHT_SERVER_ID, playwrightServer, type BrowserProfile, type McpConfig, type McpServer } from './mcpConfig';

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

/** Adds or replaces one server in <folder>/.vscode/mcp.json. Returns the file, or undefined when it could not be parsed. */
async function writeServer(folder: vscode.WorkspaceFolder, id: string, server: McpServer): Promise<vscode.Uri | undefined> {
  const file = vscode.Uri.joinPath(folder.uri, '.vscode', 'mcp.json');
  let current: McpConfig | undefined;
  if (await exists(file)) {
    try {
      current = parseMcpJson(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
    } catch {
      void vscode.window.showErrorMessage('.vscode/mcp.json could not be parsed. Fix it or remove it, then run this command again.');
      return undefined;
    }
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(mergeServer(current, id, server), null, 2) + '\n'));
  return file;
}

/** Writes the Playwright MCP browser co-pilot into .vscode/mcp.json, honouring agentForge.browser.profile. */
export async function configureBrowser(telemetry: Telemetry) {
  const folder = await pickFolder();
  if (!folder) return void vscode.window.showWarningMessage('Open a folder first.');
  const profile = vscode.workspace.getConfiguration('agentForge', folder).get<BrowserProfile>('browser.profile', 'isolated');
  const file = await writeServer(folder, PLAYWRIGHT_SERVER_ID, playwrightServer(profile));
  if (!file) return;
  telemetry.event('command.configureBrowser', { profile });

  const open = 'Open mcp.json';
  const choice = await vscode.window.showInformationMessage(
    `Browser co-pilot "${PLAYWRIGHT_SERVER_ID}" configured with the ${profile} profile. Start it from mcp.json or "MCP: List Servers".`,
    open
  );
  if (choice === open) await vscode.window.showTextDocument(file);
}

/** Registers the bundled read-only Agent Forge MCP server (lint, inventory, Mermaid) in .vscode/mcp.json. */
export async function configureLintServer(context: vscode.ExtensionContext, telemetry: Telemetry) {
  const folder = await pickFolder();
  if (!folder) return void vscode.window.showWarningMessage('Open a folder first.');
  const cli = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.js').fsPath;
  const ok = 'Add server';
  const answer = await vscode.window.showInformationMessage(
    `Add the read-only "${LINT_SERVER_ID}" MCP server to .vscode/mcp.json? It runs "node ${cli} mcp" locally and needs Node.js on PATH. The path is machine-specific; re-run this command after updating the extension.`,
    { modal: true },
    ok
  );
  if (answer !== ok) return;
  const file = await writeServer(folder, LINT_SERVER_ID, lintServer(cli));
  if (!file) return;
  telemetry.event('command.configureLintServer');
  const open = 'Open mcp.json';
  const choice = await vscode.window.showInformationMessage(`"${LINT_SERVER_ID}" MCP server added. Start it from mcp.json or "MCP: List Servers".`, open);
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
