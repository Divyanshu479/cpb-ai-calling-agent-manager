import test from 'node:test';
import assert from 'node:assert/strict';
import { DeepgramSttAdapter } from '../src/services/voicePipelines/adapters.js';

test('optional Deepgram live connection', { skip: !process.env.DEEPGRAM_LIVE_TEST }, async () => {
  const adapter = new DeepgramSttAdapter({
    apiKey: process.env.DEEPGRAM_API_KEY,
    model: process.env.DEEPGRAM_STT_MODEL || 'nova-3',
    language: process.env.DEEPGRAM_STT_LANGUAGE || 'en-US',
  });
  await adapter.connect();
  adapter.sendAudio(Buffer.alloc(3200));
  adapter.close();
  assert.equal(adapter.connection, null);
});
