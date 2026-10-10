import { createHash } from 'node:crypto';
import { test, expect } from './runtime.mjs';
import { makeSpeechFixture } from './speech-fixture.mjs';
import { installVoiceDiagnostics, attachVoiceDiagnostics } from './voice-diagnostics.mjs';

const enabled = process.env.KAIWA_E2E_TAILSCALE === '1';
const origin = 'https://rushia-1.tail7bb611.ts.net';
if (enabled && process.env.KAIWA_E2E_BASE_URL !== origin) {
  throw new Error(`La suite final requiere KAIWA_E2E_BASE_URL=${origin}.`);
}
if (enabled && !process.env.KAIWA_E2E_VOICE_SOURCE_WAV) {
  throw new Error('Indica KAIWA_E2E_VOICE_SOURCE_WAV con la frase japonesa conocida, PCM mono 16 bits 48 kHz sin padding.');
}
const speech = enabled ? makeSpeechFixture() : null;
const diagnostics = new WeakMap();
const pageErrors = new WeakMap();
const mutationOrigins = new WeakMap();
const manualPlan = 'Plan sintético E2E Tailscale: practicar un corte de pelo de tres centímetros.';
const editedPlan = 'Plan sintético E2E Tailscale corregido: practicar un corte de pelo de dos centímetros.';

