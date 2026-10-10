import { createHash } from 'node:crypto';
import { test, expect } from './runtime.mjs';

const enabled = process.env.KAIWA_E2E_TTS === '1';
const headers = JSON.parse(process.env.KAIWA_E2E_TTS_HEADERS || '{}');
test.use({ extraHTTPHeaders: headers });
const sample = 'こんにちは。日本語を練習しています。';

function duration(wav) {
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  let byteRate;
  let dataLength;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const chunk = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (chunk === 'fmt ') byteRate = wav.readUInt32LE(offset + 16);
    if (chunk === 'data') dataLength = size;
    offset += 8 + size + size % 2;
  }
  expect(byteRate).toBeGreaterThan(0);
  expect(dataLength).toBeGreaterThan(0);
  return dataLength / byteRate;
}

async function voiceId(request) {
  const response = await request.get('/api/voices');
  expect(response.status()).toBe(200);
  const catalogue = await response.json();
  const voice = catalogue.voices.find(candidate => candidate.id === 'vv:8') ||
    catalogue.voices.find(candidate => candidate.engine === 'VOICEVOX');
  expect(voice, 'El contenedor Linux necesita un motor VOICEVOX real disponible.').toBeTruthy();
  return voice.id;
}

async function wav(request, voice, speed = 1) {
  const response = await request.get('/api/tts', { params: { text: sample, voice, speed, intonation: 1 } });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('audio/wav');
  return response.body();
}

async function syntheticUi(page, voice) {
  const profile = {
    name: 'TTS E2E', jlpt_level: 'N5', interests: 'música sintética', goals: 'Prueba aislada de lectura',
    settings: { provider: 'codex', voice, speed: 1, intonation: 1, auto_play: false },
  };
  const dashboard = {
    streak: 0, total_minutes: 0, sessions_count: 0, messages_spoken: 0,
    words_saved: 1, mistakes_logged: 0, srs_due: 0, recent_sessions: [], mistake_categories: [],
  };
  for (const [path, json] of [
    ['profile', profile], ['dashboard', dashboard], ['srs/due', { due: [] }],
    ['health', { provider: 'codex', llm_ready: false, whisper: false }],
    ['providers', { active: 'codex', providers: [{ id: 'codex', label: 'Suscripción de ChatGPT', models: ['gpt-6-luna'] }] }],
    ['codex/status', { installed: true, logged_in: false, ready: false }],
    ['backup/status', { freq: 'off', last: null, dir: '/synthetic/backups' }],
    ['setup/phone', { installed: false, running: false }],
    ['vocab', { vocab: [{ id: 1, word: sample, reading: '', meaning: 'Frase sintética E2E', example: '' }] }],
  ]) await page.route(`**/api/${path}`, route => route.fulfill({ json }));
  await page.addInitScript(() => {
    window.speechPlayback = [];
    const NativeAudio = window.Audio;
    window.Audio = function(...args) {
      const audio = new NativeAudio(...args);
      audio.addEventListener('playing', () => window.speechPlayback.push({ duration: audio.duration, source: audio.src }));
      return audio;
    };
  });
  await page.goto('/');
  await expect(page.locator('#greeting')).toContainText('TTS E2E');
}

