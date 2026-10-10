import { request as httpRequest } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { test, expect } from './runtime.mjs';

const target = process.env.KAIWA_E2E_TS_TARGET;
const origin = process.env.KAIWA_E2E_TS_ORIGIN;
const login = process.env.KAIWA_E2E_TS_LOGIN;
const secret = process.env.KAIWA_E2E_TS_SECRET;
const host = origin ? new URL(origin).host : '';
const profile = { name: 'Owner E2E', jlpt_level: 'N5', interests: 'música ficticia', goals: 'Datos sintéticos de despliegue Tailscale' };
const ownerHeaders = () => ({ Host: host, 'Tailscale-User-Login': login, 'X-Kaiwa-Proxy-Secret': secret });

// Native fetch rewrites Host. Preserve public Host over the isolated loopback
// transport, and use Node HTTP so credentials never enter Playwright traces.
async function originRequest(path, options = {}) {
  const encoded = new Request(`${target}${path}`, { method: options.method || 'GET', body: options.body, headers: options.headers });
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers = options.rawHeaders || { ...Object.fromEntries(encoded.headers), Host: options.headers?.Host || host };
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${target}${path}`, { method: encoded.method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.setTimeout(30_000, () => request.destroy(Error('Isolated HTTP request timed out')));
    request.on('error', reject);
    request.end(body);
  });
}

async function call(path, options = {}) {
  return originRequest(path, { ...options,
    headers: { ...ownerHeaders(), ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function accepted(path, options = {}) {
  const response = await call(path, options);
  expect(response.status, `Authorized operation ${path}`).toBe(200);
  return response.json();
}

function websocketUpgrade(overrides = {}, rawHeaders) {
  return new Promise((resolve, reject) => {
    const headers = { ...ownerHeaders(), Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13', ...overrides };
    const request = httpRequest(`${target}/api/codex/voice`, { headers: rawHeaders || headers });
    request.setTimeout(10_000, () => request.destroy(Error('Isolated WebSocket handshake timed out')));
    request.on('response', response => { response.resume(); resolve(response.statusCode); });
    request.on('upgrade', (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end();
  });
}

function duplicatedHeader(name, value, websocket = false) {
  const headers = { ...ownerHeaders(), Origin: origin };
  if (websocket) Object.assign(headers, { Connection: 'Upgrade', Upgrade: 'websocket',
    'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13' });
  return [...Object.entries(headers).flat(), name, value];
}

function invalidIdentities() {
  return [
    { caseName: 'missing-secret', headers: { 'X-Kaiwa-Proxy-Secret': '' } },
    { caseName: 'wrong-secret', headers: { 'X-Kaiwa-Proxy-Secret': randomBytes(32).toString('hex') } },
    { caseName: 'missing-identity', headers: { 'Tailscale-User-Login': '' } },
    { caseName: 'foreign-identity', headers: { 'Tailscale-User-Login': 'other-e2e@example.invalid' } },
    { caseName: 'combined-identity', headers: { 'Tailscale-User-Login': `${login}, ${login}` } },
    { caseName: 'case-changed-identity', headers: { 'Tailscale-User-Login': login.toUpperCase() } },
  ];
}

test.describe('Tailscale trusted proxy, integrated isolated origin', () => {
  test.skip(!target, 'Only tailscale-security-run.mjs may supply an isolated server and synthetic credentials.');

  test('UI, assets, API, backups and voice reject forged identity without trusted proxy', async ({}, testInfo) => {
    const results = [];
    for (const path of ['/', '/static/app.js', '/api/profile', '/api/memory', '/api/backup/export', '/docs', '/openapi.json']) {
      const response = await originRequest(path, { headers: { Host: host, 'Tailscale-User-Login': login } });
      expect(response.status, path).toBe(403);
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      results.push({ path, status: response.status });
    }
    for (const path of ['/api/reset', '/api/settings', '/api/setup/pull', '/api/backup/import']) {
      expect((await originRequest(path, { method: 'POST', headers: { Host: host, Origin: origin } })).status, path).toBe(403);
    }
    expect(await websocketUpgrade({ 'X-Kaiwa-Proxy-Secret': '' })).toBe(403);
    await testInfo.attach('anonymous-denials', { body: JSON.stringify(results), contentType: 'application/json' });
  });

  test('Proxy secret and unique exact owner identity are both required for HTTP and WS', async ({}, testInfo) => {
    const results = [];
    for (const scenario of invalidIdentities()) {
      const response = await call('/api/profile', { headers: scenario.headers });
      expect(response.status, scenario.caseName).toBe(403);
      expect(await websocketUpgrade(scenario.headers), scenario.caseName).toBe(403);
      results.push({ caseName: scenario.caseName, httpStatus: response.status, websocketStatus: 403 });
    }
    for (const [name, value] of [['Tailscale-User-Login', login], ['X-Kaiwa-Proxy-Secret', secret]]) {
      expect((await originRequest('/api/profile', { rawHeaders: duplicatedHeader(name, value) })).status, `duplicate-${name}`).toBe(403);
      expect(await websocketUpgrade({}, duplicatedHeader(name, value, true)), `duplicate-${name}`).toBe(403);
    }
    const authorized = await call('/api/profile');
    expect(authorized.status).toBe(200);
    expect((await authorized.json()).name).toBe('');
    expect(authorized.headers.get('cache-control')).toBe('private, no-store');
    expect(authorized.headers.get('x-content-type-options')).toBe('nosniff');
    expect(authorized.headers.get('strict-transport-security')).toBe('max-age=31536000');
    await testInfo.attach('identity-denials', { body: JSON.stringify(results), contentType: 'application/json' });
  });

  test('Host, Origin and browser cross-site signals prevent mutations and voice', async () => {
    const before = await accepted('/api/profile');
    expect((await call('/api/profile', { headers: { Host: 'alternate.example.invalid' } })).status).toBe(403);
    for (const headers of [{}, { Origin: 'https://attacker.example.invalid' }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }]) {
      expect((await call('/api/profile', { method: 'PUT', headers, body: profile })).status).toBe(403);
      expect(await websocketUpgrade({ Origin: '', ...headers })).toBe(403);
    }
    for (const [name, value] of [['Host', host], ['Origin', origin]]) {
      // h11 rejects duplicate Host and websockets rejects duplicate Origin
      // before ASGI. Either protocol layer or middleware must deny them.
      const deniedStatuses = name === 'Host' ? [400, 403] : [403];
      expect(deniedStatuses).toContain((await originRequest('/api/profile', { method: 'PUT', rawHeaders: duplicatedHeader(name, value), body: JSON.stringify(profile) })).status);
      expect([400, 403]).toContain(await websocketUpgrade({}, duplicatedHeader(name, value, true)));
    }
    expect(await websocketUpgrade({ Host: 'alternate.example.invalid' })).toBe(403);
    expect(await accepted('/api/profile')).toEqual(before);
  });

  test('Only unproxied loopback healthcheck is exempt; proxy headers never bypass identity', async () => {
    expect(await (await fetch(`${target}/healthz`)).json()).toEqual({ status: 'ok' });
    for (const headers of [
      { 'Tailscale-User-Login': login }, { 'Tailscale-User-Name': 'Synthetic Owner' },
      { 'X-Kaiwa-Proxy-Secret': secret }, { 'X-Forwarded-For': '127.0.0.1' }, { Forwarded: 'for=127.0.0.1' }, { 'CF-Ray': 'synthetic' },
    ]) {
      expect((await originRequest('/healthz', { headers: { Host: host, ...headers } })).status).toBe(403);
    }
    expect(await accepted('/healthz')).toEqual({ status: 'ok' });
  });

  test('Invalid hosted configuration fails startup without exposing secrets', async ({}, testInfo) => {
    const response = await fetch(`${process.env.KAIWA_E2E_TS_CONTROL}/configuration-check`);
    expect(response.status).toBe(200);
    const results = await response.json();
    expect(results).toHaveLength(10);
    for (const result of results) expect(result.exitCode, result.caseName).toBeGreaterThan(0);
    await testInfo.attach('fail-closed-configuration', { body: JSON.stringify(results), contentType: 'application/json' });
  });

  test('Owner reaches the voice handler without starting a model provider', async ({}, testInfo) => {
    const status = await websocketUpgrade();
    expect(status).toBe(101);
    await testInfo.attach('voice-handshake', { body: JSON.stringify({ status, sentSdp: false, sentStart: false }), contentType: 'application/json' });
  });

  test('Owner memory, consistent backup restore and process restart preserve synthetic data', async ({}, testInfo) => {
    const headers = { Origin: origin };
    await accepted('/api/profile', { method: 'PUT', headers, body: profile });
    const memory = await accepted('/api/memory', { method: 'POST', headers,
      body: { category: 'intereses', content: 'Banda ficticia Tailscale E2E: Aurora Azul.' } });
    const exported = await call('/api/backup/export');
    expect(exported.status).toBe(200);
    const snapshot = Buffer.from(await exported.arrayBuffer());
    expect(snapshot.subarray(0, 16).toString()).toBe('SQLite format 3\u0000');
    await accepted(`/api/memory/${memory.id}`, { method: 'PUT', headers,
      body: { category: 'intereses', content: 'Memoria modificada ficticia.' } });
    const form = new FormData();
    form.set('file', new Blob([snapshot]), 'synthetic-e2e.db');
    expect((await originRequest('/api/backup/import', { method: 'POST', headers: { ...ownerHeaders(), Origin: origin }, body: form })).status).toBe(200);
    expect((await accepted('/api/memory')).memories.find(item => item.id === memory.id).content).toBe(memory.content);
    const restart = await fetch(`${process.env.KAIWA_E2E_TS_CONTROL}/restart`);
    expect(restart.status).toBe(200);
    expect((await accepted('/api/profile')).name).toBe(profile.name);
    expect((await accepted('/api/memory')).memories.find(item => item.id === memory.id).content).toBe(memory.content);
    await testInfo.attach('persistent-backup-evidence', { body: JSON.stringify({ snapshotBytes: snapshot.length,
      sha256: createHash('sha256').update(snapshot).digest('hex'), restored: true, survivesRestart: true }), contentType: 'application/json' });
  });
});
