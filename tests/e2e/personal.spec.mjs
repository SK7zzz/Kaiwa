import { test, expect } from './runtime.mjs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const band = 'Nebula Prisma E2E';
const manualPlan = 'Plan sintético E2E: mañana pedir un corte de pelo de tres centímetros.';
const editedPlan = 'Plan sintético E2E corregido: el corte de pelo será de dos centímetros.';
const updatedBand = 'Nebula Coral E2E';
const nonexistentId = 2147483647;

async function json(response) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function requireSyntheticCodex(request) {
  const profile = await json(await request.get('/api/profile'));
  expect(profile.name, 'Usar exclusivamente una base de pruebas aislada.').toBe('Ado E2E');
  expect(profile.goals).toContain('Datos sintéticos E2E');
  expect(profile.settings.auto_play).toBe(false);
  const health = await json(await request.get('/api/health'));
  expect(health.provider).toBe('codex');
  expect(health.llm_ready).toBe(true);
}

async function navigate(page, view) {
  await page.locator(`.nav-btn[data-view="${view}"]`).click();
  await expect(page.locator(`#view-${view}`)).toBeVisible();
  await expect(page.locator(`#view-${view}`)).not.toHaveAttribute('aria-busy', 'true');
}

async function screenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

function posted(page, endpoint) {
  return page.waitForResponse(response =>
    response.url().endsWith(endpoint) && response.request().method() === 'POST');
}

async function memories(request) {
  return (await json(await request.get('/api/memory'))).memories;
}

async function openMemory(page) {
  await navigate(page, 'companion');
  await page.locator('#companion-memory').click();
  await expect(page.locator('#companion-memory-panel')).toBeVisible();
  await expect(page.locator('#companion-memory')).toHaveAttribute('aria-pressed', 'true');
}

async function rememberPlan(page) {
  await openMemory(page);
  await page.locator('#memory-category').selectOption('planes');
  await page.locator('#memory-content').fill(manualPlan);
  const saved = posted(page, '/api/memory');
  await page.locator('#memory-save').click();
  const memory = await json(await saved);
  expect(memory.category).toBe('planes');
  expect(memory.content).toBe(manualPlan);
  expect(memory.source).toBe('user');
  await expect(page.locator(`[data-memory-id="${memory.id}"] .memory-content`)).toHaveText(manualPlan);
  return memory;
}

async function editAndForgetPlan(page, request, memory) {
  await page.reload();
  await openMemory(page);
  const row = page.locator(`[data-memory-id="${memory.id}"]`);
  await expect(row.locator('.memory-content')).toHaveText(manualPlan);
  await row.locator('.memory-edit').click();
  await expect(page.locator('#memory-content')).toHaveValue(manualPlan);
  await page.locator('#memory-content').fill(editedPlan);
  const updated = page.waitForResponse(response =>
    response.url().endsWith(`/api/memory/${memory.id}`) && response.request().method() === 'PUT');
  await page.locator('#memory-save').click();
  expect((await json(await updated)).content).toBe(editedPlan);
  await expect(row.locator('.memory-content')).toHaveText(editedPlan);
  await page.reload();
  await openMemory(page);
  await expect(row.locator('.memory-content')).toHaveText(editedPlan);
  page.once('dialog', dialog => dialog.dismiss());
  await row.locator('.memory-forget').click();
  expect((await memories(request)).find(item => item.id === memory.id).content).toBe(editedPlan);
  page.once('dialog', dialog => dialog.accept());
  const forgotten = page.waitForResponse(response =>
    response.url().endsWith(`/api/memory/${memory.id}`) && response.request().method() === 'DELETE');
  await row.locator('.memory-forget').click();
  expect((await json(await forgotten)).ok).toBe(true);
  await expect(row).toHaveCount(0);
  await page.reload();
  await openMemory(page);
  await expect(row).toHaveCount(0);
  expect((await memories(request)).some(item => item.id === memory.id)).toBe(false);
}

async function companionTurn(page, text) {
  await page.locator('#companion-chat').click();
  await expect(page.locator('#companion-chat-panel')).toBeVisible();
  await page.locator('#companion-input').fill(text);
  const sent = posted(page, '/api/companion');
  await page.locator('#companion-send').click();
  const result = await json(await sent);
  expect(result.reply.length).toBeGreaterThan(10);
  await expect(page.locator('#companion-messages .companion-message.assistant .companion-text').last()).toContainText(result.reply);
  await expect(page.locator('#companion-messages .companion-message.assistant .companion-text').last()).toBeInViewport();
  await expect(page.locator('#companion-input')).toHaveValue('');
  return result;
}

