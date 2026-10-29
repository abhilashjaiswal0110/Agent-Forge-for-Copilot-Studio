import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const common = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
    define: {
      __TELEMETRY_CONNECTION_STRING__: JSON.stringify(process.env.AGENT_FORGE_TELEMETRY ?? '')
    }
  }),
  esbuild.context({
    ...common,
    entryPoints: ['src/cli/index.ts'],
    outfile: 'dist/cli.js',
    banner: { js: '#!/usr/bin/env node' },
    define: { __VERSION__: JSON.stringify(version) }
  })
]);

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
