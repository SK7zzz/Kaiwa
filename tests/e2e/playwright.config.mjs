import { resolve } from 'node:path';
import { defineConfig } from './runtime.mjs';

const artifacts = process.env.KAIWA_E2E_ARTIFACTS || resolve(import.meta.dirname, 'artifacts');
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 360_000,
  expect: { timeout: 120_000 },
  outputDir: resolve(artifacts, 'results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(artifacts, 'report'), open: 'never' }],
    ['json', { outputFile: resolve(artifacts, 'result.json') }],
  ],
  use: {
    baseURL: process.env.KAIWA_E2E_BASE_URL || 'http://127.0.0.1:8130',
    browserName: 'chromium',
    channel: process.env.KAIWA_E2E_CHANNEL || 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: 'on',
    screenshot: 'only-on-failure',
  },
});