async function startTopic(page, options) {
  await navigate(page, 'home');
  let starts = 0;
  const track = request => {
    if (request.url().endsWith('/api/sessions') && request.method() === 'POST') starts += 1;
  };
  page.on('request', track);
  await page.locator(`.topic-presets [data-topic="${options.preset}"]`).click();
  await expect(page.locator('#practice-topic')).not.toHaveValue('');
  await expect(page.locator('#topic-mode')).toHaveValue(options.mode);
  expect(starts, 'El preset rellena el formulario sin comenzar una sesión.').toBe(0);
  if (options.text) await page.locator('#practice-topic').fill(options.text);
  const topic = await page.locator('#practice-topic').inputValue();
  const started = posted(page, '/api/sessions');
  await page.locator('#topic-start').click();
  const response = await started;
  const payload = response.request().postDataJSON();
  expect(payload.mode).toBe(options.mode);
  expect(JSON.stringify(payload.custom)).toContain(topic);
  const session = await json(response);
  page.removeListener('request', track);
  expect(starts).toBe(1);
  await expect(page.locator('#view-chat')).toBeVisible();
  await expect(page.locator('#chat-title')).not.toBeEmpty();
  await expect(page.locator('#messages .ai .act-trans')).toHaveCount(1);
  await expect(page.locator('#messages .ai .bubble')).toContainText(/[ぁ-んァ-ヶ一-龯]/);
  return session;
}

async function finishTopic(page, session) {
  const ended = posted(page, `/api/sessions/${session.session_id}/end`);
  await page.locator('#end-session').click();
  const summary = await json(await ended);
  expect(summary.summary.length).toBeGreaterThan(10);
  await expect(page.locator('#summary-inner')).toContainText(summary.summary);
  await page.locator('#sum-close').click();
  await expect(page.locator('#view-home')).toBeVisible();
  return summary;
}

async function editAndForgetLearnedBand(page, request, memory) {
  await openMemory(page);
  const row = page.locator(`[data-memory-id="${memory.id}"]`);
  await row.locator('.memory-edit').click();
  await page.locator('#memory-content').fill(`Mi banda favorita ahora es ${updatedBand}.`);
  const changed = page.waitForResponse(response =>
    response.url().endsWith(`/api/memory/${memory.id}`) && response.request().method() === 'PUT');
  await page.locator('#memory-save').click();
  await json(await changed);
  await page.reload();
  await navigate(page, 'companion');
  const edited = await companionTurn(page,
    '¿Cómo se llama mi banda favorita actualmente? Usa sólo mi preferencia vigente, no un dato antiguo del historial.');
  expect(edited.reply).toContain(updatedBand);
  expect(edited.reply).not.toContain(band);
  await openMemory(page);
  page.once('dialog', dialog => dialog.accept());
  const forgotten = page.waitForResponse(response =>
    response.url().endsWith(`/api/memory/${memory.id}`) && response.request().method() === 'DELETE');
  await row.locator('.memory-forget').click();
  await json(await forgotten);
  await page.reload();
  await navigate(page, 'companion');
  const afterForget = await companionTurn(page,
    '¿Cómo se llama mi banda favorita? Si no consta en mis recuerdos, di que no tienes ese dato. No recuperes un dato que he olvidado del historial.');
  expect(afterForget.reply).not.toContain(band);
  expect(afterForget.reply).not.toContain(updatedBand);
  expect((await memories(request)).some(item => /Nebula (Prisma|Coral) E2E/.test(item.content))).toBe(false);
  return { edited, afterForget };
}