test.describe('Lectura japonesa real en el despliegue Linux', () => {
  test.skip(!enabled, 'Requiere KAIWA_E2E_TTS=1, servidor aislado y servicio VOICEVOX real.');

  test('VOICEVOX genera WAV, lectura lenta más larga y conserva audio repetido', async ({ request }, testInfo) => {
    const voice = await voiceId(request);
    const normal = await wav(request, voice);
    const slow = await wav(request, voice, 0.7);
    const cached = await wav(request, voice);
    const normalSeconds = duration(normal);
    const slowSeconds = duration(slow);
    expect(normalSeconds).toBeGreaterThan(1);
    expect(slowSeconds).toBeGreaterThan(normalSeconds * 1.2);
    expect(cached.equals(normal)).toBe(true);
    const evidence = { voice, normalSeconds, slowSeconds, bytes: normal.length, sha256: createHash('sha256').update(normal).digest('hex') };
    await testInfo.attach('voicevox-real-speech.wav', { body: normal, contentType: 'audio/wav' });
    await testInfo.attach('speech-result.json', { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
  });

  test('Perfil migrado con say:Kyoko reproduce japonés sin ejecutables macOS', async ({ request }, testInfo) => {
    const hardware = await request.get('/api/setup/hardware');
    expect(hardware.status()).toBe(200);
    expect((await hardware.json()).system, 'Este recorrido debe verificar el backend Linux real.').toBe('Linux');
    await voiceId(request);
    const response = await wav(request, 'say:Kyoko');
    expect(duration(response)).toBeGreaterThan(1);
    await testInfo.attach('migrated-profile-speech.wav', { body: response, contentType: 'audio/wav' });
  });

  test('Entrada inválida y error del motor devuelven errores explícitos', async ({ request }) => {
    for (const params of [{ text: '***' }, { text: sample, voice: 'unsupported' }, { text: sample, speed: 0 }]) {
      const response = await request.get('/api/tts', { params });
      expect(response.status()).toBe(422);
      expect((await response.json()).error).toBeTruthy();
    }
    const response = await request.get('/api/tts', { params: { text: sample, voice: 'vv:999999' } });
    expect(response.status()).toBe(503);
    expect((await response.json()).error).toContain('voz japonesa');
  });

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    test(`Escuchar y muestra de voz reproducen audio real, ${viewport.width}px`, async ({ page, request }, testInfo) => {
      const voice = await voiceId(request);
      await page.setViewportSize(viewport);
      await syntheticUi(page, voice);
      await page.locator('.nav-btn[data-view="vocab"]').click();
      await page.getByTitle('Escuchar', { exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.speechPlayback.length)).toBe(1);
      await page.locator('.nav-btn[data-view="settings"]').click();
      await expect(page.locator('#voicevox-credit')).toBeVisible();
      await page.locator('#voice-preview').click();
      await expect.poll(() => page.evaluate(() => window.speechPlayback.length)).toBe(2);
      await expect(page.locator('#tts-status')).toBeHidden();
      const playback = await page.evaluate(() => window.speechPlayback);
      expect(playback.every(item => item.duration > 1)).toBe(true);
      await testInfo.attach('browser-playback.json', { body: Buffer.from(JSON.stringify(playback, null, 2)), contentType: 'application/json' });
      await testInfo.attach('tts-settings.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }

  test('La lectura fallida se muestra y Reintentar recupera el audio real', async ({ page, request }) => {
    const voice = await voiceId(request);
    await syntheticUi(page, voice);
    await page.route('**/api/tts?*', route => route.fulfill({ status: 503, json: { error: 'Motor de voz japonés no disponible: prueba sintética.' } }));
    await page.locator('.nav-btn[data-view="vocab"]').click();
    await page.getByTitle('Escuchar', { exact: true }).click();
    await expect(page.locator('#tts-status')).toContainText('Motor de voz japonés no disponible');
    expect(await page.evaluate(() => window.speechPlayback.length)).toBe(0);
    await page.unroute('**/api/tts?*');
    await page.getByRole('button', { name: 'Reintentar lectura' }).click();
    await expect.poll(() => page.evaluate(() => window.speechPlayback.length)).toBe(1);
    await expect(page.locator('#tts-status')).toBeHidden();
  });

  for (const mode of ['lectura', 'muestra']) {
    test(`El navegador bloquea ${mode}: libera su Blob URL y Reintentar reproduce audio real`, async ({ page, request }, testInfo) => {
      const voice = await voiceId(request);
      await page.addInitScript(() => {
        window.speechUrls = { created: [], revoked: [], rejected: 0 };
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => {
          const source = create(blob);
          window.speechUrls.created.push(source);
          return source;
        };
        URL.revokeObjectURL = source => {
          window.speechUrls.revoked.push(source);
          revoke(source);
        };
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function(...args) {
          if (!window.speechUrls.rejected) {
            window.speechUrls.rejected += 1;
            return Promise.reject(new DOMException('Reproducción bloqueada: prueba sintética.', 'NotAllowedError'));
          }
          return play.apply(this, args);
        };
      });
      await syntheticUi(page, voice);
      if (mode === 'lectura') {
        await page.locator('.nav-btn[data-view="vocab"]').click();
        await page.getByTitle('Escuchar', { exact: true }).click();
      } else {
        await page.locator('.nav-btn[data-view="settings"]').click();
        await page.locator('#voice-preview').click();
      }
      await expect(page.locator('#tts-status')).toBeVisible();
      const rejected = await page.evaluate(() => window.speechUrls);
      expect(rejected.rejected).toBe(1);
      expect(rejected.created).toHaveLength(1);
      expect(rejected.revoked).toContain(rejected.created[0]);
      expect(await page.evaluate(() => window.speechPlayback.length)).toBe(0);
      await page.getByRole('button', { name: 'Reintentar lectura' }).click();
      await expect.poll(() => page.evaluate(() => window.speechPlayback.length)).toBe(1);
      await expect(page.locator('#tts-status')).toBeHidden();
      const recovered = await page.evaluate(() => ({ urls: window.speechUrls, playback: window.speechPlayback }));
      expect(recovered.urls.created).toHaveLength(2);
      expect(recovered.urls.created[1]).not.toBe(rejected.created[0]);
      expect(recovered.playback[0].duration).toBeGreaterThan(1);
      await testInfo.attach('autoplay-rejection-recovery.json', {
        body: Buffer.from(JSON.stringify({ mode, ...recovered }, null, 2)), contentType: 'application/json',
      });
    });
  }
});
