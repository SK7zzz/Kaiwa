import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const runtimeRoot = process.env.KAIWA_PLAYWRIGHT_ROOT ||
  '/Users/ado/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const playwrightPackage = require.resolve('playwright/package.json', {
  paths: [resolve(import.meta.dirname, 'node_modules'), runtimeRoot],
});
const playwrightRoot = dirname(playwrightPackage);
const { test, expect, defineConfig, devices } = require(resolve(playwrightRoot, 'test.js'));

export { test, expect, defineConfig, devices, playwrightRoot };
