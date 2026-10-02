/* Personal assistant, editable memory and practice topics. */
"use strict";

const personalState = { messages: [], memories: [], editingId: null, sending: false };
const memoryCategories = { personal: "Sobre mí", intereses: "Intereses", aprendizaje: "Aprendizaje", planes: "Planes" };
const practiceTopics = {
  peluqueria: { text: "Ir a cortarme el pelo: explicar el corte y entender al peluquero", mode: "roleplay" },
  musica: { text: "Música: hablar de lo que escucho y descubrir vocabulario", mode: "lesson" },
  gramatica: { text: "Repasar gramática que ya he estudiado, con ejemplos y ejercicios a mi nivel", mode: "lesson" },
  vocabulario: { text: "Aprender vocabulario útil y usarlo en frases sobre mis intereses", mode: "lesson" },
};

async function loadCompanion() {
  const [conversation, memory] = await Promise.all([api.get("/api/companion"), api.get("/api/memory")]);
  personalState.messages = conversation.messages;
  renderCompanionMessages();
  renderMemories(memory);
}

function renderCompanionMessages() {
  const container = $("#companion-messages");
  if (!personalState.messages.length) {
    container.innerHTML = `<div class="companion-welcome"><h2>Empieza por lo que te importa.</h2><p>Puedo ayudarte a repasar gramática, preparar la peluquería o practicar con música. Cuéntame tus intereses y lo que necesitas: iremos construyendo tu memoria.</p></div>`;
    return;
  }
  container.innerHTML = personalState.messages.map(message =>
    `<article class="companion-message ${message.role}"><p class="companion-speaker">${message.role === "user" ? "Tú" : "Kaiwa · Tu asistente"}</p><div class="companion-text">${esc(message.text)}</div><time datetime="${new Date(message.ts * 1000).toISOString()}">${new Date(message.ts * 1000).toLocaleString("es-ES")}</time></article>`
  ).join("");
  container.scrollTop = container.scrollHeight;
}

function selectCompanionPanel(panel) {
  const memory = panel === "memory";
  $("#companion-chat-panel").classList.toggle("hidden", memory);
  $("#companion-memory-panel").classList.toggle("hidden", !memory);
  $("#companion-chat").setAttribute("aria-pressed", String(!memory));
  $("#companion-memory").setAttribute("aria-pressed", String(memory));
  if (!memory) $("#companion-messages").scrollTop = $("#companion-messages").scrollHeight;
}
$("#companion-chat").addEventListener("click", () => selectCompanionPanel("chat"));
$("#companion-memory").addEventListener("click", () => selectCompanionPanel("memory"));

function reportPersonalStatus(selector, text, isError = false) {
  const status = $(selector);
  status.textContent = text;
  status.classList.toggle("error", isError);
}

$("#companion-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#companion-input");
  const text = input.value.trim();
  if (!text || personalState.sending) return;
  personalState.sending = true;
  $("#companion-send").disabled = true;
  $("#companion-form").setAttribute("aria-busy", "true");
  reportPersonalStatus("#companion-status", "Tu asistente está preparando la respuesta…");
  let completed = false;
  try {
    const result = await writeJson("/api/companion", "POST", { text });
    completed = true;
    if (input.value.trim() === text) input.value = "";
    await loadCompanion();
    reportPersonalStatus("#companion-status", result.memories_saved ? `Respuesta guardada. ${result.memories_saved} recuerdo${result.memories_saved === 1 ? "" : "s"} actualizado${result.memories_saved === 1 ? "" : "s"} en Tu memoria.` : "Respuesta guardada en tu historial.");
  } catch (error) {
    const recovery = completed ? "La respuesta se guardó; vuelve a abrir el asistente para cargarla." : "Tu texto sigue aquí; vuelve a enviar para reintentar.";
    reportPersonalStatus("#companion-status", `${error.message} ${recovery}`, true);
  } finally {
    personalState.sending = false;
    $("#companion-send").disabled = false;
    $("#companion-form").setAttribute("aria-busy", "false");
    if (!$("#view-companion").classList.contains("hidden")) input.focus();
  }
});

$(".companion-suggestions").addEventListener("click", event => {
  const button = event.target.closest("[data-coach-prompt]");
  if (!button) return;
  $("#companion-input").value = button.dataset.coachPrompt;
  $("#companion-input").focus();
});

