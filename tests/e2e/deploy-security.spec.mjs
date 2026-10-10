import { request as httpRequest } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { test, expect } from './runtime.mjs';
import { accessConfig } from './access-fixture.mjs';

const target = process.env.KAIWA_E2E_SECURITY_TARGET;
const tokens = JSON.parse(process.env.KAIWA_E2E_SYNTHETIC_TOKENS || '{}');
const host = new URL(accessConfig.origin).host;
const profile = { name: 'Ado E2E', jlpt_level: 'N5', interests: 'música sintética E2E', goals: 'Datos sintéticos E2E: despliegue privado' };

async function originRequest(path, options) {
  const encoded = new Request(`${target}${path}`, options);
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers = Object.fromEntries(encoded.headers);
  // Node fetch replaces Host with the transport URL; http.request preserves
  // the public origin while reaching the dedicated loopback test server.
  headers.host = new Headers(options.headers).get('host') || host;
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${target}${path}`, { method: encoded.method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode, headers: response.headers,
      })));
    });
    request.setTimeout(30_000, () => request.destroy(new Error('HTTP origin request timeout')));
    request.on('error', reject);
    request.end(body);
  });
}

async function call(path, options = {}) {
  const headers = { Host: host, ...options.headers };
  if (options.token) headers['Cf-Access-Jwt-Assertion'] = options.token;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return originRequest(path, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function accepted(path, options = {}) {
  const response = await call(path, { token: tokens.valid, ...options });
  expect(response.status, `Operación autorizada ${path}`).toBe(200);
  return response.json();
}

function websocketHeaders(token, origin) {
  const headers = {
    Host: host, Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket',
    'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13',
  };
  if (token) headers['Cf-Access-Jwt-Assertion'] = token;
  return headers;
}

function websocketUpgrade(token, origin = accessConfig.origin) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${target}/api/codex/voice`, { headers: websocketHeaders(token, origin) });
    request.setTimeout(10_000, () => request.destroy(new Error('WebSocket handshake timeout')));
    request.on('response', response => { response.resume(); resolve(response.statusCode); });
    request.on('upgrade', (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end();
  });
}

