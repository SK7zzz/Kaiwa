"use strict";

let codexCall = null;

function codexVoiceActive() {
  return codexCall !== null;
}

async function startCodexCall() {
  if (codexVoiceActive()) return;
  if (state.session) return guardActiveSession(startCodexCall);
  const current = {
    peer: null, socket: null, stream: null, audio: new Audio(),
    channel: null, timer: null, muted: false, captions: true,
    ending: false, failed: false, ready: false, stopComplete: null,
    sessionStarted: false, awaitSession: null,
  };
  codexCall = current;
  $("#call-caption").textContent = "";
  $("#call-overlay").classList.remove("hidden", "no-cc");
  $("#call-mute").classList.remove("muted-on");
  $("#call-mute").innerHTML = icon("mic");
  $("#call-cc").classList.add("active");
  $("#call-timer").textContent = "0:00";
  callStatus("thinking", "Preparando el micrófono…");
  try {
    current.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (codexCall !== current || current.ending) {
      current.stream.getTracks().forEach(track => track.stop());
      return;
    }
    current.stream.getAudioTracks().forEach(track => { track.enabled = !current.muted; });
    const session = await api.post("/api/sessions", { mode: "call" });
    if (!session.session_id) throw new Error(session.error || "No se pudo iniciar la sesión.");
    if (codexCall !== current || current.ending) {
      await api.post(`/api/sessions/${session.session_id}/end`);
      return;
    }
    state.session = { ...session, mode: "call" };
    current.audio.autoplay = true;
    current.audio.src = SILENT_WAV;
    await current.audio.play();
    await connectCodexVoice(current, session.session_id);
  } catch (error) {
    if (codexCall !== current || current.ending) return;
    const message = error.name === "NotAllowedError"
      ? "Permite el micrófono en el navegador para practicar por voz."
      : error.message || "No se pudo conectar la llamada.";
    failCodexVoice(current, message);
  }
}

async function connectCodexVoice(current, sessionId) {
  if (current.ending || codexCall !== current) return;
  callStatus("thinking", "Conectando GPT Live con tu suscripción…");
  current.peer = new RTCPeerConnection();
  current.stream.getTracks().forEach(track => current.peer.addTrack(track, current.stream));
  current.peer.ontrack = event => {
    current.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
    current.audio.play().catch(() => failCodexVoice(current, "Toca la pantalla y vuelve a conectar para activar el audio."));
  };
  current.peer.onconnectionstatechange = () => {
    if (current.peer.connectionState === "failed") {
      failCodexVoice(current, "Se perdió la conexión de audio. Cierra y vuelve a iniciar la llamada.");
    }
  };
  current.channel = current.peer.createDataChannel("oai-events");
  current.channel.onmessage = event => updateCodexVoiceActivity(current, event.data);
  await current.peer.setLocalDescription(await current.peer.createOffer());
  if (current.ending || codexCall !== current) return;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  current.socket = new WebSocket(`${scheme}//${location.host}/api/codex/voice`);
  await negotiateCodexVoice(current, sessionId);
  if (current.ending || codexCall !== current) return;
  await waitForCodexVoiceSession(current);
  if (current.ending || codexCall !== current) return;
  current.ready = true;
  current.socket.send(JSON.stringify({ type: "ready" }));
  callStatus(current.muted ? "muted" : "listening",
    current.muted ? "Micrófono silenciado" : "Habla en japonés. Kaiwa te escucha.");
  const startedAt = Date.now();
  current.timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    $("#call-timer").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }, 1000);
}

function waitForCodexVoiceSession(current) {
  if (current.sessionStarted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clear = () => { clearTimeout(timeout); current.awaitSession = null; };
    const timeout = setTimeout(() => {
      clear();
      reject(new Error("GPT Live no ha preparado la conversación. Cierra y vuelve a conectar."));
    }, 30000);
    current.awaitSession = {
      resolve: () => { clear(); resolve(); },
      reject: error => { clear(); reject(error); },
    };
  });
}

