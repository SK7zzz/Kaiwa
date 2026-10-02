import { test, expect } from './runtime.mjs';
import { makeSpeechFixture } from './speech-fixture.mjs';
import { installVoiceDiagnostics, attachVoiceDiagnostics } from './voice-diagnostics.mjs';

const speech = makeSpeechFixture();
const diagnostics = new WeakMap();

test.beforeEach(async ({ page }) => {
  diagnostics.set(page, await installVoiceDiagnostics(page, speech));
});

test.afterEach(async ({ page, request }, testInfo) => {
  await attachVoiceDiagnostics(page, request, testInfo, diagnostics.get(page));
});

async function requireSyntheticProfile(request) {
  const response = await request.get('/api/profile');
  expect(response.ok()).toBe(true);
  const profile = await response.json();
  expect(profile.name, 'Las pruebas de voz requieren el perfil sintético aislado.').toBe('Ado E2E');
  expect(profile.goals).toContain('Datos sintéticos E2E');
  expect(profile.settings.provider).toBe('codex');
}

test.use({
    permissions: ['microphone'],
    launchOptions: { args: [
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${speech.path}%noloop`,
    ] },
});

test.describe('GPT Live con suscripción', () => {
  test('Voz japonesa de entrada y salida reales, transcripción, mute, subtítulos y cierre persistente', async ({ page, request }, testInfo) => {
    await requireSyntheticProfile(request);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#onboard-modal')).toBeHidden();
    await page.locator('#card-call').click();
    await expect(page.locator('#call-overlay')).toBeVisible();
    await test.step('La llamada protege el foco y expone los estados de sus controles', async () => {
      await expect(page.locator('#call-overlay')).toHaveAttribute('role', 'dialog', { timeout: 15_000 });
      await expect(page.locator('#call-overlay')).toHaveAttribute('aria-modal', 'true', { timeout: 15_000 });
      await expect(page.locator('#call-mute')).toBeFocused({ timeout: 15_000 });
      expect(await page.locator('#app').evaluate(app => app.inert)).toBe(true);
      await expect(page.locator('#call-mute')).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
      await expect(page.locator('#call-cc')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#call-cc')).toBeFocused({ timeout: 15_000 });
      await page.keyboard.press('Tab');
      await expect(page.locator('#call-mute')).toBeFocused({ timeout: 15_000 });
    });
    await expect.poll(() => page.evaluate(() => codexCall?.peer?.connectionState), { timeout: 90_000 }).toBe('connected');
    await test.step('La sesión remota está iniciada antes de comenzar el tutor', async () => {
      await expect.poll(() => page.evaluate(() =>
        window.__voiceDiagnostic.channel.some(event => event.type === 'session.started'),
      ), { timeout: 90_000 }).toBe(true);
      await expect.poll(() => diagnostics.get(page).websocket.some(event =>
        event.direction === 'sent' && event.type === 'ready',
      ), { timeout: 5000 }).toBe(true);
      const timeline = await page.evaluate(() => window.__voiceDiagnostic);
      const diagnostic = diagnostics.get(page);
      const sessionStarted = timeline.channel.find(event => event.type === 'session.started');
      const ready = diagnostic.websocket.find(event => event.direction === 'sent' && event.type === 'ready');
      expect(ready, 'El cliente debe enviar ready después de recibir session.started.').toBeDefined();
      const sessionStartedAt = timeline.startedAt + sessionStarted.elapsedMs;
      const readyAt = diagnostic.startedAt + ready.elapsedMs;
      expect(readyAt, 'ready no puede iniciar el tutor antes de la sesión remota.').toBeGreaterThanOrEqual(sessionStartedAt);
    });
    const sessionId = await page.evaluate(() => state.session.session_id);
    await expect.poll(async () => {
      const response = await request.get(`/api/sessions/${sessionId}/messages`);
      const body = await response.json();
      return body.messages.some(message => message.role === 'user' && /[ぁ-んァ-ン一-龯]/.test(message.text));
    }, { timeout: 90_000 }).toBe(true);
    await page.locator('#call-mute').click();
    await expect(page.locator('#call-mute')).toHaveClass(/muted-on/);
    await expect(page.locator('#call-mute')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    expect(await page.evaluate(() => codexCall.stream.getAudioTracks()[0].enabled)).toBe(false);
    await expect.poll(async () => {
      const response = await request.get(`/api/sessions/${sessionId}/messages`);
      const body = await response.json();
      const user = body.messages.find(message => message.role === 'user');
      return body.messages.filter(message => message.role === 'assistant' && message.id > user.id).length;
    }, { timeout: 90_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(async () => {
      const reports = await codexCall.peer.getStats();
      return [...reports.values()].filter(report => report.type === 'inbound-rtp' && report.kind === 'audio')
        .reduce((total, report) => total + (report.totalAudioEnergy || 0), 0);
    }), { timeout: 30_000 }).toBeGreaterThan(0);
    const metrics = await page.evaluate(async () => {
      const reports = await codexCall.peer.getStats();
      return [...reports.values()].filter(report => report.kind === 'audio' && ['inbound-rtp', 'outbound-rtp', 'media-source'].includes(report.type))
        .map(({ type, bytesReceived, bytesSent, packetsReceived, packetsSent, totalAudioEnergy }) =>
          ({ type, bytesReceived, bytesSent, packetsReceived, packetsSent, totalAudioEnergy }));
    });
    expect(metrics.some(metric => metric.type === 'outbound-rtp' && metric.bytesSent > 0)).toBe(true);
    expect(metrics.some(metric => metric.type === 'media-source' && metric.totalAudioEnergy > 0)).toBe(true);
    await expect(page.locator('#call-caption')).not.toBeEmpty();
    await page.locator('#call-cc').click();
    await expect(page.locator('#call-overlay')).toHaveClass(/no-cc/);
    await expect(page.locator('#call-cc')).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
    await page.locator('#call-cc').click();
    await expect(page.locator('#call-overlay')).not.toHaveClass(/no-cc/);
    await expect(page.locator('#call-cc')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await page.locator('#call-mute').click();
    await expect(page.locator('#call-mute')).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
    expect(await page.evaluate(() => codexCall.stream.getAudioTracks()[0].enabled)).toBe(true);
    const shot = testInfo.outputPath('live-voice.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('live-voice', { path: shot, contentType: 'image/png' });
    await page.locator('#call-hangup').click();
    await expect(page.locator('#call-overlay')).toBeHidden();
    await expect(page.locator('#summary-modal')).toBeVisible();
    await expect(page.locator('#sum-close')).toBeVisible();
    const history = await (await request.get(`/api/sessions/${sessionId}/messages`)).json();
    await testInfo.attach('voice-evidence', { body: JSON.stringify({ speech, metrics, messages: history.messages }, null, 2), contentType: 'application/json' });
    expect(history.messages.some(message => message.role === 'assistant' && /[ぁ-んァ-ン一-龯]/.test(message.text))).toBe(true);
    const user = history.messages.find(message => message.role === 'user');
    expect(user.text).toMatch(/[ラら][ーあ]?[メめ][ンん]|こんにちは|[アあ][ドど]/);
    expect(history.messages.some(message => message.role === 'assistant' && message.id > user.id)).toBe(true);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => codexCall)).toBe(null);
  });
});

test('Micrófono denegado muestra acción y permite cerrar sin crear sesión', async ({ page, request }, testInfo) => {
  await requireSyntheticProfile(request);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await expect(page.locator('#onboard-modal')).toBeHidden();
  await page.locator('#card-call').click();
  await expect(page.locator('#call-caption')).toContainText('Permite el micrófono');
  expect(await page.evaluate(() => state.session)).toBe(null);
  const shot = testInfo.outputPath('microphone-denied.png');
  await page.screenshot({ path: shot });
  await testInfo.attach('microphone-denied', { path: shot, contentType: 'image/png' });
  await page.locator('#call-hangup').click();
  await expect(page.locator('#call-overlay')).toBeHidden();
  expect(await page.locator('#app').evaluate(app => app.inert)).toBe(false);
  await expect(page.locator('#card-call')).toBeFocused({ timeout: 15_000 });
});
