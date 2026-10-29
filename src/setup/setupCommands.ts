import * as vscode from 'vscode';
import type { Telemetry } from '../telemetry';
import { HOOK_MARKER, parseRecipe, preCommitHook, type Recipe } from './recipes';
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

  const recipesDir = vscode.Uri.joinPath(context.extensionUri, 'plugin', 'recipes');
  const prompts = vscode.Uri.joinPath(folder.uri, '.github', 'prompts');
  const recipes = (await vscode.workspace.fs.readDirectory(recipesDir)).filter(([n]) => n.endsWith('.prompt.md')).map(([n]) => n);
  let added = 0;
  for (const r of recipes) {
    const dest = vscode.Uri.joinPath(prompts, `cps-${r}`);
    if (await exists(dest)) continue;
    await vscode.workspace.fs.copy(vscode.Uri.joinPath(recipesDir, r), dest);
    added++;
  }
  telemetry.event('command.installSkills', undefined, { skills: skills.length, prompts: added });
  void vscode.window.showInformationMessage(`Installed ${skills.length} Agent Forge skill(s) into .github/skills and ${added} browser recipe prompt(s) into .github/prompts.`);
}

/** Lets the user pick a portal recipe, asks for consent, then hands it to Copilot Chat in agent mode. */
export async function runBrowserRecipe(context: vscode.ExtensionContext, telemetry: Telemetry) {
  const dir = vscode.Uri.joinPath(context.extensionUri, 'plugin', 'recipes');
  const entries = (await vscode.workspace.fs.readDirectory(dir)).filter(([n]) => n.endsWith('.prompt.md')).map(([n]) => n).sort();
  const recipes: Recipe[] = [];
  for (const n of entries) recipes.push(parseRecipe(n.replace(/\.prompt\.md$/, ''), new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, n)))));
  const pick = await vscode.window.showQuickPick(
    recipes.map((r) => ({ label: r.id, detail: r.description, recipe: r })),
    { title: 'Agent Forge: Run Browser Recipe', placeHolder: 'Recipes drive the Copilot Studio portal through the browser co-pilot (Playwright MCP)' }
  );
  if (!pick) return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  let configured = false;
  if (folder) {
    try {
      const cfg = parseMcpJson(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, '.vscode', 'mcp.json'))));
      configured = !!cfg.servers?.[PLAYWRIGHT_SERVER_ID];
    } catch {
      configured = false;
    }
  }
  if (!configured) {
    const set = 'Configure Browser Co-pilot';
    const choice = await vscode.window.showWarningMessage(`This recipe needs the "${PLAYWRIGHT_SERVER_ID}" MCP server, which is not configured in this workspace.`, set);
    if (choice === set) await vscode.commands.executeCommand('agentForge.configureBrowser');
    return;
  }

  const consent = 'Start recipe';
  const ok = await vscode.window.showWarningMessage(
    `"${pick.label}" lets Copilot drive a browser on Copilot Studio pages. It stops and asks before anything is saved, published or deleted, and never types passwords. Continue?`,
    { modal: true, detail: pick.recipe.description },
    consent
  );
  if (ok !== consent) return;
  telemetry.event('command.runBrowserRecipe', { recipe: pick.label });
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: pick.recipe.body, mode: 'agent' });
  } catch {
    await vscode.env.clipboard.writeText(pick.recipe.body);
    void vscode.window.showInformationMessage('Copilot Chat is not available. The recipe was copied to the clipboard; paste it into your agent host.');
  }
}

/** Installs a git pre-commit hook that blocks commits with Agent Forge lint errors. */
export async function installGitHook(context: vscode.ExtensionContext, telemetry: Telemetry) {
  const folder = await pickFolder();
  if (!folder) return void vscode.window.showWarningMessage('Open a folder first.');
  const gitDir = vscode.Uri.joinPath(folder.uri, '.git');
  let isDir = false;
  try {
    isDir = (await vscode.workspace.fs.stat(gitDir)).type === vscode.FileType.Directory;
  } catch {
    isDir = false;
  }
  if (!isDir) return void vscode.window.showWarningMessage('This folder is not the root of a git repository.');
  const hook = vscode.Uri.joinPath(gitDir, 'hooks', 'pre-commit');
  if (await exists(hook)) {
    const current = new TextDecoder().decode(await vscode.workspace.fs.readFile(hook));
    if (!current.includes(HOOK_MARKER)) {
      return void vscode.window.showWarningMessage('A pre-commit hook already exists and was not created by Agent Forge; it was left unchanged. Add "node <extension>/dist/cli.js lint . --fail-on error" to it yourself.');
    }
  }
  const cli = vscode.Uri.joinPath(context.extensionUri, 'dist', 'cli.js').fsPath;
  const ok = 'Install hook';
  const answer = await vscode.window.showInformationMessage(
    `Install a git pre-commit hook in ${folder.name} that runs "node ${cli} lint . --fail-on error"? It needs Node.js on PATH and uses this machine's extension path.`,
    { modal: true },
    ok
  );
  if (answer !== ok) return;
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(gitDir, 'hooks'));
  await vscode.workspace.fs.writeFile(hook, new TextEncoder().encode(preCommitHook(cli)));
  if (process.platform !== 'win32') {
    const { chmod } = await import('node:fs/promises');
    await chmod(hook.fsPath, 0o755);
  }
  telemetry.event('command.installGitHook');
  void vscode.window.showInformationMessage('Agent Forge pre-commit hook installed.');
}
