import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SttLlmTtsCallingService } from '../src/services/sttLlmTtsCallingService.js';

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  constructor() {
    super();
    this.readyState = FakeSocket.OPEN;
    this.sent = [];
  }

  send(message) {
    this.sent.push(JSON.parse(message));
  }

  close() {
    this.readyState = 3;
  }
}

const collect = async (iterator) => {
  const events = [];
  for await (const event of iterator) events.push(event);
  return events;
};

test('routes a final caller turn through mocked LLM and TTS to telephony', async () => {
  const service = new SttLlmTtsCallingService();
  const socket = new FakeSocket();
  const calls = [];
  const session = {
    id: 'call-1',
    provider: 'vobiz',
    ws: socket,
    streamId: 'stream-1',
    closed: false,
    turnId: 0,
    pendingText: 'I am interested',
    currentTurn: null,
    transcriptTurns: [],
    llm: {
      streamResponse: async function* () {
        yield { type: 'text', text: 'Thank you for your interest.' };
        yield { type: 'complete', text: 'Thank you for your interest.' };
      },
      getConversation: () => ({ usage: { total_tokens: 4 } }),
      supersede: () => {},
    },
    tts: {
      streamText: async function* (textChunks) {
        const text = (await collect(textChunks)).join('');
        calls.push(text);
        yield {
          type: 'audio',
          audio: Buffer.alloc(160),
          generation: 1,
        };
      },
    },
  };

  await service.finishTurn(session);

  assert.deepEqual(calls, ['Thank you for your interest.']);
  assert.equal(socket.sent[0].event, 'playAudio');
  assert.equal(socket.sent[0].media.contentType, 'audio/x-mulaw');
  assert.equal(socket.sent[0].media.sampleRate, 8000);
  assert.equal(Buffer.from(socket.sent[0].media.payload, 'base64').length, 160);
  assert.equal(session.currentTurn, null);
});

test('interrupts an active turn and clears stale telephony audio', () => {
  const service = new SttLlmTtsCallingService();
  const socket = new FakeSocket();
  let aborted = false;
  const session = {
    id: 'call-2',
    provider: 'twilio',
    ws: socket,
    streamId: 'stream-2',
    llm: { supersede: () => {} },
    currentTurn: {
      turnId: 1,
      controller: { abort: () => { aborted = true; } },
    },
  };

  service.interrupt(session);

  assert.equal(aborted, true);
  assert.equal(socket.sent[0].event, 'clear');
  assert.equal(socket.sent[0].streamSid, 'stream-2');
  assert.equal(session.currentTurn, null);
});

test('does not double-finalize duplicate hangups and removes the session', async () => {
  const service = new SttLlmTtsCallingService();
  const session = {
    id: 'call-hangup',
    closed: false,
    provider: 'vobiz',
    ws: new FakeSocket(),
    transcriptTurns: [],
    turnId: 0,
    llm: { getConversation: () => ({ usage: {} }), closeConversation: () => {} },
    stt: { close: () => {} },
    tts: { active: null },
  };
  service.sessions.set(session.id, session);

  await Promise.all([
    service.closeSession(session, 'media-stop'),
    service.closeSession(session, 'media-close'),
  ]);

  assert.equal(session.closed, true);
  assert.equal(service.sessions.has(session.id), false);
});

test('keeps conversation and audio state isolated between calls', async () => {
  const service = new SttLlmTtsCallingService();
  const makeSession = (id) => ({
    id,
    provider: 'twilio',
    ws: new FakeSocket(),
    streamId: `stream-${id}`,
    closed: false,
    turnId: 0,
    pendingText: `message-${id}`,
    transcriptTurns: [],
    currentTurn: null,
    llm: {
      streamResponse: async function* ({ callId }) {
        yield { type: 'text', text: `response-${callId}` };
        yield { type: 'complete', text: `response-${callId}`, usage: { total_tokens: 1 } };
      },
      getConversation: () => ({ usage: { total_tokens: 1 } }),
      supersede: () => {},
    },
    tts: {
      streamText: async function* (chunks) {
        const text = (await collect(chunks)).join('');
        yield { type: 'audio', audio: Buffer.from(text.padEnd(160, '.').slice(0, 160)) };
      },
    },
  });
  const first = makeSession('one');
  const second = makeSession('two');

  await Promise.all([service.finishTurn(first), service.finishTurn(second)]);

  assert.match(Buffer.from(first.ws.sent[0].media.payload, 'base64').toString(), /response-one/);
  assert.match(Buffer.from(second.ws.sent[0].media.payload, 'base64').toString(), /response-two/);
});
