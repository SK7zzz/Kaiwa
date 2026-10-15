import { test, expect as baseExpect } from './runtime.mjs';

const expect = baseExpect.configure({ timeout: 15_000 });
const views = ['home', 'companion', 'review', 'vocab', 'dict', 'progress', 'settings'];
const japaneseReply = '日本語を練習しましょう。Nebula Prisma E2E';
const dashboard = {
  streak: 0, total_minutes: 0, sessions_count: 0, messages_spoken: 0,
  words_saved: 0, mistakes_logged: 0, srs_due: 0, recent_sessions: [], mistake_categories: [],
};

async function syntheticUi(page) {
  const profile = {
    id: 1, name: 'Amadeus E2E', jlpt_level: 'N5', interests: 'Datos sintéticos: ciencia y música',
    goals: 'Datos sintéticos E2E del tema Amadeus',
    settings: { provider: 'codex', auto_play: false, auto_translate: false, furigana: true, romaji: false },
  };
  const evidence = { errors: [], mutations: [], blocked: [] };
  page.on('pageerror', error => evidence.errors.push(error.message));
  const replies = {
    '/api/health': { provider: 'codex', provider_label: 'Suscripción sintética', llm_ready: true, whisper: false },
    '/api/codex/status': { installed: true, logged_in: true, ready: true, message: 'Conexión sintética preparada.' },
    '/api/providers': { active: 'codex', providers: [{ id: 'codex', label: 'Suscripción sintética', needs_key: false, has_key: false, model: 'gpt-6-luna', models: ['gpt-6-luna'] }] },
    '/api/voices': { voices: [], default: '' },
    '/api/vocab': { vocab: [] }, '/api/srs/due': { due: [] }, '/api/dashboard': dashboard,
    '/api/memory': { memories: [], message_count: 2 },
    '/api/companion': { messages: [
      { id: 1, role: 'user', text: 'Datos sintéticos: quiero practicar con música.', ts: 1700000000 },
      { id: 2, role: 'assistant', text: `こんにちは。${japaneseReply}`, ts: 1700000001 },
    ] },
    '/api/backup/status': { freq: 'off', dir: '/synthetic/amadeus/backups', last: null },
    '/api/setup/phone': { installed: false, running: false },
  };
  const writes = {
    '/api/profile': body => { Object.assign(profile, body); return profile; },
    '/api/settings': body => { Object.assign(profile.settings, body); return profile.settings; },
    '/api/sessions': () => ({ session_id: 9971, scenario: null }),
    '/api/correct': () => ({ has_errors: false, errors: [] }),
  };
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      if (pathname === '/api/profile') return route.fulfill({ json: profile });
      if (pathname in replies) return route.fulfill({ json: replies[pathname] });
      return route.continue();
    }
    evidence.mutations.push(pathname);
    if (pathname === '/api/chat') return route.fulfill({ contentType: 'text/event-stream', body: chatEvents() });
    if (pathname in writes) return route.fulfill({ json: writes[pathname](route.request().postDataJSON()) });
    evidence.blocked.push(pathname);
    return route.fulfill({ status: 503, json: { error: 'Mutación fuera del recorrido sintético.' } });
  });
  return evidence;
}

function chatEvents() {
  const events = [
    { delta: japaneseReply },
    { done: true, message_id: 9972, romaji: '', tokens: [
      { surface: '日本語', word: true, ruby: [{ t: '日本語', r: 'にほんご' }] },
      { surface: 'を練習しましょう。Nebula Prisma E2E', word: false, ruby: [{ t: 'を練習しましょう。Nebula Prisma E2E', r: '' }] },
    ] },
  ];
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}

function rgba(color) {
  const channels = color.match(/[\d.]+/g)?.map(Number);
  if (!color.startsWith('rgb') || !channels || channels.length < 3) throw new Error(`Color computado no soportado: ${color}`);
  return [...channels.slice(0, 3), channels[3] ?? 1];
}

function composite(foreground, background) {
  return foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]));
}

function luminance(color) {
  const linear = color.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

async function contrastSample(locator, pseudo = null) {
  const sample = await locator.evaluate((element, pseudoElement) => {
    const style = getComputedStyle(element, pseudoElement);
    const backgrounds = [];
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) backgrounds.unshift(getComputedStyle(ancestor).backgroundColor);
    return { color: style.color, backgrounds, opacity: style.opacity, fontSize: style.fontSize,
      lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textTransform: style.textTransform };
  }, pseudo);
  const background = sample.backgrounds.reduce((painted, color) => composite(rgba(color), painted), [255, 255, 255]);
  const foreground = rgba(sample.color);
  if (pseudo) foreground[3] *= Number(sample.opacity);
  const foregroundLuminance = luminance(composite(foreground, background));
  const backgroundLuminance = luminance(background);
  return { ...sample, background, ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05) };
}

