import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ElevenLabsTtsAdapter } from '../src/services/voicePipelines/adapters.js';

class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
    MockWebSocket.instances.push(this);
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  audio(pcm16) {
    this.emit('message', JSON.stringify({
      audio: Buffer.from(pcm16).toString('base64'),
      isFinal: false,
    }), false);
  }

  finish() {
    this.emit('message', JSON.stringify({ isFinal: true }), false);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

const adapter = (overrides = {}) => new ElevenLabsTtsAdapter({
  apiKey: 'secret-key',
  voice: 'voice-id',
  model: 'eleven_flash_v2_5',
  timeoutMs: 100,
  ...overrides,
}, { WebSocket: MockWebSocket });

async function* textChunks(...chunks) {
  for (const chunk of chunks) yield chunk;
}

test('delivers bounded telephony-ready audio chunks and metadata', async () => {
  MockWebSocket.instances = [];
  const tts = adapter();
  const iterator = tts.streamText(textChunks('Hello', ' world'));
  const first = iterator.next();
  const socket = MockWebSocket.instances[0];
  socket.open();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.sent[0].xi_api_key, 'secret-key');
  assert.equal(socket.sent[1].text, 'Hello');
  assert.equal(socket.sent[2].text, ' world');

  socket.audio(Buffer.alloc(3200));
  const audio = await first;
  assert.equal(audio.value.type, 'audio');
  assert.equal(audio.value.encoding, 'mulaw');
  assert.equal(audio.value.sampleRate, 8000);
  assert.equal(audio.value.channels, 1);
  assert.equal(audio.value.telephonyReady, true);
  assert.equal(audio.value.audio.length, 800);
  socket.finish();
  const complete = await iterator.next();
  assert.equal(complete.value.type, 'complete');
  assert.equal(complete.value.characters, 11);
  assert.equal(typeof complete.value.timeToFirstAudioMs, 'number');
});

test('propagates provider errors and redacts the API key', async () => {
  MockWebSocket.instances = [];
  const tts = adapter();
  const pending = tts.streamText(textChunks('Hi')).next();
  const socket = MockWebSocket.instances[0];
  socket.emit('error', new Error('bad secret-key credential'));
  await assert.rejects(pending, /bad \[REDACTED\] credential/);
});

test('times out before the provider opens', async () => {
  MockWebSocket.instances = [];
  const tts = adapter({ timeoutMs: 10 });
  await assert.rejects(tts.streamText(textChunks('Hi')).next(), /timed out/);
});

test('cancels and closes the socket without delivering later audio', async () => {
  MockWebSocket.instances = [];
  const tts = adapter();
  const controller = new AbortController();
  const pending = tts.streamText(textChunks('Hi'), { signal: controller.signal }).next();
  const socket = MockWebSocket.instances[0];
  socket.open();
  controller.abort(new Error('caller interrupted'));
  socket.audio(Buffer.alloc(320));
  await assert.rejects(pending, /caller interrupted/);
  assert.equal(socket.closed, true);
});

test('rejects incompatible provider audio metadata', () => {
  assert.throws(() => adapter({ outputFormat: 'mp3_44100' }), /pcm_16000/);
  assert.throws(() => adapter({ telephonyFormat: 'pcm_8000' }), /mulaw_8000/);
});