function renderMemories(data) {
  personalState.memories = data.memories;
  $("#memory-history-count").textContent = `${data.message_count} mensaje${data.message_count === 1 ? "" : "s"} conservado${data.message_count === 1 ? "" : "s"} en tu historial.`;
  $("#memory-list").innerHTML = data.memories.length ? data.memories.map(memory =>
    `<article class="memory-item" data-memory-id="${memory.id}"><p class="memory-meta">${memoryCategories[memory.category] || "Sobre mí"} · ${memory.source === "user" ? "Guardado por ti" : "Conversación con tu asistente"}</p><p class="memory-content">${esc(memory.content)}</p><div class="memory-item-actions"><small>Actualizado el ${new Date(memory.updated_at * 1000).toLocaleDateString("es-ES")}</small><button type="button" class="btn small memory-edit" aria-label="Editar recuerdo: ${esc(memory.content)}">Editar</button><button type="button" class="btn small memory-forget" aria-label="Olvidar recuerdo: ${esc(memory.content)}">Olvidar</button></div></article>`
  ).join("") : `<div class="empty-state"><h3>Tu memoria empieza contigo</h3><p>Escribe un recuerdo o cuéntale al asistente algo importante sobre ti.</p></div>`;
}

function cancelMemoryEdit() {
  personalState.editingId = null;
  $("#memory-form").reset();
  $("#memory-save").textContent = "Guardar recuerdo";
  $("#memory-cancel").classList.add("hidden");
}
$("#memory-cancel").addEventListener("click", cancelMemoryEdit);

$("#memory-form").addEventListener("submit", async event => {
  event.preventDefault();
  const content = $("#memory-content").value.trim();
  if (!content) return;
  const editingId = personalState.editingId;
  $("#memory-save").disabled = true;
  reportPersonalStatus("#memory-status", "Guardando tu recuerdo…");
  try {
    await writeJson(editingId ? `/api/memory/${editingId}` : "/api/memory", editingId ? "PUT" : "POST", { category: $("#memory-category").value, content });
    renderMemories(await api.get("/api/memory"));
    cancelMemoryEdit();
    reportPersonalStatus("#memory-status", "Recuerdo guardado. Tu asistente lo tendrá presente.");
  } catch (error) {
    reportPersonalStatus("#memory-status", `No se pudo guardar: ${error.message} El recuerdo sigue en el formulario; puedes reintentar.`, true);
  } finally { $("#memory-save").disabled = false; }
});

$("#memory-list").addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  const id = Number(button.closest("[data-memory-id]").dataset.memoryId);
  const memory = personalState.memories.find(item => item.id === id);
  if (!memory) return;
  if (button.classList.contains("memory-edit")) {
    personalState.editingId = id;
    $("#memory-category").value = memory.category;
    $("#memory-content").value = memory.content;
    $("#memory-save").textContent = "Guardar cambios";
    $("#memory-cancel").classList.remove("hidden");
    $("#memory-content").focus();
    return;
  }
  if (!confirm("¿Olvidar este recuerdo? Dejará de usarse como un hecho vigente sobre ti. El historial original seguirá guardado en tu base local.")) return;
  button.disabled = true;
  try {
    await writeJson(`/api/memory/${id}`, "DELETE", {});
    renderMemories(await api.get("/api/memory"));
    if (personalState.editingId === id) cancelMemoryEdit();
    reportPersonalStatus("#memory-status", "Recuerdo olvidado. Tu historial original se conserva.");
  } catch (error) {
    button.disabled = false;
    reportPersonalStatus("#memory-status", `No se pudo olvidar: ${error.message} Puedes reintentar.`, true);
  }
});

$(".topic-presets").addEventListener("click", event => {
  const preset = practiceTopics[event.target.closest("[data-topic]")?.dataset.topic];
  if (!preset) return;
  $("#practice-topic").value = preset.text;
  $("#topic-mode").value = preset.mode;
  $("#practice-topic").focus();
});
$("#topic-form").addEventListener("submit", event => {
  event.preventDefault();
  const topic = $("#practice-topic").value.trim();
  if (!topic) return;
  const mode = $("#topic-mode").value;
  startSession(mode, { custom: { title: topic, setting: topic, description: `Practicar este tema: ${topic}. Usar el nivel y la memoria del estudiante.`, ai_role: mode === "lesson" ? "Tutor que enseña paso a paso" : "Interlocutor apropiado para la situación elegida", user_role: "Estudiante que se expresa por sí mismo" } });
});
document.querySelectorAll("[data-view-link]").forEach(button => button.addEventListener("click", () => show(button.dataset.viewLink)));
