import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function installVoiceDiagnostics(page, speech) {
  const wav = readFileSync(speech.path);
  const diagnostic = {
    startedAt: Date.now(),
    fixture: { ...speech, bytes: wav.length, sha256: createHash('sha256').update(wav).digest('hex') },
    websocket: [],
  };
  page.on('websocket', socket => {
    if (!socket.url().endsWith('/api/codex/voice')) return;
    for (const event of ['framesent', 'framereceived']) {
      socket.on(event, frame => {
        let message;
        try { message = JSON.parse(String(frame.payload)); } catch { message = { type: 'non-json' }; }
        diagnostic.websocket.push({
          elapsedMs: Date.now() - diagnostic.startedAt,
          direction: event === 'framesent' ? 'sent' : 'received',
          type: typeof message.type === 'string' ? message.type : 'unknown',
          role: ['user', 'assistant'].includes(message.role) ? message.role : undefined,
          textLength: typeof message.text === 'string' ? message.text.length : undefined,
        });
      });
    }
    socket.on('close', () => diagnostic.websocket.push({
      elapsedMs: Date.now() - diagnostic.startedAt, type: 'socket-closed',
    }));
  });
  await page.addInitScript(() => {
    window.__voiceDiagnostic = { startedAt: Date.now(), microphone: [], peer: [], channel: [], samples: [] };
    const record = (category, details) => window.__voiceDiagnostic[category].push({
      elapsedMs: Date.now() - window.__voiceDiagnostic.startedAt, ...details,
    });
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      record('microphone', { type: 'requested' });
      const stream = await getUserMedia(constraints);
      record('microphone', { type: 'ready', audioTracks: stream.getAudioTracks().length });
      return stream;
    };
    function observeChannel(channel) {
      channel.addEventListener('open', () => record('channel', { type: 'open' }));
      channel.addEventListener('message', event => {
        try { record('channel', { type: JSON.parse(event.data).type || 'unknown' }); }
        catch { record('channel', { type: 'non-json' }); }
      });
    }
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(configuration) {
        super(configuration);
        this.addEventListener('connectionstatechange', () => record('peer', { type: 'connection', state: this.connectionState }));
        this.addEventListener('iceconnectionstatechange', () => record('peer', { type: 'ice', state: this.iceConnectionState }));
        this.addEventListener('datachannel', event => observeChannel(event.channel));
        this.addEventListener('track', event => record('peer', { type: 'remote-track', kind: event.track.kind }));
        const timer = setInterval(async () => {
          if (this.connectionState === 'closed') { clearInterval(timer); return; }
          const reports = await this.getStats();
          const metrics = [...reports.values()]
            .filter(report => report.kind === 'audio' && ['inbound-rtp', 'outbound-rtp', 'media-source'].includes(report.type))
            .map(({ type, bytesSent, bytesReceived, packetsSent, packetsReceived, totalAudioEnergy, audioLevel, totalSamplesDuration }) =>
              ({ type, bytesSent, bytesReceived, packetsSent, packetsReceived, totalAudioEnergy, audioLevel, totalSamplesDuration }));
          record('samples', { metrics });
        }, 1000);
      }
      createDataChannel(label, options) {
        const channel = super.createDataChannel(label, options);
        observeChannel(channel);
        return channel;
      }
    };
  });
  return diagnostic;
}

export async function attachVoiceDiagnostics(page, request, testInfo, diagnostic) {
  let browser;
  try {
    browser = await page.evaluate(() => ({
      timeline: window.__voiceDiagnostic,
      sessionId: typeof state !== 'undefined' ? state.session?.session_id : null,
      caption: document.querySelector('#call-caption')?.textContent,
      connectionState: typeof codexCall !== 'undefined' ? codexCall?.peer?.connectionState : null,
      track: typeof codexCall !== 'undefined' && codexCall?.stream
        ? codexCall.stream.getAudioTracks().map(({ enabled, muted, readyState }) => ({ enabled, muted, readyState })) : [],
    }));
  } catch {
    browser = { unavailable: 'El contexto del navegador ya no está disponible.' };
  }
  let history = null;
  if (browser.sessionId) {
    try {
      const response = await request.get(`/api/sessions/${browser.sessionId}/messages`, { timeout: 5000 });
      history = response.ok() ? await response.json() : { unavailable: true, status: response.status() };
    } catch {
      history = { unavailable: 'El historial no respondió durante el diagnóstico.' };
    }
  }
  const result = { status: testInfo.status, expectedStatus: testInfo.expectedStatus, ...diagnostic, browser, history };
  await testInfo.attach('voice-diagnostics', {
    body: JSON.stringify(result, null, 2), contentType: 'application/json',
  });
}
