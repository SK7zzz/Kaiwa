import { test, expect as baseExpect } from './runtime.mjs';

const expect = baseExpect.configure({ timeout: 15_000 });

const views = ['home', 'review', 'vocab', 'dict', 'progress', 'settings'];
const emptyDashboard = {
  streak: 0, total_minutes: 0, sessions_count: 0, messages_spoken: 0,
  words_saved: 0, mistakes_logged: 0, srs_due: 0,
  recent_sessions: [], mistake_categories: [],
};

async function isolateUi(page, { onboard = false, dashboard = emptyDashboard } = {}) {
  const profile = {
    id: 1, name: onboard ? '' : 'Ado UI E2E', jlpt_level: 'N5',
    interests: 'videojuegos y ramen', goals: 'Datos sintéticos UI E2E',
    settings: { provider: 'codex', auto_play: false, auto_translate: false },
  };
  const evidence = { profileWrites: [], settingsWrites: [], sessionAttempts: [], errors: [] };
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.route('**/api/profile', async route => {
    if (route.request().method() === 'PUT') {
      const patch = route.request().postDataJSON();
      evidence.profileWrites.push(patch);
      Object.assign(profile, patch);
    }
    await route.fulfill({ json: profile });
  });
  await page.route('**/api/settings', async route => {
    const patch = route.request().postDataJSON();
    evidence.settingsWrites.push(patch);
    Object.assign(profile.settings, patch);
    await route.fulfill({ json: profile.settings });
  });
  for (const [path, json] of [
    ['vocab', { vocab: [] }], ['srs/due', { due: [] }],
    ['dashboard', dashboard],
    ['backup/status', { freq: 'off', dir: '/synthetic/kaiwa/backups', last: null }],
    ['setup/phone', { installed: false, running: false }],
  ]) await page.route(`**/api/${path}`, route => route.fulfill({ json }));
  await page.route('**/api/sessions', async route => {
    evidence.sessionAttempts.push(route.request().method());
    await route.fulfill({ status: 503, json: { error: 'El recorrido visual no inicia sesiones.' } });
  });
  return evidence;
}

async function attachScreenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function measureLayout(page, name) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth, document: document.documentElement.scrollWidth,
    mainWidth: document.querySelector('#main').clientWidth,
    mainContent: document.querySelector('#main').scrollWidth,
    visibleViews: [...document.querySelectorAll('.view:not(.hidden)')].map(view => view.id),
  }));
  expect(dimensions.document, `Desbordamiento horizontal: ${name}`).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.mainContent, `Contenido recortado en #main: ${name}`).toBeLessThanOrEqual(dimensions.mainWidth + 1);
  expect(dimensions.visibleViews).toHaveLength(1);
  return { name, ...dimensions };
}

async function navigate(page, view) {
  const button = page.locator(`.nav-btn[data-view="${view}"]`);
  await button.click();
  await expect(page.locator(`#view-${view}`)).toBeVisible();
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.nav-btn[aria-current="page"]')).toHaveCount(1);
  if (view !== 'dict') await expect(page.locator(`#view-${view}`)).toHaveAttribute('aria-busy', 'false');
}

async function verifyBrandImages(page) {
  for (const selector of ['img.brand-mark:visible', '.home-hero img.hero-art']) {
    const image = page.locator(selector).first();
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('alt', /.*/);
    await expect.poll(() => image.evaluate(node =>
      node.complete && node.naturalWidth > 32 && node.naturalHeight > 32)).toBe(true);
  }
}

async function expectAllCards(page, catalog) {
  await expect(page.locator('#scenario-cats .scen-card:visible')).toHaveCount(catalog.scenarios.length);
  await expect(page.locator('#lessons-row .scen-card:visible')).toHaveCount(catalog.lessons.length);
}