async function readable(locator, label, pseudo = null) {
  await expect(locator).toBeVisible();
  const sample = await contrastSample(locator, pseudo);
  expect(sample.ratio, `Contraste de ${label}: ${JSON.stringify(sample)}`).toBeGreaterThanOrEqual(4.5);
  return { label, ...sample };
}

async function navigate(page, view) {
  const button = page.locator(`.nav-btn[data-view="${view}"]`);
  await button.click();
  await expect(page.locator(`#view-${view}`)).toBeVisible();
  await expect(page.locator(`#view-${view}`)).not.toHaveAttribute('aria-busy', 'true');
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.nav-btn[aria-current="page"]')).toHaveCount(1);
}

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function layout(page, name) {
  const metrics = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    mainWidth: document.querySelector('#main').clientWidth, mainContent: document.querySelector('#main').scrollWidth,
    views: [...document.querySelectorAll('.view:not(.hidden)')].map(view => view.id),
    navigation: [...document.querySelectorAll('.nav-btn')].map(button => {
      const rect = button.getBoundingClientRect();
      return { view: button.dataset.view, left: rect.left, right: rect.right, height: rect.height };
    }),
  }));
  expect(metrics.document, name).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.mainContent, `${name}: #main`).toBeLessThanOrEqual(metrics.mainWidth + 1);
  expect(metrics.views).toHaveLength(1);
  for (const button of metrics.navigation) {
    expect(button.left, `${name}: ${button.view}`).toBeGreaterThanOrEqual(-1);
    expect(button.right, `${name}: ${button.view}`).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(button.height, `${name}: ${button.view}`).toBeGreaterThanOrEqual(44);
  }
  return { name, ...metrics };
}

async function portrait(page, scope) {
  const image = page.locator(`${scope} img.amadeus-portrait`).first();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('alt', /kurisu|makise|amadeus/i);
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth >= 200 && node.naturalHeight >= 200)).toBe(true);
  const bounds = await image.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  return { source: await image.getAttribute('src'), ...bounds };
}

async function darkAmberTheme(page) {
  const body = await contrastSample(page.locator('body'));
  expect(luminance(body.background), 'El fondo visible debe ser oscuro.').toBeLessThan(0.08);
  const primary = page.locator('#hero-practice');
  const colors = await primary.evaluate(button => {
    const style = getComputedStyle(button);
    return [style.backgroundColor, style.color, style.borderTopColor];
  });
  expect(colors.some(color => {
    const [red, green, blue, alpha] = rgba(color);
    return alpha > 0.5 && red >= green && red - blue > 35 && green - blue > 20;
  }), `CTA sin acento ámbar visible: ${colors.join(', ')}`).toBe(true);
  return { body, primary: await readable(primary, 'CTA principal'), colors };
}

async function japaneseComposer(page) {
  await page.locator('#card-free').click();
  await expect(page.locator('#messages .ai .act-trans')).toBeVisible();
  const bubble = page.locator('#messages .ai .bubble').first();
  const plain = await bubble.evaluate(element => {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('rt').forEach(reading => reading.remove());
    return clone.textContent.trim();
  });
  expect(plain).toBe(japaneseReply);
  const sample = await readable(bubble, 'japonés con furigana');
  expect(parseFloat(sample.fontSize)).toBeGreaterThanOrEqual(16);
  expect(parseFloat(sample.lineHeight)).toBeGreaterThanOrEqual(parseFloat(sample.fontSize) * 1.4);
  expect(sample.textTransform).toBe('none');
  expect(parseFloat(sample.letterSpacing) || 0).toBeLessThanOrEqual(parseFloat(sample.fontSize) * 0.04);
  const input = page.locator('#chat-input');
  const placeholder = await readable(input, 'placeholder del compositor', '::placeholder');
  await input.fill('こんにちは。音楽が好きです。');
  await expect(input).toHaveValue('こんにちは。音楽が好きです。');
  const typed = await readable(input, 'texto escrito en el compositor');
  expect(parseFloat(typed.fontSize)).toBeGreaterThanOrEqual(16);
  await input.press('Enter');
  await expect(page.locator('#messages .user .bubble')).toHaveText('こんにちは。音楽が好きです。');
  await expect(page.locator('#messages .ai .act-trans')).toHaveCount(2);
  const user = await readable(page.locator('#messages .user .bubble'), 'mensaje del alumno');
  const composer = await input.boundingBox();
  expect(composer.width).toBeGreaterThanOrEqual(100);
  expect(composer.height).toBeGreaterThanOrEqual(44);
  return { assistant: sample, placeholder, typed, user, composer };
}

