import { test, expect, devices } from './runtime.mjs';

const syntheticProfile = {
  name: 'Ado E2E',
  jlpt_level: 'N5',
  interests: 'programación, videojuegos y ramen',
  goals: 'Datos sintéticos E2E: practicar japonés cotidiano N5',
};
const nonexistentId = 2147483647;

async function json(response) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function navigate(page, view) {
  await page.locator(`.nav-btn[data-view="${view}"]`).click();
  await expect(page.locator(`#view-${view}`)).toBeVisible();
}

async function noHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
}

async function persistSettings(request) {
  await json(await request.post('/api/settings', {
    data: { provider: 'codex', auto_play: false, auto_translate: false },
  }));
  await json(await request.put('/api/profile', { data: syntheticProfile }));
}

async function checkCleanTestDatabase(request) {
  const profile = await json(await request.get('/api/profile'));
  expect(profile.name, 'El recorrido necesita una base aislada nueva, nunca el perfil real.').toBe('');
  const vocab = await json(await request.get('/api/vocab'));
  expect(vocab.vocab).toEqual([]);
}

async function onboard(page, request) {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('#onboard-modal')).toBeVisible();
  await expect(page.locator('#ob-step-profile')).toBeVisible();
  await page.locator('#ob-name').fill(syntheticProfile.name);
  await page.locator('#ob-level [data-l="N5"]').click();
  await page.locator('#ob-interests').fill(syntheticProfile.interests);
  await page.locator('#ob-goals').fill(syntheticProfile.goals);
  await page.locator('#ob-start').click();
  await expect(page.locator('#onboard-modal')).toBeHidden();
  const profile = await json(await request.get('/api/profile'));
  expect(profile.name).toBe(syntheticProfile.name);
  expect(profile.jlpt_level).toBe('N5');
  await persistSettings(request);
  await page.reload();
  await expect(page.locator('#greeting')).toContainText(syntheticProfile.name);
}

