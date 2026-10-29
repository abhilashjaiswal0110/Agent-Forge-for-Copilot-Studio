import { runCli } from './main';

// Injected at build time by esbuild from package.json.
declare const __VERSION__: string;

runCli(process.argv.slice(2), {
  out: (s) => process.stdout.write(s + '\n'),
  err: (s) => process.stderr.write(s + '\n'),
  cwd: process.cwd(),
  version: typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0'
}).then((code) => {
  process.exitCode = code;
});
