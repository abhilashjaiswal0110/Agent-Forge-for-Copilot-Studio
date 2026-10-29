import * as vscode from 'vscode';

// Injected at build time by esbuild (AGENT_FORGE_TELEMETRY env var). Empty means telemetry is a no-op.
declare const __TELEMETRY_CONNECTION_STRING__: string;

interface Target {
  iKey: string;
  endpoint: string;
}

function parseConnectionString(cs: string): Target | undefined {
  const parts = Object.fromEntries(
    cs.split(';').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()];
    })
  );
  if (!parts.instrumentationkey) return undefined;
  const endpoint = (parts.ingestionendpoint || 'https://dc.services.visualstudio.com').replace(/\/$/, '');
  return { iKey: parts.instrumentationkey, endpoint: `${endpoint}/v2/track` };
}

function split(data?: Record<string, unknown>) {
  const properties: Record<string, string> = {};
  const measurements: Record<string, number> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (typeof v === 'number') measurements[k] = v;
    else if (v !== undefined) properties[k] = String(v);
  }
  return { properties, measurements };
}

/**
 * Usage telemetry through vscode.env.createTelemetryLogger, which honours telemetry.telemetryLevel
 * and the --disable-telemetry flag. Never send content: no agent names, paths, descriptions, IDs or environments.
 */
export class Telemetry implements vscode.Disposable {
  private readonly logger?: vscode.TelemetryLogger;

  constructor(private readonly extensionVersion = '0.0.0') {
    const cs = typeof __TELEMETRY_CONNECTION_STRING__ === 'string' ? __TELEMETRY_CONNECTION_STRING__ : '';
    const target = cs ? parseConnectionString(cs) : undefined;
    if (!target) return;

    const post = (name: string, data?: Record<string, unknown>) => {
      const { properties, measurements } = split(data);
      const body = {
        name: 'Microsoft.ApplicationInsights.Event',
        time: new Date().toISOString(),
        iKey: target.iKey,
        tags: { 'ai.application.ver': this.extensionVersion },
        data: { baseType: 'EventData', baseData: { ver: 2, name, properties, measurements } }
      };
      fetch(target.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
    };

    this.logger = vscode.env.createTelemetryLogger({
      sendEventData: (name, data) => post(name, data),
      sendErrorData: (error, data) => post('error', { ...data, errorName: error.name })
    });
  }

  event(name: string, properties?: Record<string, string>, measurements?: Record<string, number>) {
    this.logger?.logUsage(name, { ...properties, ...measurements });
  }

  dispose() {
    this.logger?.dispose();
  }
}
