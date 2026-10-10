import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { accessConfig, createAccessFixture } from './access-fixture.mjs';

const repository = resolve(import.meta.dirname, '../..');
const work = await mkdtemp(join(tmpdir(), 'kaiwa-deploy-e2e-'));
const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const target = `http://127.0.0.1:${port}`;
let application;
let fixture;

function applicationEnvironment() {
  return {
    ...process.env, KAIWA_DB_PATH: join(work, 'synthetic-kaiwa.db'),
    KAIWA_DEPLOYMENT: 'production', KAIWA_PUBLIC_ORIGIN: accessConfig.origin,
    KAIWA_ACCESS_TEAM_DOMAIN: accessConfig.teamDomain, KAIWA_ACCESS_AUD: accessConfig.audience,
    KAIWA_ALLOWED_EMAIL: accessConfig.email,
    HTTPS_PROXY: fixture.proxyUrl, https_proxy: fixture.proxyUrl,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    SSL_CERT_FILE: fixture.certificate, REQUESTS_CA_BUNDLE: fixture.certificate,
  };
}

async function checkIncompleteConfiguration() {
  const results = [];
  for (const missingVariable of ['KAIWA_PUBLIC_ORIGIN', 'KAIWA_ACCESS_TEAM_DOMAIN', 'KAIWA_ACCESS_AUD', 'KAIWA_ALLOWED_EMAIL']) {
    const environment = applicationEnvironment();
    delete environment[missingVariable];
    const processUnderTest = spawn(process.env.KAIWA_E2E_PYTHON || join(repository, '.venv/bin/python'), ['-c', 'import server.main'], {
      cwd: repository, stdio: 'ignore', env: environment,
    });
    const exitCode = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        processUnderTest.kill('SIGKILL');
        reject(new Error('La configuración incompleta bloqueó el arranque en lugar de rechazarlo.'));
      }, 20_000);
      processUnderTest.once('error', error => { clearTimeout(deadline); reject(error); });
      processUnderTest.once('exit', code => { clearTimeout(deadline); resolve(code); });
    });
    results.push({ missingVariable, exitCode });
  }
  return results;
}

async function stopApplication() {
  if (!application || application.exitCode !== null) return;
  application.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      application.kill('SIGKILL');
      reject(new Error('El servidor aislado no terminó limpiamente.'));
    }, 10_000);
    application.once('exit', () => { clearTimeout(deadline); resolve(); });
  });
}

async function startApplication() {
  application = spawn(process.env.KAIWA_E2E_PYTHON || join(repository, '.venv/bin/python'), [
    '-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', String(port), '--no-proxy-headers', '--lifespan', 'on',
  ], {
    cwd: repository, stdio: ['ignore', 'inherit', 'inherit'],
    env: applicationEnvironment(),
  });
  let startupError;
  application.once('error', error => { startupError = error; });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (application.exitCode !== null) throw new Error(`El servidor aislado falló al arrancar (${application.exitCode}).`);
    try {
      const response = await fetch(`${target}/healthz`);
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch {
      // El puerto todavía no está disponible durante el arranque.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('El servidor aislado no respondió al liveness antes del timeout.');
}

try {
  fixture = await createAccessFixture(async path => {
    if (path === '/short-lived-token') return { token: fixture.shortLivedToken() };
    if (path === '/configuration-check') return checkIncompleteConfiguration();
    if (path !== '/restart') throw new Error('Control de pruebas inexistente.');
    await stopApplication();
    await startApplication();
    return { restarted: true };
  });
  await startApplication();
  const runner = spawn(process.execPath, [join(import.meta.dirname, 'run.mjs'), 'deploy-security.spec.mjs'], {
    cwd: repository, stdio: 'inherit',
    env: {
      ...process.env, KAIWA_E2E_SECURITY_TARGET: target,
      KAIWA_E2E_SECURITY_CONTROL: fixture.proxyUrl,
      KAIWA_E2E_SYNTHETIC_TOKENS: JSON.stringify(fixture.tokens),
    },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    runner.once('error', reject);
    runner.once('exit', code => resolve(code ?? 1));
  });
  if (!fixture.jwksRequests()) throw new Error('La prueba no ejercitó la consulta HTTPS/JWKS real.');
  console.log(`JWKS HTTPS: ${fixture.jwksRequests()} peticiones; SQLite y certificados sintéticos se eliminan al terminar.`);
} finally {
  await stopApplication();
  await fixture?.close();
  await rm(work, { recursive: true, force: true });
}
