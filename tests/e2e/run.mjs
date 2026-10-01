import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { playwrightRoot } from './runtime.mjs';

const result = spawnSync(process.execPath, [
  resolve(playwrightRoot, 'cli.js'), 'test',
  '--config', resolve(import.meta.dirname, 'playwright.config.mjs'),
  ...process.argv.slice(2),
], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
