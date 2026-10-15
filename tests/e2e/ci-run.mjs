import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repository = resolve(import.meta.dirname, '../..');
const origin = 'http://127.0.0.1:18145';
const suites = ['ui.spec.mjs', 'amadeus.spec.mjs'];
const artifacts = resolve(process.env.KAIWA_E2E_ARTIFACTS || join(repository, '../../work/amadeus/ci'));

function isolatedEnvironment(work) {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith('KAIWA_') && !name.startsWith('KAIWA_E2E_') && name !== 'KAIWA_PLAYWRIGHT_ROOT') delete environment[name];
  }
  delete environment.OPENAI_API_KEY;
  delete environment.CODEX_API_KEY;
  return {
    ...environment, KAIWA_DEPLOYMENT: 'local', KAIWA_DB_PATH: join(work, 'synthetic-kaiwa.db'),
    KAIWA_TTS_CACHE_PATH: join(work, 'tts-cache'), KAIWA_E2E_BASE_URL: origin,
    KAIWA_E2E_ARTIFACTS: artifacts, KAIWA_E2E_CHANNEL: process.env.KAIWA_E2E_CHANNEL || 'chromium',
    KAIWA_OLLAMA_URL: 'http://127.0.0.1:9', KAIWA_VOICEVOX_URL: 'http://127.0.0.1:9',
    KAIWA_AIVIS_URL: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    PYTHONUNBUFFERED: '1',
  };
}

async function requireFreePort() {
  const probe = createServer();
  await new Promise((accept, reject) => {
    probe.once('error', reject);
    probe.listen(18145, '127.0.0.1', accept);
  });
  await new Promise((accept, reject) => probe.close(error => error ? reject(error) : accept()));
}

function startChild(command, args, options) {
  const subprocess = spawn(command, args, { cwd: repository, detached: true, ...options });
  const child = { process: subprocess, result: null, closed: null };
  child.closed = new Promise(accept => {
    subprocess.once('error', error => { child.result = { code: 1, error: error.message }; });
    subprocess.once('close', (code, signal) => {
      child.result ||= { code: code ?? 1, signal };
      accept(child.result);
    });
  });
  return child;
}

async function waitForChild(child, signal) {
  signal.throwIfAborted();
  let aborted;
  const cancelled = new Promise((_, reject) => {
    aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
  });
  try { return await Promise.race([child.closed, cancelled]); }
  finally { signal.removeEventListener('abort', aborted); }
}

async function waitForApplication(child, signal) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (child.result) throw new Error(`Uvicorn no arrancó: ${child.result.error || child.result.code}. Consulta server.log.`);
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) });
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
    }
    await delay(150, undefined, { signal });
  }
  throw new Error('Uvicorn no respondió a /healthz en 60 segundos. Consulta server.log.');
}

async function requireEmptyDatabase(signal) {
  const response = await fetch(`${origin}/api/profile`, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
  if (!response.ok) throw new Error(`El perfil sintético no se pudo leer (${response.status}).`);
  const profile = await response.json();
  if (profile.name !== '') throw new Error('La base del servidor no está vacía. Se rechaza iniciar Playwright.');
}

function signalGroup(child, signal) {
  if (!child?.process.pid) return false;
  try { process.kill(-child.process.pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function stopChild(child) {
  if (!signalGroup(child, 'SIGTERM')) return;
  await Promise.race([child.closed, delay(5000)]);
  signalGroup(child, 'SIGKILL');
  const result = await Promise.race([child.closed, delay(2000).then(() => null)]);
  if (!result) throw new Error('Un proceso propio no terminó después de TERM/KILL.');
}

async function cleanup(resources) {
  const failures = [];
  for (const child of [resources.tests, resources.server]) {
    try { await stopChild(child); }
    catch (error) { failures.push(error.message); }
  }
  try { await resources.log?.close(); }
  catch (error) { failures.push(error.message); }
  try { if (resources.work) await rm(resources.work, { recursive: true, force: true }); }
  catch (error) { failures.push(error.message); }
  return failures;
}

async function main() {
  if (process.platform === 'win32') throw new Error('Este runner usa grupos POSIX; ejecutar en Linux o macOS.');
  const resources = {};
  const controller = new AbortController();
  const cancel = signal => controller.abort(new Error(`Runner cancelado: ${signal}.`));
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const timeout = setTimeout(() => cancel('timeout de ocho minutos'), 8 * 60_000);
  const record = { startedAt: new Date().toISOString(), suites, origin, platform: process.platform, node: process.version, status: 'failed' };
  try {
    await mkdir(artifacts, { recursive: true });
    await requireFreePort();
    resources.work = await mkdtemp(join(tmpdir(), 'kaiwa-ui-ci-'));
    resources.log = await open(join(artifacts, 'server.log'), 'w');
    const environment = isolatedEnvironment(resources.work);
    resources.server = startChild(process.env.KAIWA_E2E_PYTHON || 'python', [
      '-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', '18145', '--no-proxy-headers',
    ], { env: environment, stdio: ['ignore', resources.log.fd, resources.log.fd] });
    await waitForApplication(resources.server, controller.signal);
    await requireEmptyDatabase(controller.signal);
    resources.tests = startChild(process.execPath, [join(repository, 'tests/e2e/run.mjs'), ...suites], {
      env: environment, stdio: 'inherit',
    });
    const result = await waitForChild(resources.tests, controller.signal);
    if (result.error) throw new Error(result.error);
    if (resources.server.result) throw new Error('Uvicorn terminó antes de completar los E2E. Consulta server.log.');
    record.testsExitCode = result.code;
    record.status = result.code === 0 ? 'passed' : 'failed';
    process.exitCode = result.code;
  } catch (error) {
    record.error = error.message;
    console.error(`UI E2E: ${error.message}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    const failures = await cleanup(resources);
    if (failures.length) {
      record.cleanupErrors = failures;
      record.status = 'failed';
      process.exitCode = 1;
      console.error(`UI E2E: limpieza fallida: ${failures.join('; ')}`);
    }
    record.finishedAt = new Date().toISOString();
    record.storage = 'SQLite temporal aislada; no incluida en artefactos';
    await writeFile(join(artifacts, 'run.json'), JSON.stringify(record, null, 2) + '\n');
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

if (process.argv.length !== 2) {
  console.error('Uso: node tests/e2e/ci-run.mjs (ejecuta exclusivamente UI + Amadeus).');
  process.exitCode = 1;
} else {
  await main();
}