test('Codex real: memoria editable → asistente persistente → peluquería → música personalizada', async ({ page, request }, testInfo) => {
  test.setTimeout(900_000);
  await requireSyntheticCodex(request);
  expect(await memories(request), 'El recorrido necesita memoria sintética nueva.').toEqual([]);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const manual = await test.step('Guardar, editar, cancelar olvido y olvidar un plan real en SQLite', () => rememberPlan(page));
  await editAndForgetPlan(page, request, manual);
  const learned = await test.step('El asistente real aprende una preferencia personal sintética', () => companionTurn(page,
    `Mi banda favorita se llama ${band}. Recuerda esta preferencia para practicar música conmigo.`));
  expect(learned.memories_saved).toBeGreaterThan(0);
  const storedBand = (await memories(request)).find(item => item.content.includes(band));
  expect(storedBand).toBeDefined();
  expect(storedBand.source).toBe('companion');
  await page.reload();
  await navigate(page, 'companion');
  await expect(page.locator('#companion-messages .companion-message.user')).toContainText(band);
  const recalled = await test.step('Nueva carga recupera la preferencia sin repetir su nombre', () => companionTurn(page,
    '¿Cómo se llama mi banda favorita? Dime el nombre que recuerdas y una idea de práctica con música.'));
  expect(recalled.reply).toContain(band);
  const dialogue = await json(await request.get('/api/companion'));
  expect(dialogue.messages.filter(item => item.role === 'user')).toHaveLength(2);
  expect(dialogue.messages.filter(item => item.role === 'assistant')).toHaveLength(2);
  await screenshot(page, testInfo, 'personal-assistant-memory-recalled');
  await openMemory(page);
  await expect(page.locator('#memory-list')).toContainText(band);
  await screenshot(page, testInfo, 'personal-memory-persisted');
  const hair = await test.step('Preset peluquería inicia una escena real con el tema elegido', () => startTopic(page, {
    preset: 'peluqueria', mode: 'roleplay',
  }));
  await page.locator('#chat-input').fill('En este roleplay soy un músico profesional. 3センチぐらい切ってください。');
  await page.locator('#send-btn').click();
  await expect(page.locator('#messages .ai .act-trans')).toHaveCount(2);
  await screenshot(page, testInfo, 'personal-hairdresser-practice');
  const hairSummary = await finishTopic(page, hair);
  expect((await memories(request)).some(item => /músico profesional|musico profesional/.test(item.content))).toBe(false);
  const music = await test.step('Lección de música recibe la memoria del usuario sin repetirla en el tema', () => startTopic(page, {
    preset: 'musica', mode: 'lesson',
    text: 'Practicar vocabulario de música hablando de mi banda favorita. Usa su nombre exacto en alfabeto latino tal como lo recuerdas, sin pedírmelo otra vez.',
  }));
  await expect(page.locator('#messages .ai .bubble').first()).toContainText(band);
  await page.locator('#chat-input').fill('音楽を聞くのが好きです。おすすめの曲は何ですか。');
  await page.locator('#send-btn').click();
  await expect(page.locator('#messages .ai .act-trans')).toHaveCount(2);
  await screenshot(page, testInfo, 'personal-music-lesson-memory');
  const musicSummary = await finishTopic(page, music);
  const hairMessages = await json(await request.get(`/api/sessions/${hair.session_id}/messages`));
  const musicMessages = await json(await request.get(`/api/sessions/${music.session_id}/messages`));
  const revisedMemory = await test.step('Editar y olvidar una preferencia aprendida excluye los hechos antiguos del contexto', () =>
    editAndForgetLearnedBand(page, request, storedBand));
  await testInfo.attach('personal-real-learning-results', {
    body: JSON.stringify({ learned, recalled, storedBand, dialogue, hair, hairSummary, hairMessages, music, musicSummary, musicMessages, revisedMemory }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('Memoria/asistente: referencias y formularios inválidos fallan sin modificar el historial', async ({ request }) => {
  await requireSyntheticCodex(request);
  const before = await json(await request.get('/api/companion'));
  for (const response of [
    await request.put(`/api/memory/${nonexistentId}`, { data: { category: 'planes', content: 'Dato sintético inexistente.' } }),
    await request.delete(`/api/memory/${nonexistentId}`),
  ]) {
    expect(response.status()).toBe(404);
    expect((await response.json()).error).toEqual(expect.any(String));
  }
  for (const response of [
    await request.post('/api/memory', { data: { category: 'planes', content: '   ' } }),
    await request.post('/api/memory', { data: { category: 'categoria-invalida', content: 'Dato sintético.' } }),
    await request.post('/api/companion', { data: { text: '   ' } }),
  ]) {
    expect([400, 422]).toContain(response.status());
    expect((await response.json()).error).toEqual(expect.any(String));
  }
  expect(await json(await request.get('/api/companion'))).toEqual(before);
});

test('Asistente HTTP 503: conserva la petición, no inventa éxito y permite reintentar', async ({ page, request }, testInfo) => {
  await requireSyntheticCodex(request);
  const history = await json(await request.get('/api/companion'));
  const text = 'Petición sintética E2E: repasar vocabulario musical mañana.';
  const reply = 'Respuesta sintética de recuperación: puedes practicar canciones y conciertos.';
  let attempts = 0;
  await page.route('**/api/companion', async route => {
    if (route.request().method() !== 'POST') {
      if (attempts < 2) return route.continue();
      return route.fulfill({ json: { messages: [...history.messages, { id: -1, role: 'user', text, ts: Date.now() / 1000 }, { id: -2, role: 'assistant', text: reply, ts: Date.now() / 1000 }] } });
    }
    attempts += 1;
    expect(route.request().postDataJSON()).toEqual({ text });
    await route.fulfill(attempts === 1
      ? { status: 503, json: { error: 'Fallo sintético E2E: asistente temporalmente no disponible.' } }
      : { json: { reply, memories_saved: 0 } });
  });
  await page.goto('/');
  await navigate(page, 'companion');
  await page.locator('#companion-input').fill(text);
  await page.locator('#companion-send').click();
  await expect(page.locator('#companion-status')).toContainText(/fallo|no disponible/i);
  await expect(page.locator('#companion-input')).toHaveValue(text);
  await expect(page.locator('#companion-send')).toBeEnabled();
  expect(attempts).toBe(1);
  expect(await json(await request.get('/api/companion'))).toEqual(history);
  await screenshot(page, testInfo, 'personal-assistant-503-recoverable');
  await page.locator('#companion-send').click();
  await expect(page.locator('#companion-messages .companion-message.assistant .companion-text').last()).toHaveText(reply);
  await expect(page.locator('#companion-input')).toHaveValue('');
  await expect(page.locator('#companion-send')).toBeEnabled();
  expect(attempts).toBe(2);
  expect(await json(await request.get('/api/companion'))).toEqual(history);
});

for (const width of [320, 390]) {
  test(`Asistente móvil ${width}px: navegación, memoria extensa y tema personalizado accesibles`, async ({ page, request }, testInfo) => {
    await requireSyntheticCodex(request);
    await page.setViewportSize({ width, height: 844 });
    const syntheticMemory = await json(await request.post('/api/memory', { data: {
      category: 'aprendizaje',
      content: 'Memoria móvil sintética E2E: ' + 'Quiero repasar gramática cotidiana y vocabulario para conversar sobre música, conciertos y peluquería. '.repeat(5),
    } }));
    await page.goto('/');
    await navigate(page, 'home');
    let attempts = 0;
    await page.route('**/api/sessions', route => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts += 1;
      return route.fulfill({ status: 503, json: { error: 'No crear sesiones en este control de navegación.' } });
    });
    await page.locator('.topic-presets [data-topic="peluqueria"]').click();
    await expect(page.locator('#practice-topic')).not.toHaveValue('');
    for (const selector of ['#practice-topic', '#topic-mode']) {
      expect((await page.locator(selector).boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    await page.locator('#practice-topic').fill('');
    await page.locator('#topic-start').click();
    expect(attempts, 'Un tema vacío no dispara IA.').toBe(0);
    await screenshot(page, testInfo, `personal-mobile-${width}-topics`);
    await navigate(page, 'companion');
    await expect(page.locator('#companion-input')).toBeVisible();
    await page.locator('#companion-memory').click();
    expect((await page.locator('#memory-category').boundingBox()).height).toBeGreaterThanOrEqual(44);
    const row = page.locator(`[data-memory-id="${syntheticMemory.id}"]`);
    await expect(row.locator('.memory-content')).toHaveText(syntheticMemory.content);
    await expect(row.locator('.memory-edit')).toBeVisible();
    await expect(row.locator('.memory-forget')).toBeVisible();
    await row.locator('.memory-edit').scrollIntoViewIfNeeded();
    await expect(row.locator('.memory-edit')).toBeInViewport();
    await expect(row.locator('.memory-forget')).toBeInViewport();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      mainVisible: document.querySelector('#main').clientWidth,
      mainContent: document.querySelector('#main').scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.mainContent).toBeLessThanOrEqual(dimensions.mainVisible + 1);
    await screenshot(page, testInfo, `personal-mobile-${width}-memory`);
    await testInfo.attach('personal-mobile-layout', { body: JSON.stringify(dimensions), contentType: 'application/json' });
    await json(await request.delete(`/api/memory/${syntheticMemory.id}`));
  });
}

async function exportSnapshot(baseURL) {
  // Native fetch keeps SQLite payloads out of Playwright's network trace resources.
  const response = await fetch(new URL('/api/backup/export', baseURL));
  expect(response.ok, 'El endpoint real debe exportar el snapshot sintético.').toBe(true);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.subarray(0, 16).toString()).toBe('SQLite format 3\u0000');
  return bytes;
}

async function importSnapshot(baseURL, bytes) {
  const multipart = new FormData();
  multipart.set('file', new Blob([bytes], { type: 'application/octet-stream' }), 'synthetic-kaiwa.db');
  const response = await fetch(new URL('/api/backup/import', baseURL), { method: 'POST', body: multipart });
  expect(response.ok, 'El endpoint real debe restaurar el snapshot sintético.').toBe(true);
  expect(await response.json()).toEqual({ ok: true });
}

async function legacySnapshot(modern, directory) {
  const path = join(directory, 'legacy-synthetic.db');
  await writeFile(path, modern);
  const script = `
import json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as database:
    for table in ('personal_memories', 'companion_messages', 'memory_context_state'):
        database.execute('DROP TABLE ' + table)
    integrity = database.execute('PRAGMA integrity_check').fetchone()[0]
    tables = sorted(row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'"))
print(json.dumps({'integrity': integrity, 'tables': tables}))
`;
  const run = promisify(execFile);
  const python = resolve(import.meta.dirname, '../../.venv/bin/python');
  const { stdout } = await run(python, ['-c', script, path]);
  const metadata = JSON.parse(stdout);
  expect(metadata.integrity).toBe('ok');
  for (const table of ['personal_memories', 'companion_messages', 'memory_context_state']) {
    expect(metadata.tables).not.toContain(table);
  }
  return { bytes: await readFile(path), metadata };
}

function snapshotFingerprint(bytes) {
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

test('Backup real: memoria e historial exactos y migración de snapshot antiguo', async ({ request }, testInfo) => {
  await requireSyntheticCodex(request);
  const baseURL = testInfo.project.use.baseURL;
  const initialMemory = await json(await request.get('/api/memory'));
  const initialHistory = await json(await request.get('/api/companion'));
  expect(initialHistory.messages.length, 'Ejecutar después del recorrido real del asistente.').toBeGreaterThan(0);
  const original = await exportSnapshot(baseURL);
  const directory = await mkdtemp(join(tmpdir(), 'kaiwa-backup-e2e-'));
  try {
    const memory = await json(await request.post('/api/memory', { data: {
      category: 'planes', content: 'Memoria sintética E2E para verificar exportación y recuperación exacta.',
    } }));
    const expectedMemory = await json(await request.get('/api/memory'));
    const modern = await exportSnapshot(baseURL);
    await json(await request.put(`/api/memory/${memory.id}`, { data: {
      category: 'planes', content: 'Cambio sintético posterior al snapshot: debe desaparecer al restaurarlo.',
    } }));
    expect((await memories(request)).find(item => item.id === memory.id).content).not.toBe(memory.content);
    await importSnapshot(baseURL, modern);
    expect(await json(await request.get('/api/memory'))).toEqual(expectedMemory);
    expect(await json(await request.get('/api/companion'))).toEqual(initialHistory);
    const legacy = await legacySnapshot(modern, directory);
    await importSnapshot(baseURL, legacy.bytes);
    expect(await memories(request)).toEqual([]);
    expect(await json(await request.get('/api/companion'))).toEqual({ messages: [] });
    const migrated = await json(await request.post('/api/memory', { data: {
      category: 'aprendizaje', content: 'Recuerdo sintético guardado después de migrar el backup antiguo.',
    } }));
    expect(migrated.source).toBe('user');
    expect((await memories(request)).find(item => item.id === migrated.id).content).toBe(migrated.content);
    await testInfo.attach('personal-backup-migration-evidence', {
      body: JSON.stringify({
        original: snapshotFingerprint(original), modern: snapshotFingerprint(modern),
        legacy: snapshotFingerprint(legacy.bytes), legacyMetadata: legacy.metadata,
        expectedMemories: expectedMemory.memories.length, expectedHistoryMessages: initialHistory.messages.length,
        modernExactRecovery: true, legacyEmptyCollections: true, legacyCanCreateMemory: true,
      }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    try {
      await importSnapshot(baseURL, original);
      expect(await json(await request.get('/api/memory'))).toEqual(initialMemory);
      expect(await json(await request.get('/api/companion'))).toEqual(initialHistory);
      await requireSyntheticCodex(request);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
