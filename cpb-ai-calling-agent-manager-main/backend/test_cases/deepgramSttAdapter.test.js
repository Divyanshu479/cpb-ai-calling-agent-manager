import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LiveTranscriptionEvents } from '@deepgram/sdk';
import { DeepgramSttAdapter } from '../src/services/voicePipelines/adapters.js';

class MockDeepgramConnection extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.finished = false;
  }

  send(audio) {
    this.sent.push(audio);
  }

  finish() {
    this.finished = true;
  }
}

const createMockClient = (connection) => ({
  listen: {
    live: (options) => {
      connection.options = options;
      return connection;
    },
  },
});

test('connects, streams audio, and normalizes partial/final Deepgram events', async () => {
  const connection = new MockDeepgramConnection();
  const adapter = new DeepgramSttAdapter(
    { apiKey: 'test-key', connectionTimeoutMs: 100 },
    { clientFactory: () => createMockClient(connection) }
  );
  const transcripts = [];
  const endpoints = [];
  adapter.on('transcript', (event) => transcripts.push(event));
  adapter.on('endpoint', (event) => endpoints.push(event));

  const connected = adapter.connect();
  setImmediate(() => connection.emit(LiveTranscriptionEvents.Open));
  await connected;

  const audio = Buffer.alloc(320);
  adapter.sendAudio(audio);
  connection.emit(LiveTranscriptionEvents.Transcript, {
    is_final: false,
    speech_final: false,
    channel: { alternatives: [{ transcript: 'hel', confidence: 0.4 }] },
  });
  connection.emit(LiveTranscriptionEvents.Transcript, {
    is_final: true,
    speech_final: true,
    start: 1,
    channel: { alternatives: [{ transcript: 'hello', confidence: 0.9 }] },
  });
  connection.emit(LiveTranscriptionEvents.Transcript, {
    is_final: true,
    speech_final: true,
    start: 1,
    channel: { alternatives: [{ transcript: 'hello', confidence: 0.9 }] },
  });
  connection.emit(LiveTranscriptionEvents.UtteranceEnd, {});

  assert.equal(connection.options.encoding, 'linear16');
  assert.equal(connection.options.sample_rate, 16000);
  assert.equal(connection.options.endpointing, 800);
  assert.equal(connection.sent[0], audio);
  assert.deepEqual(transcripts.map(({ type, text, isFinal }) => ({ type, text, isFinal })), [
    { type: 'partial', text: 'hel', isFinal: false },
    { type: 'final', text: 'hello', isFinal: true },
  ]);
  assert.equal(endpoints.length, 1);
  assert.equal(adapter.metrics.partialCount, 1);
  assert.equal(adapter.metrics.finalCount, 1);
  adapter.close();
  assert.equal(connection.finished, true);
});

test('rejects audio that does not match the Deepgram input contract', async () => {
  const adapter = new DeepgramSttAdapter({ apiKey: 'test-key', encoding: 'mulaw' });
  await assert.rejects(adapter.connect(), /linear16 PCM audio at 16000 Hz mono/);
});

test('times out when the provider never opens the connection', async () => {
  const connection = new MockDeepgramConnection();
  const adapter = new DeepgramSttAdapter(
    { apiKey: 'test-key', connectionTimeoutMs: 10 },
    { clientFactory: () => createMockClient(connection) }
  );
  await assert.rejects(adapter.connect(), /connection timed out/);
  adapter.close();
});

test('does not reconnect after explicit shutdown', async () => {
  const connection = new MockDeepgramConnection();
  const adapter = new DeepgramSttAdapter(
    { apiKey: 'test-key', connectionTimeoutMs: 100 },
    { clientFactory: () => createMockClient(connection) }
  );
  const connected = adapter.connect();
  setImmediate(() => connection.emit(LiveTranscriptionEvents.Open));
  await connected;
  adapter.close();
  connection.emit(LiveTranscriptionEvents.Close);
  assert.equal(adapter.connection, null);
});