async function verifyFilters(page, catalog) {
  const search = page.locator('#practice-search');
  const ramen = catalog.scenarios.find(scenario => scenario.id === 'ramen');
  const otherCategory = catalog.scenarios.find(scenario => scenario.category !== ramen.category).category;
  await expectAllCards(page, catalog);
  await search.fill('ramen');
  await expect(page.locator('.scen-card[data-id="ramen"]')).toBeVisible();
  await expect(page.locator('#lessons-row .scen-card:visible')).toHaveCount(0);
  await page.locator('#scenario-filters').getByRole('button', { name: ramen.category, exact: true }).click();
  await expect(page.locator('#scenario-filters [aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('.scen-card[data-id="ramen"]')).toBeVisible();
  await page.locator('#scenario-filters').getByRole('button', { name: otherCategory, exact: true }).click();
  await expect(page.locator('#scenario-empty')).toBeVisible();
  await expect(page.locator('#scenario-cats .scen-card:visible')).toHaveCount(0);
  await page.locator('#practice-clear').click();
  await expect(search).toHaveValue('');
  await expect(page.locator('#scenario-empty')).toBeHidden();
  await expectAllCards(page, catalog);
  const lesson = catalog.lessons.find(item => item.id === 'greetings');
  await search.fill(lesson.title);
  await expect(page.locator('#lessons-row .scen-card[data-id="greetings"]')).toBeVisible();
  await search.fill('zzzz_no_existe_シンセティック');
  await expect(page.locator('#scenario-empty')).toBeVisible();
  await expect(page.locator('.scen-card:visible')).toHaveCount(0);
  await page.locator('#practice-clear').click();
  await expectAllCards(page, catalog);
}

async function keyboardDialog(page, { card, modal, first, last }) {
  const trigger = page.locator(card);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator(modal);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator(first)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(last)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator(first)).toBeFocused();
  await page.locator(first).fill('Datos sintéticos: sólo revisar el diálogo');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

async function verifyEmptyViews(page) {
  await navigate(page, 'vocab');
  await expect(page.locator('.vocab-item')).toHaveCount(0);
  await expect(page.locator('#vocab-list')).toContainText(/palabra/i);
  const action = page.locator('#vocab-list button');
  await expect(action).toBeVisible();
  await action.click();
  await expect(page.locator('#view-home')).toBeVisible();
  await navigate(page, 'review');
  await expect(page.locator('.review-done')).toBeVisible();
  await expect(page.locator('#review-area')).toContainText(/palabra|practic/i);
  await navigate(page, 'progress');
  await expect(page.locator('.session-item')).toHaveCount(0);
  await expect(page.locator('#recent-sessions')).toContainText(/sesión|sesiones/i);
  await expect(page.locator('#mistake-cats')).toContainText(/practic|correcci/i);
}

test('UI renovada: catálogo real, búsqueda y filtros, teclado, diálogos y Ajustes', async ({ page, request }, testInfo) => {
  const evidence = await isolateUi(page);
  const response = await request.get('/api/scenarios');
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  await page.goto('/');
  await expect(page.locator('#greeting')).toContainText('Ado UI E2E');
  await test.step('Marca e imágenes personalizadas cargan desde el servidor', () => verifyBrandImages(page));
  await attachScreenshot(page, testInfo, 'ui-desktop-home');
  await test.step('Búsqueda combina categorías, lecciones y recuperación del vacío', () => verifyFilters(page, catalog));
  await test.step('Tarjetas son botones y diálogos retienen/restituyen el foco', async () => {
    for (const card of await page.locator('.mode-card, .scen-card').all()) {
      expect(await card.evaluate(node => node.tagName)).toBe('BUTTON');
    }
    await keyboardDialog(page, { card: '#card-custom', modal: '#custom-modal', first: '#cr-title', last: '#cr-start' });
    await keyboardDialog(page, { card: '#card-story', modal: '#story-modal', first: '#st-topic', last: '#st-start' });
  });
  await test.step('Los vacíos explican el siguiente paso y su acción funciona', () => verifyEmptyViews(page));
  await navigate(page, 'settings');
  await expect(page.locator('#set-name')).toHaveValue('Ado UI E2E');
  await expect(page.locator('#set-provider')).toHaveValue('codex');
  await expect(page.locator('#set-model option')).not.toHaveCount(0);
  await page.locator('#set-name').fill('Ado UI editado');
  await page.locator('#set-interests').fill('juegos y diseño');
  await page.locator('#set-goals').fill('Datos sintéticos UI E2E: cafeterías');
  await page.locator('#set-level [data-l="N4"]').click();
  await page.locator('#set-autotranslate').check();
  await page.locator('#save-settings').click();
  await expect(page.locator('#settings-saved')).toContainText('Guardado');
  expect(evidence.profileWrites).toEqual([{
    name: 'Ado UI editado', jlpt_level: 'N4', interests: 'juegos y diseño',
    goals: 'Datos sintéticos UI E2E: cafeterías',
  }]);
  await expect.poll(() => evidence.settingsWrites.length).toBe(1);
  expect(evidence.settingsWrites[0].auto_translate).toBe(true);
  await page.reload();
  await expect(page.locator('#greeting')).toContainText('Ado UI editado');
  await navigate(page, 'settings');
  await expect(page.locator('#set-goals')).toHaveValue('Datos sintéticos UI E2E: cafeterías');
  await expect(page.locator('#set-level [data-l="N4"]')).toHaveClass(/active/);
  await expect(page.locator('#set-autotranslate')).toBeChecked();
  await attachScreenshot(page, testInfo, 'ui-desktop-settings');
  expect(evidence.sessionAttempts).toEqual([]);
  expect(evidence.errors).toEqual([]);
  await testInfo.attach('ui-actions-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

for (const width of [320, 390]) {
  test(`UI móvil ${width}px: seis pantallas, vacíos y diálogos accesibles sin desbordamiento`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const evidence = await isolateUi(page);
    await page.goto('/');
    await expect(page.locator('#greeting')).toContainText('Ado UI E2E');
    const metrics = [];
    for (const view of views) {
      await navigate(page, view);
      if (view === 'home') await verifyBrandImages(page);
      if (view === 'settings') await expect(page.locator('#set-provider')).toHaveValue('codex');
      if (view === 'review') await expect(page.locator('.review-done')).toBeVisible();
      if (view === 'vocab') await expect(page.locator('#vocab-list button')).toBeVisible();
      if (view === 'progress') await expect(page.locator('#recent-sessions')).toContainText(/sesión|sesiones/i);
      metrics.push(await measureLayout(page, `${width}-${view}`));
      await attachScreenshot(page, testInfo, `ui-mobile-${width}-${view}`);
    }
    await navigate(page, 'home');
    await page.locator('#card-custom').click();
    await expect(page.locator('#custom-modal')).toBeVisible();
    metrics.push(await measureLayout(page, `${width}-custom-dialog`));
    await attachScreenshot(page, testInfo, `ui-mobile-${width}-custom-dialog`);
    await page.locator('#cr-cancel').click();
    await expect(page.locator('#custom-modal')).toBeHidden();
    await expect(page.locator('#card-custom')).toBeFocused();
    expect(evidence.sessionAttempts).toEqual([]);
    expect(evidence.errors).toEqual([]);
    await testInfo.attach('ui-layout-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  });
}

test('Onboarding conserva el diálogo al pulsar Escape y el foco permanece dentro', async ({ page }) => {
  const evidence = await isolateUi(page, { onboard: true });
  await page.goto('/');
  const dialog = page.locator('#onboard-modal');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  expect(evidence.sessionAttempts).toEqual([]);
  expect(evidence.errors).toEqual([]);
});

test('Progreso poblado a 320px: informe y barras conservan navegación sin recortar contenido', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const dashboard = {
    ...emptyDashboard, sessions_count: 1, mistakes_logged: 3,
    mistake_categories: [{ category: 'verb form', n: 2 }, { category: 'politeness', n: 1 }],
    recent_sessions: [{
      id: 9001, mode: 'roleplay', title: 'Preguntar por los ingredientes de un ramen en una cafetería de Kioto',
      started_at: 1700000000, minutes: 8,
      summary: {
        summary: 'Datos sintéticos: has pedido recomendaciones y practicado formas de pasado.',
        stats: { turns: 4, corrections: 3 }, strengths: ['Explicar tus preferencias con claridad.'],
        areas_to_improve: ['Conjugar las formas del pasado y mantener la formalidad al pedir recomendaciones.'],
        new_words: [{ word: 'おすすめ', reading: 'おすすめ', meaning: 'recomendación' }],
      },
    }],
  };
  const evidence = await isolateUi(page, { dashboard });
  await page.goto('/');
  await navigate(page, 'progress');
  await expect(page.locator('#recent-sessions .session-item')).toHaveCount(1);
  await page.locator('#recent-sessions .session-item .head').click();
  await expect(page.locator('.sess-detail')).toBeVisible();
  await expect(page.locator('.sess-detail')).toContainText('Conjugar');
  await expect(page.locator('.mcat')).toHaveCount(2);
  const metrics = await measureLayout(page, '320-progress-populated');
  await attachScreenshot(page, testInfo, 'ui-mobile-320-progress-populated');
  expect(evidence.errors).toEqual([]);
  expect(evidence.sessionAttempts).toEqual([]);
  await testInfo.attach('ui-populated-layout-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
});

test('IME japonés: confirmar composición conserva el texto y Enter normal lo envía una sola vez', async ({ page }, testInfo) => {
  const evidence = await isolateUi(page);
  const chatRequests = [];
  await page.route('**/api/sessions', route => route.fulfill({ json: { session_id: 9901, scenario: null } }));
  await page.route('**/api/correct', route => route.fulfill({ json: { has_errors: false, errors: [] } }));
  await page.route('**/api/chat', async route => {
    const request = route.request().postDataJSON();
    chatRequests.push(request);
    const japanese = request.text ? 'ラーメンが好きなんですね。' : 'こんにちは。';
    const events = [
      ...(request.text ? [{ user_message_id: 9902 }] : []),
      { delta: japanese },
      { done: true, message_id: 9903, romaji: '', tokens: [{
        surface: japanese, word: true, ruby: [{ t: japanese, r: '' }],
      }] },
    ];
    await route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') });
  });
  await page.goto('/');
  await page.locator('#card-free').click();
  await expect(page.locator('#messages .ai .act-trans')).toBeVisible();
  expect(chatRequests).toHaveLength(1);
  const input = page.locator('#chat-input');
  const sentence = 'ラーメンが好きです。';
  await input.fill(sentence);
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true });
  await input.dispatchEvent('compositionend');
  await expect(input).toHaveValue(sentence);
  expect(chatRequests).toHaveLength(1);
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: false });
  await expect(input).toHaveValue(sentence);
  expect(chatRequests).toHaveLength(1);
  await input.press('Enter');
  await expect(page.locator('#messages .ai .act-trans')).toHaveCount(2);
  await expect(page.locator('#messages .user')).toContainText(sentence);
  expect(chatRequests.map(request => request.text)).toEqual(['', sentence]);
  expect(evidence.errors).toEqual([]);
  await testInfo.attach('ui-ime-events', { body: JSON.stringify({
    simulatedEvents: ['compositionstart', 'Enter/isComposing=true', 'compositionend', 'Enter/keyCode=229', 'Enter normal'],
    chatRequests, errors: evidence.errors,
  }, null, 2), contentType: 'application/json' });
});

test('Ajustes 503: muestra error, conserva el formulario y permite volver a guardar', async ({ page }, testInfo) => {
  const evidence = await isolateUi(page);
  let fail = true;
  let failedAttempts = 0;
  await page.route('**/api/profile', async route => {
    if (route.request().method() !== 'PUT' || !fail) return route.fallback();
    failedAttempts++;
    await route.fulfill({ status: 503, json: { error: 'Fallo sintético de guardado.' } });
  });
  await page.goto('/');
  await navigate(page, 'settings');
  await expect(page.locator('#set-provider')).toHaveValue('codex');
  await page.locator('#set-name').fill('Ado UI conservar al fallar');
  await page.locator('#save-settings').click();
  const status = page.locator('#settings-saved');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toContainText('No se pudo guardar');
  await expect(status).not.toContainText('Guardado');
  await expect(page.locator('#set-name')).toHaveValue('Ado UI conservar al fallar');
  await expect(page.locator('#save-settings')).toBeEnabled();
  expect(failedAttempts).toBe(1);
  expect(evidence.profileWrites).toHaveLength(0);
  expect(evidence.settingsWrites).toHaveLength(0);
  await attachScreenshot(page, testInfo, 'ui-settings-save-error');
  fail = false;
  await page.locator('#save-settings').click();
  await expect(status).toContainText('Guardado');
  expect(evidence.profileWrites).toHaveLength(1);
  expect(evidence.profileWrites[0].name).toBe('Ado UI conservar al fallar');
  expect(evidence.settingsWrites).toHaveLength(1);
  expect(evidence.errors).toEqual([]);
});

test('Vocabulario 503: error visible y reintento recupera el estado vacío', async ({ page }, testInfo) => {
  const evidence = await isolateUi(page);
  let fail = true;
  let reads = 0;
  await page.route('**/api/vocab', async route => {
    reads++;
    if (!fail) return route.fallback();
    await route.fulfill({ status: 503, json: { error: 'Vocabulario sintético no disponible.' } });
  });
  await page.goto('/');
  await navigate(page, 'vocab');
  const error = page.locator('#view-vocab .view-status');
  await expect(error).toBeVisible();
  await expect(error).toContainText(/error|no se pudo|no disponible/i);
  await expect(page.locator('#view-vocab button[data-retry-view="vocab"]')).toBeVisible();
  await attachScreenshot(page, testInfo, 'ui-vocab-load-error');
  fail = false;
  await page.locator('#view-vocab button[data-retry-view="vocab"]').click();
  await expect(error).toBeHidden();
  await expect(page.locator('#vocab-list')).toContainText(/palabra/i);
  await expect(page.locator('#vocab-list button[data-action="practice"]')).toBeVisible();
  expect(reads).toBe(2);
  expect(evidence.errors).toEqual([]);
  expect(evidence.sessionAttempts).toEqual([]);
});

async function mockLearningUi(page) {
  const control = { sessionFail: false, hintFail: false, vocabFail: false, sessions: [], chats: [], vocab: [] };
  const word = { word: '寿司', reading: 'すし', romaji: 'sushi', meaning: 'sushi' };
  await page.route('**/api/sessions', route => {
    control.sessions.push(route.request().postDataJSON());
    return route.fulfill(control.sessionFail
      ? { status: 503, json: { error: 'Inicio de sesión sintético no disponible.' } }
      : { json: { session_id: 9951, scenario: null } });
  });
  await page.route('**/api/chat', route => {
    control.chats.push(route.request().postDataJSON());
    const events = [{ delta: '寿司が好きですか。' }, { done: true, message_id: 9952, romaji: '', tokens: [{
      surface: word.word, word: true, ruby: [{ t: word.word, r: word.reading }],
    }] }];
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') });
  });
  await page.route('**/api/hint', route => route.fulfill(control.hintFail
    ? { status: 503, json: { error: 'Pistas sintéticas no disponibles.' } }
    : { json: { suggestions: [{ japanese: '寿司が好きです。', romaji: 'sushi ga suki desu', english: 'Me gusta el sushi.' }] } }));
  await page.route('**/api/word', route => route.fulfill({ json: word }));
  await page.route('**/api/dictionary**', route => route.fulfill({ json: {
    results: [{ form: word.word, reading: word.reading, meaning: word.meaning, common: true }],
  } }));
  await page.route('**/api/sessions/9951/end', route => route.fulfill({ json: {
    summary: 'Informe sintético de recuperación UI.', stats: { turns: 0, corrections: 0 },
    strengths: [], areas_to_improve: [], new_words: [word],
  } }));
  await page.route('**/api/vocab', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    control.vocab.push(route.request().postDataJSON());
    return route.fulfill(control.vocabFail
      ? { status: 503, json: { error: 'Guardado sintético no disponible.' } }
      : { json: { ...word, id: 9953 } });
  });
  return control;
}

async function openSyntheticConversation(page) {
  await page.goto('/');
  await page.locator('#card-free').click();
  await expect(page.locator('#messages .ai .act-trans')).toBeVisible();
}

test('Informe terminado: Escape cierra y devuelve el foco a Practicar en Inicio', async ({ page }) => {
  const evidence = await isolateUi(page);
  const control = await mockLearningUi(page);
  await openSyntheticConversation(page);
  await page.locator('#end-session').click();
  await expect(page.locator('#sum-close')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#summary-modal')).toBeHidden();
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#hero-practice')).toBeFocused();
  expect(await page.locator('#app').evaluate(app => app.inert)).toBe(false);
  expect(await page.evaluate(() => state.session)).toBe(null);
  expect(control.sessions).toHaveLength(1);
  expect(evidence.errors).toEqual([]);
});

test('Sesión 503: conserva Inicio, muestra error y permite iniciar sin sesión ficticia', async ({ page }, testInfo) => {
  const evidence = await isolateUi(page);
  const control = await mockLearningUi(page);
  control.sessionFail = true;
  await page.goto('/');
  await page.locator('#card-free').click();
  await expect(page.locator('#session-start-error')).toBeVisible();
  await expect(page.locator('#session-start-error')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#session-start-error')).toContainText(/no disponible|no se pudo/i);
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#card-free')).toBeEnabled();
  expect(await page.evaluate(() => state.session)).toBe(null);
  expect(control.chats).toHaveLength(0);
  await attachScreenshot(page, testInfo, 'ui-session-start-error');
  control.sessionFail = false;
  await page.locator('#card-free').click();
  await expect(page.locator('#messages .ai .act-trans')).toBeVisible();
  expect(control.sessions).toHaveLength(2);
  expect(control.chats).toHaveLength(1);
  expect(evidence.errors).toEqual([]);
});

test('Pistas 503: el panel permite reintentar y utilizar una sugerencia recuperada', async ({ page }, testInfo) => {
  const evidence = await isolateUi(page);
  const control = await mockLearningUi(page);
  control.hintFail = true;
  await openSyntheticConversation(page);
  await page.locator('#hint-btn').click();
  await expect(page.locator('#hints')).toContainText(/no disponible|no se pudo/i);
  await expect(page.locator('#hint-retry')).toBeVisible();
  await attachScreenshot(page, testInfo, 'ui-hint-error');
  control.hintFail = false;
  await page.locator('#hint-retry').click();
  await expect(page.locator('#hints .hint-card[data-t]')).toHaveCount(1);
  await page.locator('#hints .hint-card[data-t]').click();
  await expect(page.locator('#chat-input')).toHaveValue('寿司が好きです。');
  await expect(page.locator('#chat-input')).toBeFocused();
  expect(control.chats).toHaveLength(1);
  expect(evidence.errors).toEqual([]);
});

async function openSaveSurface(page, surface) {
  if (surface === 'dictionary') {
    await page.goto('/');
    await navigate(page, 'dict');
    await page.locator('#dict-search').fill('寿司');
    await expect(page.locator('.dict-entry')).toBeVisible();
    return { button: page.locator('.dict-entry .dict-save'), status: page.locator('.dict-entry .save-status') };
  }
  await openSyntheticConversation(page);
  if (surface === 'popup') {
    await page.locator('#messages .ai .tok').click();
    await expect(page.locator('#pop-save')).toBeVisible();
    return { button: page.locator('#pop-save'), status: page.locator('#word-pop-inner .save-status') };
  }
  await page.locator('#end-session').click();
  await expect(page.locator('#sum-close')).toBeVisible();
  return { button: page.locator('.new-word-row button'), status: page.locator('.new-word-row .save-status') };
}

for (const surface of ['popup', 'summary', 'dictionary']) {
  test(`Guardar palabra 503 desde ${surface}: no muestra éxito falso y el reintento funciona`, async ({ page }, testInfo) => {
    const evidence = await isolateUi(page);
    const control = await mockLearningUi(page);
    control.vocabFail = true;
    const { button, status } = await openSaveSurface(page, surface);
    await button.click();
    await expect(status).toBeVisible();
    await expect(status).toHaveClass(/error/);
    await expect(status).toContainText(/no disponible|no se pudo/i);
    await expect(button).toBeEnabled();
    await expect(button).not.toContainText('Guardada');
    expect(control.vocab).toHaveLength(1);
    await attachScreenshot(page, testInfo, `ui-vocab-save-${surface}-error`);
    control.vocabFail = false;
    await button.click();
    await expect(button).toHaveText('✓ Guardada');
    await expect(button).toBeDisabled();
    await expect(status).not.toHaveClass(/error/);
    expect(control.vocab).toHaveLength(2);
    expect(control.vocab[1].word).toBe('寿司');
    expect(evidence.errors).toEqual([]);
  });
}

test('Borrador de Ajustes: navegar conserva campos y nivel, selecciones accesibles y guardado global', async ({ page }) => {
  const evidence = await isolateUi(page);
  await page.goto('/');
  await navigate(page, 'settings');
  await page.locator('#set-name').fill('Ado UI borrador');
  await page.locator('#set-interests').fill('diseño y cafés');
  await page.locator('#set-goals').fill('Datos sintéticos: conservar un borrador');
  await page.locator('#set-level [data-l="N4"]').click();
  await expect(page.locator('#set-level [data-l="N4"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#set-level [data-l="N5"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#settings-saved')).toContainText('Cambios sin guardar');
  await navigate(page, 'home');
  await page.locator('#card-story').click();
  await page.locator('#st-script [data-s="hiragana"]').click();
  await expect(page.locator('#st-script [data-s="hiragana"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#st-script [data-s="normal"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#st-cancel').click();
  await navigate(page, 'settings');
  await expect(page.locator('#set-name')).toHaveValue('Ado UI borrador');
  await expect(page.locator('#set-interests')).toHaveValue('diseño y cafés');
  await expect(page.locator('#set-goals')).toHaveValue('Datos sintéticos: conservar un borrador');
  await expect(page.locator('#set-level [data-l="N4"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#settings-saved')).toContainText('Cambios sin guardar');
  expect(await page.locator('#save-settings').evaluate(button => Boolean(button.closest('.settings-grid')))).toBe(false);
  expect(evidence.profileWrites).toHaveLength(0);
  expect(evidence.settingsWrites).toHaveLength(0);
  expect(evidence.sessionAttempts).toEqual([]);
  expect(evidence.errors).toEqual([]);
});
