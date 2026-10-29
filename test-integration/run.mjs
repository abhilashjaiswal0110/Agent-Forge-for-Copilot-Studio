// Integration test of the packaged extension: installs the .vsix into a freshly downloaded VS Code with
// isolated extension and user-data folders, opens a copy of the Contoso sample and runs suite.cjs.
//   npm run package && npm run test:integration [-- path/to/file.vsix]
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

const root = resolve(import.meta.dirname, '..');
const vsix =
  process.argv[2] ??
  readdirSync(root)
    .filter((f) => f.endsWith('.vsix'))
    .map((f) => join(root, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!vsix) {
  console.error('No .vsix found. Run "npm run package" first or pass a path.');
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), 'af-int-'));
const extensionsDir = join(scratch, 'extensions');
const userDataDir = join(scratch, 'user-data');
const workspace = join(scratch, 'workspace');
cpSync(join(root, 'samples', 'contoso-it-helpdesk'), workspace, { recursive: true });

let code = 1;
try {
  const vscodeExecutablePath = await downloadAndUnzipVSCode(process.env.AGENT_FORGE_VSCODE_VERSION ?? 'stable');
  const [cli] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  const windows = process.platform === 'win32';
  const q = (s) => (windows ? `"${s}"` : s);
  // The VS Code CLI is a .cmd on Windows, which needs a shell; quote everything for paths with spaces.
  const install = spawnSync(q(cli), ['--extensions-dir', extensionsDir, '--user-data-dir', userDataDir, '--install-extension', vsix].map(q), {
    encoding: 'utf8',
    shell: windows
  });
  if (install.status !== 0) throw new Error(`Installing ${vsix} failed:\n${install.stdout}\n${install.stderr}`);
  console.log(install.stdout.trim());

  // Copy the host and suite to the scratch folder: test paths containing spaces break the launcher.
  cpSync(join(root, 'test-integration', 'host'), join(scratch, 'host'), { recursive: true });
  cpSync(join(root, 'test-integration', 'suite.cjs'), join(scratch, 'suite.cjs'));
  await runTests({
    vscodeExecutablePath,
    reuseMachineInstall: true,
    extensionDevelopmentPath: join(scratch, 'host'),
    extensionTestsPath: join(scratch, 'suite.cjs'),
    launchArgs: [workspace, '--extensions-dir', extensionsDir, '--user-data-dir', userDataDir, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: { AGENT_FORGE_INT_WORKSPACE: workspace }
  });
  code = 0;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 });
  } catch (e) {
    // VS Code can hold a lock briefly after exit on Windows; a leftover temp folder must not fail the run.
    console.warn(`Could not remove ${scratch}: ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(code);