async function json(response) {
  expect(response.ok(), `HTTP ${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

async function requireSyntheticProfile(request) {
  const profile = await json(await request.get('/api/profile'));
  expect(profile.name, 'Nunca ejecutar contra el perfil personal migrado.').toBe('Ado E2E');
  expect(profile.goals).toContain('Datos sintéticos E2E');
  expect(profile.settings.provider).toBe('codex');
  expect(profile.settings.auto_play).toBe(false);
  const health = await json(await request.get('/api/health'));
  expect(health.provider).toBe('codex');
  expect(health.llm_ready).toBe(true);
}

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function navigate(page, view) {
  await page.locator(`.nav-btn[data-view="${view}"]`).click();
  await expect(page.locator(`#view-${view}`)).toBeVisible();
  await expect(page.locator(`#view-${view}`)).not.toHaveAttribute('aria-busy', 'true');
  const dimensions = await page.evaluate(() => ({
    width: innerWidth, content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
}

function responseFor(page, path, method = 'POST') {
  return page.waitForResponse(response =>
    response.url() === `${origin}${path}` && response.request().method() === method);
}

async function openMemory(page) {
  await navigate(page, 'companion');
  await page.locator('#companion-memory').click();
  await expect(page.locator('#companion-memory-panel')).toBeVisible();
}

async function persistedSummary(request, sessionId) {
  const dashboard = await json(await request.get('/api/dashboard'));
  const session = dashboard.recent_sessions.find(item => item.id === sessionId);
  expect(session, 'La sesión cerrada debe permanecer en el historial.').toBeDefined();
  expect(session.minutes).toBeGreaterThanOrEqual(0);
  expect(session.summary.summary.length).toBeGreaterThan(10);
  return session.summary;
}

async function installPlaybackObserver(page) {
  await page.addInitScript(() => {
    window.__tailnetPlayback = [];
    const NativeAudio = window.Audio;
    window.Audio = function(...args) {
      const audio = new NativeAudio(...args);
      audio.addEventListener('playing', () => window.__tailnetPlayback.push({
        duration: audio.duration, paused: audio.paused,
      }));
      return audio;
    };
  });
}

function wavSeconds(wav) {
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  let byteRate = 0;
  let audioBytes = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const chunk = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    expect(offset + 8 + size).toBeLessThanOrEqual(wav.length);
    if (chunk === 'fmt ') byteRate = wav.readUInt32LE(offset + 16);
    if (chunk === 'data') audioBytes = size;
    offset += 8 + size + size % 2;
  }
  expect(byteRate).toBeGreaterThan(0);
  expect(audioBytes).toBeGreaterThan(0);
  return audioBytes / byteRate;
}

async function audioMetrics(page) {
  return page.evaluate(async () => {
    const reports = await codexCall.peer.getStats();
    return [...reports.values()]
      .filter(report => report.kind === 'audio' &&
        ['inbound-rtp', 'outbound-rtp', 'media-source'].includes(report.type))
      .map(({ type, bytesReceived, bytesSent, totalAudioEnergy }) =>
        ({ type, bytesReceived, bytesSent, totalAudioEnergy }));
  });
}

test.describe('Despliegue privado Tailscale: HTTPS y proveedores reales', () => {
  test.skip(!enabled, 'Requiere KAIWA_E2E_TAILSCALE=1 y la BD sintética previa a la migración personal.');
  test.use({
    permissions: ['microphone'],
    launchOptions: { args: speech ? [
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${speech.path}%noloop`,
    ] : [] },
  });

  test.beforeEach(async ({ page, request }) => {
    await requireSyntheticProfile(request);
    const errors = [];
    pageErrors.set(page, errors);
    const origins = [];
    mutationOrigins.set(page, origins);
    page.on('pageerror', error => errors.push(error.message));
    // The browser supplies Origin. Never forward Tailscale identity or authorization headers.
    page.on('request', outgoing => {
      if (outgoing.url().startsWith(`${origin}/api/`) &&
          ['POST', 'PUT', 'DELETE'].includes(outgoing.method())) {
        origins.push(outgoing.headers().origin);
      }
    });
  });

  test.afterEach(async ({ page, request }, testInfo) => {
    if (diagnostics.has(page)) {
      await attachVoiceDiagnostics(page, request, testInfo, diagnostics.get(page));
    }
    expect(pageErrors.get(page) || []).toEqual([]);
    expect((mutationOrigins.get(page) || []).every(value => value === origin)).toBe(true);
  });

  for (const width of [1440, 390]) {
    test(`HTTPS válido, micrófono disponible y navegación a ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto('/');
      await expect(page.locator('#onboard-modal')).toBeHidden();
      await expect(page.locator('#greeting')).toContainText('Ado E2E');
      expect(await page.evaluate(() => ({
        origin: location.origin, secure: isSecureContext,
        microphone: typeof navigator.mediaDevices?.getUserMedia,
      }))).toEqual({ origin, secure: true, microphone: 'function' });
      for (const view of ['home', 'companion', 'vocab', 'review', 'progress', 'settings', 'home']) {
        await navigate(page, view);
      }
      await screenshot(page, testInfo, `https-home-${width}`);
      await navigate(page, 'settings');
      await expect(page.locator('#voicevox-credit')).toBeVisible();
      await screenshot(page, testInfo, `https-settings-${width}`);
    });
  }

  test('Memoria: guardar, editar, cancelar olvido y olvidar con persistencia tras recarga', async ({ page, request }, testInfo) => {
    await page.goto('/');
    await openMemory(page);
    await page.locator('#memory-category').selectOption('planes');
    await page.locator('#memory-content').fill(manualPlan);
    const saved = responseFor(page, '/api/memory');
    await page.locator('#memory-save').click();
    const memory = await json(await saved);
    expect(memory.content).toBe(manualPlan);
    expect(memory.source).toBe('user');
    const row = page.locator(`[data-memory-id="${memory.id}"]`);
    await page.reload();
    await openMemory(page);
    await expect(row.locator('.memory-content')).toHaveText(manualPlan);
    await row.locator('.memory-edit').click();
    await expect(page.locator('#memory-content')).toHaveValue(manualPlan);
    await page.locator('#memory-content').fill(editedPlan);
    const updated = responseFor(page, `/api/memory/${memory.id}`, 'PUT');
    await page.locator('#memory-save').click();
    expect((await json(await updated)).content).toBe(editedPlan);
    await page.reload();
    await openMemory(page);
    await expect(row.locator('.memory-content')).toHaveText(editedPlan);
    await screenshot(page, testInfo, 'https-memory-edited');
    page.once('dialog', dialog => dialog.dismiss());
    await row.locator('.memory-forget').click();
    const retained = await json(await request.get('/api/memory'));
    expect(retained.memories.find(item => item.id === memory.id).content).toBe(editedPlan);
    page.once('dialog', dialog => dialog.accept());
    const forgotten = responseFor(page, `/api/memory/${memory.id}`, 'DELETE');
    await row.locator('.memory-forget').click();
    expect((await json(await forgotten)).ok).toBe(true);
    await expect(row).toHaveCount(0);
    await page.reload();
    await openMemory(page);
    await expect(row).toHaveCount(0);
    const remaining = await json(await request.get('/api/memory'));
    expect(remaining.memories.some(item => item.id === memory.id)).toBe(false);
    await screenshot(page, testInfo, 'https-memory-forgotten');
  });

  test('Codex real: SSE completo, corrección, reproducción WAV e informe persistido', async ({ page, request }, testInfo) => {
    await installPlaybackObserver(page);
    await page.goto('/');
    const started = responseFor(page, '/api/sessions');
    await page.locator('#card-free').click();
    const { session_id: sessionId } = await json(await started);
    await expect(page.locator('#messages .ai .act-trans')).toHaveCount(1);
    const streamed = responseFor(page, '/api/chat');
    const corrected = responseFor(page, '/api/correct');
    const sentence = '昨日、ラーメンを食べますでした。おいしいでした。';
    await page.locator('#chat-input').fill(sentence);
    await page.locator('#send-btn').click();
    const correction = await json(await corrected);
    expect(correction.has_errors).toBe(true);
    expect(correction.errors.length).toBeGreaterThan(0);
    await expect(page.locator('#messages .user .correction.fix')).toBeVisible();
    await expect(page.locator('#messages .ai .act-trans')).toHaveCount(2);
    const stream = await streamed;
    expect(stream.status()).toBe(200);
    expect(stream.headers()['content-type']).toContain('text/event-stream');
    const events = (await stream.text()).split('\n')
      .filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    expect(events.some(event => event.error)).toBe(false);
    expect(events.some(event => typeof event.delta === 'string' && event.delta.length > 0)).toBe(true);
    expect(events.at(-1).done).toBe(true);
    const audioResponse = page.waitForResponse(response => response.url().startsWith(`${origin}/api/tts?`));
    await page.locator('#messages .ai .act-play').last().click();
    const audio = await audioResponse;
    expect(audio.status()).toBe(200);
    expect(audio.headers()['content-type']).toContain('audio/wav');
    const wav = await audio.body();
    expect(wavSeconds(wav)).toBeGreaterThan(1);
    await expect.poll(() => page.evaluate(() => window.__tailnetPlayback.length)).toBe(1);
    const playback = await page.evaluate(() => window.__tailnetPlayback[0]);
    expect(playback.duration).toBeGreaterThan(1);
    expect(playback.paused).toBe(false);
    await expect(page.locator('#tts-status')).toBeHidden();
    await screenshot(page, testInfo, 'https-codex-conversation');
    const ended = responseFor(page, `/api/sessions/${sessionId}/end`);
    await page.locator('#end-session').click();
    const report = await json(await ended);
    expect(report.stats.turns).toBe(1);
    await expect(page.locator('#sum-close')).toBeVisible();
    await expect(page.locator('#summary-inner')).toContainText(report.summary);
    await screenshot(page, testInfo, 'https-codex-report');
    await page.locator('#sum-close').click();
    await page.reload();
    expect(await persistedSummary(request, sessionId)).toEqual(report);
    const history = await json(await request.get(`/api/sessions/${sessionId}/messages`));
    expect(history.messages.filter(message => message.role === 'user')).toHaveLength(1);
    expect(history.messages.find(message => message.role === 'user').text).toBe(sentence);
    expect(history.messages.filter(message => message.role === 'assistant')).toHaveLength(2);
    await testInfo.attach('https-text-results', {
      body: JSON.stringify({ sessionId, events, correction, history, report, playback,
        wav: { bytes: wav.length, seconds: wavSeconds(wav), sha256: createHash('sha256').update(wav).digest('hex') } }, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('https-japanese-reading.wav', { body: wav, contentType: 'audio/wav' });
  });

  test('GPT Live real: PCM japonés, WebRTC bidireccional, subtítulos, mute e informe persistido', async ({ page, request }, testInfo) => {
    diagnostics.set(page, await installVoiceDiagnostics(page, speech));
    await page.goto('/');
    await page.locator('#card-call').click();
    await expect(page.locator('#call-overlay')).toBeVisible();
    await expect.poll(() => page.evaluate(() => codexCall?.peer?.connectionState), { timeout: 90_000 }).toBe('connected');
    await expect.poll(() => page.evaluate(() =>
      window.__voiceDiagnostic.channel.some(event => event.type === 'session.started'),
    ), { timeout: 90_000 }).toBe(true);
    await expect.poll(() => diagnostics.get(page).websocket.some(event =>
      event.direction === 'sent' && event.type === 'ready',
    ), { timeout: 5000 }).toBe(true);
    const timeline = await page.evaluate(() => window.__voiceDiagnostic);
    const diagnostic = diagnostics.get(page);
    const started = timeline.channel.find(event => event.type === 'session.started');
    const ready = diagnostic.websocket.find(event => event.direction === 'sent' && event.type === 'ready');
    expect(diagnostic.startedAt + ready.elapsedMs).toBeGreaterThanOrEqual(timeline.startedAt + started.elapsedMs);
    const sessionId = await page.evaluate(() => state.session.session_id);
    await expect.poll(async () => {
      const history = await json(await request.get(`/api/sessions/${sessionId}/messages`));
      return history.messages.some(message => message.role === 'user' && /[ぁ-んァ-ン一-龯]/.test(message.text));
    }, { timeout: 90_000 }).toBe(true);
    await page.locator('#call-mute').click();
    await expect(page.locator('#call-mute')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => codexCall.stream.getAudioTracks()[0].enabled)).toBe(false);
    await expect.poll(async () => {
      const history = await json(await request.get(`/api/sessions/${sessionId}/messages`));
      const user = history.messages.find(message => message.role === 'user');
      return history.messages.some(message => message.role === 'assistant' && message.id > user.id);
    }, { timeout: 90_000 }).toBe(true);
    await expect.poll(async () => (await audioMetrics(page)).some(metric =>
      metric.type === 'inbound-rtp' && metric.totalAudioEnergy > 0,
    ), { timeout: 30_000 }).toBe(true);
    const metrics = await audioMetrics(page);
    expect(metrics.some(metric => metric.type === 'outbound-rtp' && metric.bytesSent > 0)).toBe(true);
    expect(metrics.some(metric => metric.type === 'media-source' && metric.totalAudioEnergy > 0)).toBe(true);
    await expect(page.locator('#call-caption')).not.toBeEmpty();
    await expect(page.locator('#call-cc')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#call-cc').click();
    await expect(page.locator('#call-overlay')).toHaveClass(/no-cc/);
    await expect(page.locator('#call-cc')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#call-cc').click();
    await expect(page.locator('#call-overlay')).not.toHaveClass(/no-cc/);
    await expect(page.locator('#call-cc')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#call-mute').click();
    await expect(page.locator('#call-mute')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => codexCall.stream.getAudioTracks()[0].enabled)).toBe(true);
    await screenshot(page, testInfo, 'https-gpt-live');
    const ended = responseFor(page, `/api/sessions/${sessionId}/end`);
    await page.locator('#call-hangup').click();
    const report = await json(await ended);
    await expect(page.locator('#call-overlay')).toBeHidden();
    await expect(page.locator('#sum-close')).toBeVisible();
    await expect(page.locator('#summary-inner')).toContainText(report.summary);
    expect(await page.evaluate(() => codexCall)).toBe(null);
    const history = await json(await request.get(`/api/sessions/${sessionId}/messages`));
    const user = history.messages.find(message => message.role === 'user');
    expect(user.text).toMatch(/[ラら][ーあ]?[メめ][ンん]|こんにちは|[アあ][ドど]/);
    expect(history.messages.some(message => message.role === 'assistant' && message.id > user.id && /[ぁ-んァ-ン一-龯]/.test(message.text))).toBe(true);
    expect(report.stats.turns).toBe(history.messages.filter(message => message.role === 'user').length);
    await screenshot(page, testInfo, 'https-gpt-live-report');
    await page.locator('#sum-close').click();
    await page.reload();
    expect(await persistedSummary(request, sessionId)).toEqual(report);
    await testInfo.attach('https-live-results', {
      body: JSON.stringify({ speech, sessionId, metrics, history, report }, null, 2),
      contentType: 'application/json',
    });
  });
});
