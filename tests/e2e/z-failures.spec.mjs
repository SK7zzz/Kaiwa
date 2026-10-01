import { test, expect } from './runtime.mjs';

test.beforeEach(async ({ request }) => {
  const profile = await (await request.get('/api/profile')).json();
  expect(profile.name, 'Usa exclusivamente la base sintética E2E.').toBe('Ado E2E');
  expect(profile.goals).toContain('Datos sintéticos E2E');
});

test('Una corrección fallida no felicita; un informe fallido permite reintentar sin perder la sesión', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#onboard-modal')).toBeHidden();
  await page.locator('#card-free').click();
  await expect(page.locator('#messages .ai .act-trans')).toBeVisible();
  await page.route('**/api/correct', route => route.fulfill({ status: 503, json: { error: 'Conexión de prueba interrumpida.' } }));
  await page.locator('#chat-input').fill('ラーメンが好きです。');
  await page.locator('#send-btn').click();
  await expect(page.locator('#messages .user .correction')).toContainText('No se pudo revisar');
  await expect(page.locator('#messages .user .correction.good')).toHaveCount(0);
  await expect(page.locator('#messages .ai .act-trans')).toHaveCount(2);
  const sessionId = await page.evaluate(() => state.session.session_id);
  const endpoint = `**/api/sessions/${sessionId}/end`;
  await page.route(endpoint, route => route.fulfill({ status: 503, json: { error: 'Informe de prueba no disponible.' } }));
  await page.locator('#end-session').click();
  await expect(page.locator('#summary-inner')).toContainText('El informe no está disponible');
  expect(await page.evaluate(() => state.session.session_id)).toBe(sessionId);
  const shot = testInfo.outputPath('summary-retry.png');
  await page.screenshot({ path: shot });
  await testInfo.attach('summary-retry', { path: shot, contentType: 'image/png' });
  await page.unroute(endpoint);
  await page.locator('#sum-retry').click();
  await expect(page.locator('#sum-close')).toBeVisible();
  await page.locator('#sum-close').click();
  expect(await page.evaluate(() => state.session)).toBe(null);
});

test('Colgar durante creación lenta cierra la sesión sin reabrir el micrófono', async ({ page, request }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
  });
  await page.goto('/');
  await expect(page.locator('#onboard-modal')).toBeHidden();
  let complete;
  let sessionId;
  const waiting = new Promise(resolve => { complete = resolve; });
  await page.route('**/api/sessions', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    sessionId = body.session_id;
    await waiting;
    await route.fulfill({ response });
  });
  await page.locator('#card-call').click();
  await expect.poll(() => sessionId).toBeGreaterThan(0);
  await page.locator('#call-hangup').click();
  await expect(page.locator('#call-overlay')).toBeHidden();
  complete();
  await expect.poll(async () => {
    const dashboard = await (await request.get('/api/dashboard')).json();
    return dashboard.recent_sessions.some(session => session.id === sessionId);
  }).toBe(true);
  expect(await page.evaluate(() => ({ call: codexCall, session: state.session }))).toEqual({ call: null, session: null });
});
