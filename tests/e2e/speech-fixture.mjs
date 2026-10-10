import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const japaneseSpeech = 'こんにちは。私はアドです。ラーメンが好きです。';
const sampleRate = 48_000;
const bytesPerSample = 2;

function pcmData(wav) {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('La fuente de voz no es un archivo WAV RIFF/WAVE válido.');
  }
  const boundary = wav.readUInt32LE(4) + 8;
  if (boundary > wav.length) throw new Error('El archivo WAV de voz está truncado.');
  let format;
  let pcm;
  for (let offset = 12; offset + 8 <= boundary;) {
    const chunk = wav.toString('ascii', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > boundary) throw new Error('El archivo WAV contiene un chunk incompleto.');
    if (chunk === 'fmt ') format = wav.subarray(offset + 8, end);
    if (chunk === 'data') pcm = wav.subarray(offset + 8, end);
    offset = end + length % 2;
  }
  validateFormat(format);
  validateSamples(pcm);
  return pcm;
}

function validateSamples(pcm) {
  if (!pcm || !pcm.length || pcm.length % bytesPerSample) {
    throw new Error('El WAV de voz no contiene muestras PCM completas; está vacío o mal formado.');
  }
}

function validateFormat(format) {
  if (!format || format.length < 16) throw new Error('El WAV no contiene un formato PCM completo.');
  const valid = format.readUInt16LE(0) === 1 && format.readUInt16LE(2) === 1 &&
    format.readUInt32LE(4) === sampleRate && format.readUInt32LE(8) === sampleRate * bytesPerSample &&
    format.readUInt16LE(12) === bytesPerSample && format.readUInt16LE(14) === 16;
  if (!valid) throw new Error('La voz debe estar en PCM mono de 16 bits y 48000 Hz.');
}

function speechMetrics(pcm) {
  const seconds = pcm.length / sampleRate / bytesPerSample;
  if (seconds <= 1) throw new Error('La fuente de voz debe tener una duración mayor que un segundo.');
  let energy = 0;
  for (let offset = 0; offset < pcm.length; offset += bytesPerSample) {
    const sample = pcm.readInt16LE(offset) / 32768;
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / (pcm.length / bytesPerSample));
  if (rms <= 0) throw new Error('La fuente de voz sólo contiene silencio; no tiene energía de audio.');
  return { speechSeconds: seconds, speechRms: rms };
}

function sourceAudio(directory) {
  const external = process.env.KAIWA_E2E_VOICE_SOURCE_WAV;
  if (external) return { wav: readFileSync(external), voice: 'external-pcm-wav' };
  const aiff = resolve(directory, 'speech-source.aiff');
  const pcm = resolve(directory, 'speech-pcm.wav');
  execFileSync('/usr/bin/say', ['-v', 'Kyoko', '-r', '130', '-o', aiff, japaneseSpeech]);
  execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', aiff, pcm]);
  return { wav: readFileSync(pcm), voice: 'Kyoko' };
}

function waveHeader(dataLength) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(dataLength + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * bytesPerSample, 28);
  header.writeUInt16LE(bytesPerSample, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export function makeSpeechFixture(directory = process.env.KAIWA_E2E_VOICE_FIXTURE_DIR || resolve(tmpdir(), 'kaiwa-e2e-voice')) {
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, 'speech.wav');
  const source = sourceAudio(directory);
  const speech = pcmData(source.wav);
  const metrics = speechMetrics(speech);
  const leadingSeconds = 12;
  const trailingSeconds = 10;
  const audio = Buffer.concat([
    Buffer.alloc(leadingSeconds * sampleRate * bytesPerSample),
    speech,
    Buffer.alloc(trailingSeconds * sampleRate * bytesPerSample),
  ]);
  const wav = Buffer.concat([waveHeader(audio.length), audio]);
  writeFileSync(path, wav);
  const metadata = {
    path, voice: source.voice, speech: japaneseSpeech, sampleRate,
    channels: 1, bitsPerSample: 16, leadingSeconds, trailingSeconds,
    totalSeconds: audio.length / sampleRate / bytesPerSample,
    sourceSha256: createHash('sha256').update(source.wav).digest('hex'),
    sha256: createHash('sha256').update(wav).digest('hex'),
    ...metrics,
  };
  writeFileSync(resolve(directory, 'speech.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(makeSpeechFixture(process.argv[2]), null, 2)}\n`);
}
