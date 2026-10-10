import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '../..');
const work = await mkdtemp(join(tmpdir(), 'kaiwa-tailscale-e2e-'));
const secret = randomBytes(32).toString('hex');
const secretFile = join(work, 'proxy-secret');
await writeFile(secretFile, `${secret}\n`, { mode: 0o600 });
await writeFile(join(work, 'short-secret'), 'abc\n', { mode: 0o600 });
await writeFile(join(work, 'invalid-secret'), `${'g'.repeat(64)}\n`, { mode: 0o600 });
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const target = `http://127.0.0.1:${port}`;
const origin = 'https://synthetic-node.tail000000.ts.net';
const login = 'owner-e2e@example.invalid';
const python = process.env.KAIWA_E2E_PYTHON || join(repository, '.venv/bin/python');
let application;

function environment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('KAIWA_')) delete env[key];
  return { ...env, KAIWA_DB_PATH: join(work, 'synthetic-kaiwa.db'),
    KAIWA_DEPLOYMENT: 'production', KAIWA_AUTH_PROVIDER: 'tailscale',
    KAIWA_PUBLIC_ORIGIN: origin, KAIWA_TAILSCALE_LOGIN: login,
    KAIWA_PROXY_SECRET_FILE: secretFile };
}

async function configurationChecks() {
  const variants = [
    ...['KAIWA_PUBLIC_ORIGIN', 'KAIWA_TAILSCALE_LOGIN', 'KAIWA_PROXY_SECRET_FILE'].map(key => ({ name: `missing-${key}`, key, value: undefined })),
    { name: 'unknown-provider', key: 'KAIWA_AUTH_PROVIDER', value: 'unknown' },
    { name: 'hosted-local', key: 'KAIWA_DEPLOYMENT', value: 'local' },
    { name: 'insecure-origin', key: 'KAIWA_PUBLIC_ORIGIN', value: 'http://synthetic-node.tail000000.ts.net' },
    { name: 'multiple-login', key: 'KAIWA_TAILSCALE_LOGIN', value: `${login},other@example.invalid` },
    { name: 'missing-file', key: 'KAIWA_PROXY_SECRET_FILE', value: join(work, 'absent') },
    { name: 'short-secret', key: 'KAIWA_PROXY_SECRET_FILE', value: join(work, 'short-secret') },
    { name: 'invalid-secret', key: 'KAIWA_PROXY_SECRET_FILE', value: join(work, 'invalid-secret') },
  ];
  const results = [];
  for (const variant of variants) {
    const env = environment();
    if (variant.value === undefined) delete env[variant.key];
    else env[variant.key] = variant.value;
    const child = spawn(python, ['-c', 'import server.main'], { cwd: repository, env, stdio: 'ignore' });
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Configuration import timed out')); }, 20_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    results.push({ caseName: variant.name, exitCode });
  }
  return results;
}

async function stop() {
  if (!application || application.exitCode !== null) return;
  application.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { application.kill('SIGKILL'); reject(Error('Isolated application did not stop')); }, 10_000);
    application.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function start() {
  application = spawn(python, ['-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', String(port), '--no-proxy-headers', '--lifespan', 'on'],
    { cwd: repository, env: environment(), stdio: ['ignore', 'inherit', 'inherit'] });
  let spawnError;
  application.once('error', error => { spawnError = error; });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (application.exitCode !== null) throw Error(`Isolated application failed startup (${application.exitCode})`);
    try { if ((await fetch(`${target}/healthz`)).ok) return; } catch { /* Pending startup. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Isolated application startup timed out');
}

const control = createHttpServer(async (request, response) => {
  try {
    let result;
    if (request.url === '/restart') { await stop(); await start(); result = { restarted: true }; }
    else if (request.url === '/configuration-check') result = await configurationChecks();
    else { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch { response.writeHead(500).end('{"error":"Isolated control failed"}'); }
});
try {
  await new Promise(resolve => control.listen(0, '127.0.0.1', resolve));
  await start();
  const child = spawn(process.execPath, [join(import.meta.dirname, 'run.mjs'), 'tailscale-security.spec.mjs'], {
    cwd: repository, stdio: 'inherit', env: { ...process.env,
      KAIWA_E2E_BASE_URL: target, KAIWA_E2E_TS_TARGET: target, KAIWA_E2E_TS_ORIGIN: origin, KAIWA_E2E_TS_LOGIN: login,
      KAIWA_E2E_TS_SECRET: secret, KAIWA_E2E_TS_CONTROL: `http://127.0.0.1:${control.address().port}` },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally {
  await stop();
  await new Promise(resolve => control.close(resolve));
  await rm(work, { recursive: true, force: true });
}
