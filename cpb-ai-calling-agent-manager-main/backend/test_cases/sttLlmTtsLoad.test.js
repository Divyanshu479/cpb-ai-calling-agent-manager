import test from 'node:test';
import assert from 'node:assert/strict';
import { SttLlmTtsCallingService } from '../src/services/sttLlmTtsCallingService.js';

class LoadSocket {
  static OPEN = 1;
  constructor() {
    this.readyState = LoadSocket.OPEN;
    this.sent = 0;
  }

  send() {
    this.sent += 1;
  }
}

const makeSession = (id) => ({
  id: `load-${id}`,
  provider: 'twilio',
  ws: new LoadSocket(),
  streamId: `stream-${id}`,
  closed: false,
  turnId: 0,
  pendingText: `hello-${id}`,
  transcriptTurns: [],
  currentTurn: null,
  llm: {
    streamResponse: async function* () {
      await new Promise((resolve) => setImmediate(resolve));
      yield { type: 'text', text: 'hello back' };
      yield { type: 'complete', text: 'hello back', usage: { prompt_tokens: 2, completion_tokens: 2 } };
    },
    getConversation: () => ({ usage: { prompt_tokens: 2, completion_tokens: 2 } }),
    supersede: () => {},
  },
  tts: {
    streamText: async function* (chunks) {
      for await (const chunk of chunks) {
        yield { type: 'audio', audio: Buffer.alloc(Math.max(160, chunk.length)) };
      }
      yield { type: 'complete', characters: 10 };
    },
  },
});

test('runs repeatable mocked concurrency levels without provider claims', async () => {
  const levels = [1, 5, 10, 25, 50];
  const results = [];

  for (const concurrency of levels) {
    const service = new SttLlmTtsCallingService();
    const sessions = Array.from({ length: concurrency }, (_, index) => makeSession(index));
    const startedAt = Date.now();
    const settled = await Promise.allSettled(sessions.map((session) => service.finishTurn(session)));
    const durationMs = Date.now() - startedAt;
    const failures = settled.filter((result) => result.status === 'rejected').length;
    results.push({ concurrency, durationMs, failures });
    assert.equal(failures, 0);
    assert.equal(sessions.filter((session) => session.currentTurn).length, 0);
  }

  console.log(JSON.stringify({
    type: 'simulated_stt_llm_tts_load',
    providerMode: 'mocked',
    levels: results,
    note: 'Application-level simulation only; no provider quota, network, CPU, or real telephony conclusions.',
  }));
});