function websocketCloseCode(token) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${target}/api/codex/voice`, { headers: websocketHeaders(token, accessConfig.origin) });
    request.on('error', reject);
    request.on('response', response => { response.resume(); reject(new Error(`WebSocket denegado: ${response.statusCode}`)); });
    request.on('upgrade', (_response, socket, head) => {
      let frames = head;
      const deadline = setTimeout(() => { socket.destroy(); reject(new Error('WebSocket no cerró al expirar Access.')); }, 10_000);
      socket.on('error', error => { clearTimeout(deadline); reject(error); });
      socket.on('data', chunk => {
        frames = Buffer.concat([frames, chunk]);
        if (frames.length < 4) return;
        if ((frames[0] & 0x0f) !== 8) {
          clearTimeout(deadline);
          socket.destroy();
          reject(new Error('Evento de voz inesperado sin enviar SDP.'));
          return;
        }
        clearTimeout(deadline);
        socket.destroy();
        resolve(frames.readUInt16BE(2));
      });
    });
    request.end();
  });
}

test.describe('Origen privado integrado con JWT sintético', () => {
  test.skip(!target, 'Ejecutar únicamente mediante deploy-security-run.mjs con SQLite aislada.');

  test('Todo el origen y la voz rechazan anónimos y headers de identidad falsificados', async ({}, testInfo) => {
    const results = [];
    for (const path of ['/', '/static/app.js', '/api/profile', '/api/memory', '/api/backup/export', '/docs', '/openapi.json']) {
      const response = await call(path, { headers: { 'Cf-Access-Authenticated-User-Email': accessConfig.email } });
      expect([401, 403]).toContain(response.status);
      results.push({ path, status: response.status });
    }
    for (const path of ['/api/reset', '/api/settings', '/api/setup/pull', '/api/backup/import']) {
      const response = await call(path, { method: 'POST', body: {} });
      expect([401, 403]).toContain(response.status);
      results.push({ path, method: 'POST', status: response.status });
    }
    expect(await websocketUpgrade()).toBe(403);
    await testInfo.attach('anonymous-denials', { body: JSON.stringify(results), contentType: 'application/json' });
  });

  test('Firma, algoritmo, emisor, audiencia, identidad y vigencia se verifican por HTTPS/JWKS real', async ({}, testInfo) => {
    const results = [];
    for (const [caseName, token] of Object.entries(tokens)) {
      if (caseName === 'valid') continue;
      const response = await call('/api/profile', { token });
      expect([401, 403], caseName).toContain(response.status);
      expect(await websocketUpgrade(token), caseName).toBe(403);
      results.push({ caseName, httpStatus: response.status, websocketStatus: 403 });
    }
    const authorized = await call('/api/profile', { token: tokens.valid });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get('cache-control')).toBe('private, no-store');
    expect(authorized.headers.get('x-frame-options')).toBe('DENY');
    expect((await authorized.json()).name).toBe('');
    await testInfo.attach('jwt-validation-results', { body: JSON.stringify(results), contentType: 'application/json' });
  });

  test('Host y origen bloquean rutas alternativas y mutaciones entre webs sin cambiar SQLite', async () => {
    const before = await accepted('/api/profile');
    expect((await call('/api/profile', { token: tokens.valid, headers: { Host: 'alternate.example.invalid' } })).status).toBe(403);
    for (const headers of [
      {}, { Origin: 'https://attacker.example.invalid' },
      { Origin: accessConfig.origin, 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const response = await call('/api/profile', { method: 'PUT', token: tokens.valid, headers, body: profile });
      expect(response.status).toBe(403);
    }
    expect(await accepted('/api/profile')).toEqual(before);
    expect(await websocketUpgrade(tokens.valid, 'https://attacker.example.invalid')).toBe(403);
    expect(await websocketUpgrade(tokens.valid)).toBe(101);
  });

  test('Liveness local es mínimo y las peticiones de proxy no eluden Access', async () => {
    expect(await (await fetch(`${target}/healthz`)).json()).toEqual({ status: 'ok' });
    for (const headers of [{ 'X-Forwarded-For': '127.0.0.1' }, { 'CF-Ray': 'synthetic' }, { 'Forwarded': 'for=127.0.0.1' }]) {
      const response = await call('/healthz', { headers });
      expect([401, 403]).toContain(response.status);
    }
  });

  test('Una identidad de producción incompleta impide construir la aplicación', async ({}, testInfo) => {
    const response = await fetch(`${process.env.KAIWA_E2E_SECURITY_CONTROL}/configuration-check`);
    expect(response.status).toBe(200);
    const results = await response.json();
    expect(results).toHaveLength(4);
    for (const result of results) expect(result.exitCode, result.missingVariable).toBeGreaterThan(0);
    await testInfo.attach('fail-closed-configuration', { body: JSON.stringify(results), contentType: 'application/json' });
  });

  test('La voz cierra con política 1008 al expirar el JWT, sin llamar al proveedor', async ({}, testInfo) => {
    const issued = await (await fetch(`${process.env.KAIWA_E2E_SECURITY_CONTROL}/short-lived-token`)).json();
    const beganAt = Date.now();
    const closeCode = await websocketCloseCode(issued.token);
    expect(closeCode).toBe(1008);
    expect(Date.now() - beganAt).toBeLessThan(10_000);
    expect((await call('/api/profile', { token: issued.token })).status).toBe(403);
    await testInfo.attach('voice-auth-expiry', {
      body: JSON.stringify({ closeCode, elapsedMs: Date.now() - beganAt, providerStarted: false }),
      contentType: 'application/json',
    });
  });

  test('Operaciones autorizadas, backup consistente y reinicio conservan memoria sintética', async ({}, testInfo) => {
    const originHeaders = { Origin: accessConfig.origin };
    await accepted('/api/profile', { method: 'PUT', headers: originHeaders, body: profile });
    const memory = await accepted('/api/memory', {
      method: 'POST', headers: originHeaders,
      body: { category: 'intereses', content: 'Banda ficticia de despliegue E2E: Prisma Lunar.' },
    });
    const snapshotResponse = await call('/api/backup/export', { token: tokens.valid });
    expect(snapshotResponse.status).toBe(200);
    const snapshot = Buffer.from(await snapshotResponse.arrayBuffer());
    expect(snapshot.subarray(0, 16).toString()).toBe('SQLite format 3\u0000');
    await accepted(`/api/memory/${memory.id}`, {
      method: 'PUT', headers: originHeaders,
      body: { category: 'intereses', content: 'Banda ficticia modificada E2E.' },
    });
    const form = new FormData();
    form.set('file', new Blob([snapshot]), 'synthetic-e2e.db');
    const restored = await originRequest('/api/backup/import', {
      method: 'POST', headers: { Host: host, Origin: accessConfig.origin, 'Cf-Access-Jwt-Assertion': tokens.valid }, body: form,
    });
    expect(restored.status).toBe(200);
    expect((await accepted('/api/memory')).memories.find(item => item.id === memory.id).content).toBe(memory.content);
    const control = await fetch(`${process.env.KAIWA_E2E_SECURITY_CONTROL}/restart`);
    expect(control.status).toBe(200);
    expect((await accepted('/api/profile')).name).toBe(profile.name);
    expect((await accepted('/api/memory')).memories.find(item => item.id === memory.id).content).toBe(memory.content);
    await testInfo.attach('persistent-backup-evidence', {
      body: JSON.stringify({ snapshotBytes: snapshot.length, sha256: createHash('sha256').update(snapshot).digest('hex'), restored: true, survivesRestart: true }),
      contentType: 'application/json',
    });
  });
});
