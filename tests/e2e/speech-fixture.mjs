import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const japaneseSpeech = 'こんにちは。私はアドです。ラーメンが好きです。';
const sampleRate = 48_000;
const bytesPerSample = 2;

function pcmData(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('afconvert no generó un archivo RIFF/WAVE.');
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const chunk = wav.toString('ascii', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    if (chunk === 'data') return wav.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  throw new Error('El WAV sintético no contiene muestras PCM.');
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
  const aiff = resolve(directory, 'speech-source.aiff');
  const pcm = resolve(directory, 'speech-pcm.wav');
  const path = resolve(directory, 'speech.wav');
  execFileSync('/usr/bin/say', ['-v', 'Kyoko', '-r', '130', '-o', aiff, japaneseSpeech]);
  execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', aiff, pcm]);
  const speech = pcmData(readFileSync(pcm));
  const leadingSeconds = 12;
  const trailingSeconds = 10;
  const audio = Buffer.concat([
    Buffer.alloc(leadingSeconds * sampleRate * bytesPerSample),
    speech,
    Buffer.alloc(trailingSeconds * sampleRate * bytesPerSample),
  ]);
  writeFileSync(path, Buffer.concat([waveHeader(audio.length), audio]));
  const metadata = {
    path, voice: 'Kyoko', speech: japaneseSpeech, sampleRate,
    channels: 1, bitsPerSample: 16, leadingSeconds, trailingSeconds,
    totalSeconds: audio.length / sampleRate / bytesPerSample,
  };
  writeFileSync(resolve(directory, 'speech.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(`${JSON.stringify(makeSpeechFixture(process.argv[2]), null, 2)}\n`);
}
