export type BrowserProfile = 'isolated' | 'extension';

export interface McpServer {
  type?: string;
  command: string;
  args: string[];
}

export interface McpConfig {
  servers?: Record<string, McpServer | Record<string, unknown>>;
  inputs?: unknown[];
  [key: string]: unknown;
}

export const PLAYWRIGHT_SERVER_ID = 'copilot-studio-browser';

/** Playwright MCP limited to Copilot Studio, Power Platform and Microsoft sign-in hosts. */
export function playwrightServer(profile: BrowserProfile): McpServer {
  const origins = [
    'https://copilotstudio.microsoft.com',
    'https://*.powerva.microsoft.com',
    'https://make.powerapps.com',
    'https://make.powerautomate.com',
    'https://admin.powerplatform.microsoft.com',
    'https://login.microsoftonline.com'
  ].join(';');
  const args = ['-y', '@playwright/mcp@latest', '--browser', 'msedge', '--allowed-origins', origins];
  args.push(profile === 'extension' ? '--extension' : '--isolated');
  return { type: 'stdio', command: 'npx', args };
}

/** Parses mcp.json, which VS Code allows to contain line comments and trailing commas. */
export function parseMcpJson(text: string): McpConfig {
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return cleaned.trim() ? (JSON.parse(cleaned) as McpConfig) : {};
}

/** Adds or replaces the Agent Forge browser server without touching other servers or inputs. */
export function mergeMcpConfig(existing: McpConfig | undefined, profile: BrowserProfile): McpConfig {
  return mergeServer(existing, PLAYWRIGHT_SERVER_ID, playwrightServer(profile));
}

/** Adds or replaces one server without touching other servers or inputs. */
export function mergeServer(existing: McpConfig | undefined, id: string, server: McpServer): McpConfig {
  const base: McpConfig = existing && typeof existing === 'object' ? { ...existing } : {};
  return { ...base, servers: { ...(base.servers ?? {}), [id]: server } };
}

export const LINT_SERVER_ID = 'agent-forge';

/** Read-only Agent Forge MCP server (lint, inventory, Mermaid) bundled with the extension. Needs Node.js on PATH. */
export function lintServer(cliPath: string): McpServer {
  return { type: 'stdio', command: 'node', args: [cliPath, 'mcp', '${workspaceFolder}'] };
}