async function collectFailures(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function beginRealConversation(page, request) {
  const sessionResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
  await page.locator('#card-free').click();
  const session = await json(await sessionResponse);
  await expect(page.locator('#messages .ai .act-trans').first()).toBeVisible();
  const messages = await json(await request.get(`/api/sessions/${session.session_id}/messages`));
  expect(messages.messages.some(message => message.role === 'assistant' && /[ぁ-んァ-ン一-龯]/.test(message.text))).toBe(true);
  return session.session_id;
}

async function submitMistake(page) {
  const correctionResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/correct') && response.request().method() === 'POST');
  const sentence = '昨日、ラーメンを食べますでした。おいしいでした。';
  await page.locator('#chat-input').fill(sentence);
  await page.locator('#send-btn').click();
  await expect(page.locator('#messages .user').last()).toContainText(sentence);
  const correction = await json(await correctionResponse);
  expect(correction.has_errors).toBe(true);
  expect(correction.errors.length).toBeGreaterThan(0);
  expect(correction.errors[0].explanation.length).toBeGreaterThan(5);
  expect(correction.errors[0].explanation).toMatch(/\b(el|la|los|las|una|un|de|para|forma|pasado|porque|verbo|tiempo)\b/i);
  await expect(page.locator('#messages .user .correction.fix')).toBeVisible();
  await expect(page.locator('#messages .ai .act-trans')).toHaveCount(2);
  return correction;
}

async function translateAndSuggest(page) {
  const translationResponse = page.waitForResponse(response => response.url().endsWith('/api/translate'));
  await page.locator('#messages .ai .act-trans').last().click();
  const translation = await json(await translationResponse);
  expect(translation.translation.length).toBeGreaterThan(5);
  expect(translation.translation).toMatch(/\b(el|la|los|las|una|un|de|que|te|tu|qué|cómo|has|ayer|comiste)\b/i);
  await expect(page.locator('#messages .ai .trans-line').last()).toHaveText(translation.translation);
  const hintResponse = page.waitForResponse(response => response.url().endsWith('/api/hint'));
  await page.locator('#hint-btn').click();
  const hints = await json(await hintResponse);
  expect(hints.suggestions.length).toBeGreaterThan(0);
  const suggestion = page.locator('#hints .hint-card[data-t]').first();
  await expect(suggestion).toBeVisible();
  const japanese = await suggestion.getAttribute('data-t');
  await suggestion.click();
  await expect(page.locator('#chat-input')).toHaveValue(japanese);
  await page.locator('#chat-input').fill('');
  return { translation: translation.translation, suggestions: hints.suggestions };
}

async function saveWord(page, request) {
  const token = page.locator('#messages .ai .tok').first();
  await expect(token).toBeVisible();
  await token.click();
  await expect(page.locator('#pop-save')).toBeVisible();
  await expect(page.locator('#word-pop-inner .m')).not.toBeEmpty();
  await page.locator('#pop-save').click();
  await expect(page.locator('#pop-save')).toBeDisabled();
  const words = (await json(await request.get('/api/vocab'))).vocab;
  expect(words).toHaveLength(1);
  await json(await request.post('/api/vocab', { data: words[0] }));
  expect((await json(await request.get('/api/vocab'))).vocab).toHaveLength(1);
  await page.locator('#word-pop').click({ position: { x: 1, y: 1 } });
  await expect(page.locator('#word-pop')).toBeHidden();
  await navigate(page, 'vocab');
  await expect(page.locator('.vocab-item')).toHaveCount(1);
  await expect(page.locator('.vocab-item .w')).toHaveText(words[0].word);
  return words[0];
}

async function reviewWord(page, request, word) {
  await navigate(page, 'review');
  await expect(page.locator('#fc .big-word')).toHaveText(word.word);
  await expect(page.locator('#fc .meaning')).toBeHidden();
  await page.locator('#fc').click();
  await expect(page.locator('#fc .meaning')).toBeVisible();
  const response = page.waitForResponse(item => item.url().endsWith('/api/srs/review'));
  await page.locator('.g-good').click();
  await json(await response);
  await expect(page.locator('.review-done')).toBeVisible();
  const words = (await json(await request.get('/api/vocab'))).vocab;
  expect(words[0].reps).toBe(1);
  expect(words[0].due_at).toBeGreaterThan(Date.now() / 1000 + 3600);
  expect((await json(await request.get('/api/srs/due'))).due).toHaveLength(0);
}

async function finishSession(page, request, sessionId) {
  await page.locator('#resume-pill').click();
  await expect(page.locator('#view-chat')).toBeVisible();
  const response = page.waitForResponse(item => item.url().endsWith(`/api/sessions/${sessionId}/end`));
  await page.locator('#end-session').click();
  await expect(page.locator('#summary-modal')).toBeVisible();
  const summary = await json(await response);
  expect(summary.summary.length).toBeGreaterThan(10);
  expect(summary.stats.turns).toBe(1);
  expect(summary.stats.corrections).toBeGreaterThan(0);
  await expect(page.locator('#summary-inner')).toContainText(summary.summary);
  await page.locator('#sum-close').click();
  await expect(page.locator('#summary-modal')).toBeHidden();
  const dashboard = await json(await request.get('/api/dashboard'));
  expect(dashboard.sessions_count).toBeGreaterThanOrEqual(1);
  return summary;
}

async function inspectMobile(browser, request, testInfo, word) {
  // Playwright Test manages tracing for every context created by this browser.
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    baseURL: process.env.KAIWA_E2E_BASE_URL || 'http://127.0.0.1:8130',
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page.locator('#greeting')).toContainText(syntheticProfile.name);
    await expect(page.locator('#onboard-modal')).toBeHidden();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'mobile-home');
    await navigate(page, 'vocab');
    await expect(page.locator('.vocab-item .w')).toHaveText(word.word);
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'mobile-vocab');
    await navigate(page, 'review');
    await expect(page.locator('.review-done')).toBeVisible();
    await navigate(page, 'progress');
    await expect(page.locator('#recent-sessions .session-item').first()).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'mobile-progress');
    const profile = await json(await request.get('/api/profile'));
    expect(profile.name).toBe(syntheticProfile.name);
  } finally {
    await context.close();
  }
}