function negotiateCodexVoice(current, sessionId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("La llamada tardó demasiado en conectar. Vuelve a intentarlo.")), 60000);
    current.socket.onopen = () => current.socket.send(JSON.stringify({
      type: "start", session_id: sessionId, sdp: current.peer.localDescription.sdp,
    }));
    current.socket.onmessage = async event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "answer") {
          await current.peer.setRemoteDescription({ type: "answer", sdp: message.sdp });
          clearTimeout(timeout);
          resolve();
        } else if (message.type === "error") {
          clearTimeout(timeout);
          reject(new Error(message.message));
          failCodexVoice(current, message.message);
        } else if (message.type === "transcript") {
          $("#call-caption").textContent = message.text;
          $("#call-caption").classList.toggle("user", message.role === "user");
        } else if (message.type === "stopped") {
          current.stopComplete?.();
        } else if (message.type === "closed" && !current.ending) {
          failCodexVoice(current, "La llamada ha terminado. Cierra para ver el resumen.");
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
        failCodexVoice(current, "No se pudo preparar el audio de la llamada.");
      }
    };
    current.socket.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("No se pudo conectar con Kaiwa. Comprueba que el servidor sigue abierto."));
    };
    current.socket.onclose = () => {
      clearTimeout(timeout);
      current.stopComplete?.();
      if (current.ending) return;
      reject(new Error("Se cerró la conexión de voz."));
      failCodexVoice(current, "Se cerró la conexión. Puedes terminar y conservar la conversación.");
    };
  });
}

function updateCodexVoiceActivity(current, payload) {
  if (codexCall !== current || current.ending) return;
  try {
    const event = JSON.parse(payload);
    if (event.type === "session.started") {
      current.sessionStarted = true;
      current.awaitSession?.resolve();
    } else if (event.type === "input_transcript.added" || event.type === "input_audio_buffer.speech_started") {
      callStatus("listening", "Te escucho…");
    } else if (event.type === "output_transcript.added" || event.type === "output_audio_buffer.started") {
      callStatus("speaking", "Kaiwa está hablando…");
    } else if (event.type === "turn.done" || event.type === "output_audio_buffer.stopped") {
      callStatus(current.muted ? "muted" : "listening", current.muted ? "Micrófono silenciado" : "Tu turno. Habla cuando quieras.");
    }
  } catch {
    failCodexVoice(current, "La llamada recibió una respuesta de audio inesperada.");
  }
}

function releaseCodexVoice(current) {
  current.awaitSession?.reject(new Error("La llamada se ha cerrado."));
  clearInterval(current.timer);
  current.stream?.getTracks().forEach(track => track.stop());
  current.audio.pause();
  current.audio.srcObject = null;
  current.peer?.close();
}

function failCodexVoice(current, message) {
  if (codexCall !== current || current.ending || current.failed) return;
  current.failed = true;
  releaseCodexVoice(current);
  current.socket?.close();
  callStatus("", "No se pudo mantener la llamada");
  $("#call-caption").textContent = message;
}

async function endCodexCall() {
  const current = codexCall;
  if (!current || current.ending) return;
  current.ending = true;
  releaseCodexVoice(current);
  if (current.socket?.readyState === WebSocket.OPEN) {
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 5000);
      current.stopComplete = () => { clearTimeout(timeout); resolve(); };
      current.socket.send(JSON.stringify({ type: "stop" }));
    });
  }
  current.socket?.close();
  codexCall = null;
  $("#call-overlay").classList.add("hidden");
  if (state.session) await showSessionSummary();
}

$("#call-mute").addEventListener("click", event => {
  if (!codexCall) return;
  event.stopImmediatePropagation();
  codexCall.muted = !codexCall.muted;
  codexCall.stream?.getAudioTracks().forEach(track => { track.enabled = !codexCall.muted; });
  $("#call-mute").innerHTML = icon(codexCall.muted ? "mic-off" : "mic");
  $("#call-mute").classList.toggle("muted-on", codexCall.muted);
  callStatus(codexCall.muted ? "muted" : "listening", codexCall.muted ? "Micrófono silenciado" : "Habla cuando quieras.");
}, true);

$("#call-cc").addEventListener("click", event => {
  if (!codexCall) return;
  event.stopImmediatePropagation();
  codexCall.captions = !codexCall.captions;
  $("#call-cc").classList.toggle("active", codexCall.captions);
  $("#call-overlay").classList.toggle("no-cc", !codexCall.captions);
}, true);

$("#call-avatar").addEventListener("click", event => {
  if (!codexCall) return;
  event.stopImmediatePropagation();
  callStatus("listening", "Habla para intervenir en la conversación.");
}, true);

window.addEventListener("pagehide", () => {
  if (!codexCall) return;
  codexCall.ending = true;
  releaseCodexVoice(codexCall);
  codexCall.socket?.close();
});
