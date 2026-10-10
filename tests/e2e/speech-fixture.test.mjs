import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeSpeechFixture } from './speech-fixture.mjs';

function sourceWave({ seconds = 2, silent = false, channels = 1, rate = 48_000, format = 1, bits = 16 } = {}) {
  const samples = Math.floor(seconds * rate);
  const pcm = Buffer.alloc(samples * 2);
  if (!silent) {
    for (let sample = 0; sample < samples; sample += 1) {
      pcm.writeInt16LE(Math.round(Math.sin(sample * Math.PI / 60) * 8000), sample * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(format, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * bits / 8, 28);
  header.writeUInt16LE(channels * bits / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function withSource(wav, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'kaiwa-speech-contract-'));
  const source = join(directory, 'external.wav');
  writeFileSync(source, wav);
  const previous = process.env.KAIWA_E2E_VOICE_SOURCE_WAV;
  process.env.KAIWA_E2E_VOICE_SOURCE_WAV = source;
  try { callback({ source, output: join(directory, 'output') }); }
  finally {
    if (previous === undefined) delete process.env.KAIWA_E2E_VOICE_SOURCE_WAV;
    else process.env.KAIWA_E2E_VOICE_SOURCE_WAV = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

test('Fuente externa conserva PCM, identidad SHA-256 y padding, sin ejecutar macOS', () => {
  const wav = sourceWave();
  withSource(wav, ({ output }) => {
    const result = makeSpeechFixture(output);
    assert.equal(result.sourceSha256, createHash('sha256').update(wav).digest('hex'));
    assert.equal(result.voice, 'external-pcm-wav');
    assert.equal(result.speechSeconds, 2);
    assert.equal(result.totalSeconds, 24);
    assert.ok(result.speechRms > 0);
    const padded = readFileSync(result.path);
    assert.equal(padded.length, 44 + 24 * 48_000 * 2);
    assert.deepEqual(padded.subarray(44 + 12 * 48_000 * 2, 44 + 14 * 48_000 * 2), wav.subarray(44));
    assert.equal(result.sha256, createHash('sha256').update(padded).digest('hex'));
  });
});

for (const [name, wav, error] of [
  ['datos vacíos', sourceWave({ seconds: 0 }), /muestras|vacío/i],
  ['silencio', sourceWave({ silent: true }), /silencio|energía/i],
  ['frase demasiado corta', sourceWave({ seconds: 0.5 }), /duración|segundo/i],
  ['estéreo', sourceWave({ channels: 2 }), /PCM.*mono|mono.*PCM/i],
  ['frecuencia distinta', sourceWave({ rate: 24_000 }), /48000|48.000|48 kHz/i],
  ['PCM de 32 bits', sourceWave({ bits: 32 }), /16.*bits/i],
  ['formato float', sourceWave({ format: 3 }), /PCM/i],
  ['archivo truncado', sourceWave().subarray(0, 100), /truncado|incompleto/i],
  ['archivo ajeno a WAV', Buffer.from('not a waveform'), /RIFF|WAVE|WAV/i],
]) {
  test(`Rechaza ${name} antes de crear un falso micrófono`, () => {
    withSource(wav, ({ output }) => assert.throws(() => makeSpeechFixture(output), error));
  });
}