test('Codex real: onboarding → conversación → ayudas → vocabulario/SRS → resumen → móvil', async ({ page, request, browser }, testInfo) => {
  await checkCleanTestDatabase(request);
  const health = await json(await request.get('/api/health'));
  expect(health.provider).toBe('codex');
  expect(health.llm_ready).toBe(true);
  const codex = await json(await request.get('/api/codex/status'));
  expect(codex.installed).toBe(true);
  expect(codex.logged_in).toBe(true);
  expect(codex.ready).toBe(true);
  const errors = await collectFailures(page);
  await test.step('Onboarding y persistencia del perfil español N5', () => onboard(page, request));
  await screenshot(page, testInfo, 'desktop-home');
  await test.step('Estados vacíos de vocabulario y repaso', async () => {
    await navigate(page, 'vocab');
    await expect(page.locator('#vocab-list')).toContainText(/palabra/i);
    await expect(page.locator('.vocab-item')).toHaveCount(0);
    await navigate(page, 'review');
    await expect(page.locator('.review-done')).toBeVisible();
    await navigate(page, 'home');
  });
  const sessionId = await test.step('El tutor real abre en japonés y persiste el mensaje', () => beginRealConversation(page, request));
  const correction = await test.step('Error de pasado corregido y explicado', () => submitMistake(page));
  const aids = await test.step('Traducción y sugerencia utilizable', () => translateAndSuggest(page));
  await screenshot(page, testInfo, 'desktop-conversation');
  const word = await test.step('Guardar palabra desde el tutor', () => saveWord(page, request));
  await test.step('Revelar y calificar tarjeta modifica el vencimiento real', () => reviewWord(page, request, word));
  const summary = await test.step('Cerrar conversación genera resumen e historial', () => finishSession(page, request, sessionId));
  await testInfo.attach('synthetic-learning-results', {
    body: JSON.stringify({ correction, ...aids, summary }, null, 2), contentType: 'application/json',
  });
  await test.step('Lectura y navegación móvil con los mismos datos', () => inspectMobile(browser, request, testInfo, word));
  expect(errors).toEqual([]);
});

test('Referencias inexistentes devuelven errores HTTP explícitos', async ({ request }) => {
  const requests = [
    ['/api/chat', { session_id: nonexistentId, text: 'テスト' }],
    ['/api/correct', { message_id: nonexistentId }],
    [`/api/sessions/${nonexistentId}/end`, {}],
  ];
  for (const [url, data] of requests) {
    const response = await request.post(url, { data });
    expect(response.status(), url).toBe(404);
    const body = await response.json();
    expect(typeof body.error).toBe('string');
    expect(body.error).not.toContain('Traceback');
  }
});

for (const state of ['missing-cli', 'missing-login']) {
  test(`Onboarding móvil: ${state} y recuperación de la conexión`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      ...devices['iPhone 13'],
      baseURL: process.env.KAIWA_E2E_BASE_URL || 'http://127.0.0.1:8130',
    });
    const page = await context.newPage();
    let ready = false;
    try {
      await page.route('**/api/profile', async route => {
        const response = await route.fetch();
        const profile = await response.json();
        await route.fulfill({ json: { ...profile, name: '', interests: '', goals: '' } });
      });
      await page.route('**/api/health', async route => {
        const response = await route.fetch();
        const health = await response.json();
        await route.fulfill({ json: { ...health, llm_ready: false } });
      });
      await page.route('**/api/codex/status', route => route.fulfill({ json: {
        installed: ready || state !== 'missing-cli',
        logged_in: ready,
        ready,
        message: ready ? 'Conexión lista.' : state === 'missing-cli'
          ? 'Instala Codex para usar tu suscripción.' : 'Inicia sesión con codex login.',
      } }));
      await page.goto('/');
      await expect(page.locator('#ob-step-ai')).toBeVisible();
      await page.locator('#ob-opt-codex').click();
      await expect(page.locator('#ob-codex')).toBeVisible();
      await expect(page.locator('#ob-codex-status')).toContainText(state === 'missing-cli' ? /instala/i : /sesión|login/i);
      await expect(page.locator('#ob-codex-save')).toBeDisabled();
      await expect(page.locator('#ob-apikey')).toBeHidden();
      await noHorizontalOverflow(page);
      await screenshot(page, testInfo, `mobile-${state}`);
      ready = true;
      await page.locator('#ob-codex-check').click();
      await expect(page.locator('#ob-codex-save')).toBeEnabled();
      await expect(page.locator('#ob-codex-status')).toContainText(/lista|conect|preparad/i);
    } finally {
      await context.close();
    }
  });
}
