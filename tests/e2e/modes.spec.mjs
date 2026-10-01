import { test, expect } from './runtime.mjs';

const japanese = /[ぁ-んァ-ン一-龯]/;
const spanish = /\b(el|la|los|las|una|un|de|que|te|tu|qué|cómo|has|muy|bien|puedes|para|con|en)\b/i;

async function responseJson(response) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function requireSyntheticCodex(request) {
  const health = await responseJson(await request.get('/api/health'));
  expect(health.provider).toBe('codex');
  expect(health.llm_ready).toBe(true);
  const profile = await responseJson(await request.get('/api/profile'));
  expect(profile.name, 'Estos E2E requieren la base sintética; nunca ejecutar sobre el perfil personal.').toBe('Ado E2E');
  expect(profile.settings.auto_play).toBe(false);
}

async function attachScreenshot(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function attachResults(testInfo, content) {
  await testInfo.attach('real-mode-learning-results', {
    body: Buffer.from(JSON.stringify(content, null, 2)),
    contentType: 'application/json',
  });
}

async function openScenario(page, scenarioId) {
  const started = page.waitForResponse(response => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
  await page.locator(`.scen-card[data-id="${scenarioId}"]`).click();
  const session = await responseJson(await started);
  await expect(page.locator('#view-chat')).toBeVisible();
  await expect(page.locator('#messages .ai .act-trans')).toHaveCount(1);
  await expect(page.locator('#messages .ai .bubble').first()).toContainText(japanese);
  return session.session_id;
}

async function translateMessage(page, selector) {
  const response = page.waitForResponse(item => item.url().endsWith('/api/translate'));
  await page.locator(`${selector} .act-trans`).click();
  const result = await responseJson(await response);
  expect(result.translation).toMatch(spanish);
  await expect(page.locator(`${selector} .trans-line`)).toHaveText(result.translation);
  return result.translation;
}

async function closeWithReport(page, sessionId, button) {
  const response = page.waitForResponse(item => item.url().endsWith(`/api/sessions/${sessionId}/end`));
  await page.locator(button).click();
  await expect(page.locator('#summary-modal')).toBeVisible();
  const summary = await responseJson(await response);
  expect(summary.summary).toMatch(spanish);
  expect(summary.stats.turns).toBeGreaterThan(0);
  await expect(page.locator('#summary-inner')).toContainText(summary.summary);
  await page.locator('#sum-close').click();
  await expect(page.locator('#summary-modal')).toBeHidden();
  await expect(page.locator('#view-home')).toBeVisible();
  return summary;
}

for (const scenario of [
  { id: 'ramen', mode: 'roleplay', title: 'Pedir ramen', reply: 'ラーメンを一つください。おすすめは何ですか。' },
  { id: 'greetings', mode: 'lesson', title: 'Saludos y cortesía', reply: 'こんにちは。ありがとうございます。すみません。' },
]) {
  test(`Codex real: ${scenario.mode} ${scenario.id} → respuesta → traducción ES → informe`, async ({ page, request }, testInfo) => {
    await requireSyntheticCodex(request);
    await page.goto('/');
    await expect(page.locator('#onboard-modal')).toBeHidden();
    const sessionId = await openScenario(page, scenario.id);
    await expect(page.locator('#chat-title')).toHaveText(scenario.title);
    await page.locator('#chat-input').fill(scenario.reply);
    await page.locator('#send-btn').click();
    await expect(page.locator('#messages .ai .act-trans')).toHaveCount(2);
    await expect(page.locator('#messages .user .bubble')).toHaveText(scenario.reply);
    const translation = await translateMessage(page, '#messages .ai:last-child');
    await attachScreenshot(page, testInfo, `${scenario.id}-conversation`);
    const summary = await closeWithReport(page, sessionId, '#end-session');
    const history = await responseJson(await request.get(`/api/sessions/${sessionId}/messages`));
    expect(history.messages.filter(message => message.role === 'user')).toHaveLength(1);
    await attachResults(testInfo, { scenarioId: scenario.id, sessionId, translation, summary, messages: history.messages });
  });
}

test('Codex real: lectura hiragana → tres preguntas respondidas → cierre e informe', async ({ page, request }, testInfo) => {
  test.setTimeout(720_000);
  await requireSyntheticCodex(request);
  await page.goto('/');
  await page.locator('#card-story').click();
  await expect(page.locator('#story-modal')).toBeVisible();
  await page.locator('#st-topic').fill('Datos sintéticos: un gato que pasea por un parque');
  await page.locator('#st-script [data-s="hiragana"]').click();
  const started = page.waitForResponse(response => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
  await page.locator('#st-start').click();
  const session = await responseJson(await started);
  const sessionId = session.session_id;
  await expect(page.locator('#view-reader')).toBeVisible();
  await expect(page.locator('.reader-page.story .reader-cta')).toBeVisible();
  const title = await page.locator('.reader-page.story .story-title').innerText();
  const story = await page.locator('.reader-page.story .story-body').innerText();
  expect(title).toMatch(/[ぁ-ん]/);
  expect(story.startsWith(title), 'El cuerpo no debe repetir el título al comienzo.').toBe(false);
  const storedStory = await responseJson(await request.get(`/api/sessions/${sessionId}/messages`));
  expect(storedStory.messages[0].text, 'El texto persistido debe conservar el salto entre título e historia.').toContain('\n');
  expect(story.length).toBeGreaterThan(30);
  expect(story).toMatch(/[ぁ-ん]/);
  expect(story, 'El modo hiragana no debe mostrar kanji ni katakana en la historia.').not.toMatch(/[ァ-ヶ一-龯]/);
  const translation = await translateMessage(page, '.reader-page.story');
  await attachScreenshot(page, testInfo, 'hiragana-story-with-spanish-translation');
  await page.locator('.reader-page.story .reader-cta button').click();
  const questions = [];
  for (let question = 1; question <= 3; question += 1) {
    const quizPage = page.locator('.reader-page.quiz').nth(question - 1);
    await expect(quizPage).toBeVisible();
    await expect(quizPage.locator('.quiz-answer')).toBeVisible();
    await expect(quizPage.locator('.quiz-label')).toContainText(`Pregunta ${question}`);
    const questionText = await quizPage.locator('.quiz-body').innerText();
    expect(questionText).toMatch(japanese);
    const hints = await responseJson(await request.post('/api/hint', { data: { session_id: sessionId } }));
    expect(hints.suggestions.length).toBeGreaterThan(0);
    const answer = hints.suggestions[0].japanese;
    expect(answer).toMatch(japanese);
    await quizPage.locator('.quiz-answer input').fill(answer);
    await quizPage.locator('.quiz-answer button').click();
    await expect(quizPage.locator('.your-answer')).toContainText(answer);
    questions.push({ question: questionText, answer, hints: hints.suggestions });
  }
  const completion = page.locator('.reader-page.quiz').nth(3);
  await expect(completion).toBeVisible();
  await expect(completion.locator('.rd-finish')).toBeVisible();
  await expect(completion.locator('.quiz-label')).toContainText('Lectura completada');
  await attachScreenshot(page, testInfo, 'hiragana-reading-three-answers-complete');
  await page.locator('#rd-prev').click();
  await expect(page.locator('.reader-page.quiz').nth(2)).toBeVisible();
  await page.locator('#rd-next').click();
  await expect(completion).toBeVisible();
  const summary = await closeWithReport(page, sessionId, '.rd-finish');
  expect(summary.stats.turns).toBe(4);
  const history = await responseJson(await request.get(`/api/sessions/${sessionId}/messages`));
  expect(history.messages.filter(message => message.role === 'assistant')).toHaveLength(5);
  expect(history.messages.filter(message => message.role === 'user')).toHaveLength(4);
  await attachResults(testInfo, { sessionId, title, story, translation, questions, summary, messages: history.messages });
});