for (const width of [1440, 390, 320]) {
  test(`Amadeus ${width}px: siete vistas, retrato real, contraste oscuro/ámbar y japonés utilizable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const evidence = await syntheticUi(page);
    await page.goto('/');
    await expect(page.locator('#greeting')).toContainText('Amadeus E2E');
    const theme = await darkAmberTheme(page);
    const metrics = [];
    const samples = [];
    const characters = [];
    for (const view of views) {
      await navigate(page, view);
      samples.push(await readable(page.locator(`.nav-btn[data-view="${view}"]`), `navegación ${view}`));
      if (view === 'home') {
        characters.push(await portrait(page, '#view-home'));
        samples.push(await readable(page.locator('#home-sub'), 'introducción de Inicio'));
      }
      if (view === 'companion') {
        characters.push(await portrait(page, '#view-companion'));
        samples.push(await readable(page.locator('.companion-message.assistant .companion-text'), 'texto del asistente'));
        samples.push(await readable(page.locator('#companion-input'), 'placeholder del asistente', '::placeholder'));
      }
      if (view === 'vocab') await expect(page.locator('#vocab-list .empty-state')).toBeVisible();
      if (view === 'review') await expect(page.locator('.review-done')).toBeVisible();
      if (view === 'settings') samples.push(await readable(page.locator('#set-name'), 'campo de Ajustes'));
      metrics.push(await layout(page, `${width}-${view}`));
      await screenshot(page, testInfo, `amadeus-${width}-${view}`);
    }
    await navigate(page, 'home');
    const chat = await japaneseComposer(page);
    metrics.push(await layout(page, `${width}-chat`));
    await screenshot(page, testInfo, `amadeus-${width}-japanese-chat`);
    expect(evidence.errors).toEqual([]);
    expect(evidence.blocked).toEqual([]);
    expect(evidence.mutations.filter(path => path === '/api/sessions')).toHaveLength(1);
    await testInfo.attach('amadeus-theme-layout-contrast', { body: JSON.stringify({ theme, characters, samples, metrics, chat, evidence }, null, 2), contentType: 'application/json' });
  });
}

test('Amadeus: carga, error 503 y recuperación vacía conservan contraste y acciones en móvil', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const evidence = await syntheticUi(page);
  let release;
  let attempt = 0;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/vocab', async route => {
    attempt++;
    if (attempt !== 1) return route.fulfill({ json: { vocab: [] } });
    await pending;
    return route.fulfill({ status: 503, json: { error: 'Error sintético Amadeus: vocabulario no disponible.' } });
  });
  await page.goto('/');
  await page.locator('.nav-btn[data-view="vocab"]').click();
  await expect(page.locator('#view-vocab')).toHaveAttribute('aria-busy', 'true');
  const status = page.locator('#view-vocab .view-status');
  const loading = await readable(status, 'estado de carga');
  await screenshot(page, testInfo, 'amadeus-mobile-loading');
  release();
  await expect(status).toHaveClass(/error/);
  const error = await readable(status.locator('p'), 'estado de error');
  const retry = page.locator('[data-retry-view="vocab"]');
  await expect(retry).toBeEnabled();
  await screenshot(page, testInfo, 'amadeus-mobile-error');
  await retry.click();
  await expect(status).toBeHidden();
  await expect(page.locator('#view-vocab')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#vocab-list [data-action="practice"]')).toBeVisible();
  await page.locator('#vocab-list [data-action="practice"]').click();
  await expect(page.locator('#view-home')).toBeVisible();
  expect(attempt).toBe(2);
  expect(evidence.errors).toEqual([]);
  expect(evidence.mutations).toEqual([]);
  await testInfo.attach('amadeus-state-contrast', { body: JSON.stringify({ loading, error }, null, 2), contentType: 'application/json' });
});

test('Amadeus: movimiento reducido, diálogo de teclado y retrato de voz sin iniciar IA', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
  });
  const evidence = await syntheticUi(page);
  await page.goto('/');
  await page.locator('#card-custom').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#custom-modal')).toBeVisible();
  await expect(page.locator('#cr-title')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#cr-start')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#custom-modal')).toBeHidden();
  await expect(page.locator('#card-custom')).toBeFocused();
  await page.locator('#card-call').click();
  await expect(page.locator('#call-overlay')).toBeVisible();
  await expect(page.locator('#call-mute')).toBeFocused();
  expect(await page.locator('#app').evaluate(app => app.inert)).toBe(true);
  const character = await portrait(page, '#call-avatar');
  const status = await readable(page.locator('#call-status'), 'estado de voz');
  const animations = await page.evaluate(() => document.getAnimations().map(animation => ({
    state: animation.playState, duration: animation.effect?.getComputedTiming().duration,
    target: animation.effect?.target?.id || animation.effect?.target?.className || '',
  })));
  expect(animations.filter(animation => animation.state === 'running' && Number(animation.duration) > 20)).toEqual([]);
  await screenshot(page, testInfo, 'amadeus-mobile-voice-reduced-motion');
  await page.keyboard.press('Escape');
  await expect(page.locator('#call-overlay')).toBeHidden();
  await expect(page.locator('#card-call')).toBeFocused();
  expect(await page.locator('#app').evaluate(app => app.inert)).toBe(false);
  expect(evidence.errors).toEqual([]);
  expect(evidence.mutations).toEqual([]);
  await testInfo.attach('amadeus-motion-voice', { body: JSON.stringify({ character, status, animations, evidence }, null, 2), contentType: 'application/json' });
});
