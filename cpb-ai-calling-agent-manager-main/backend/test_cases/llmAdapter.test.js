import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigurableLlmAdapter } from '../src/services/voicePipelines/adapters.js';

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

const streamResponse = (chunks, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  body: (async function* () {
    for (const chunk of chunks) yield Buffer.from(chunk);
  }()),
});

const collect = async (iterator) => {
  const events = [];
  for await (const event of iterator) events.push(event);
  return events;
};

const createAdapter = (fetch) => new ConfigurableLlmAdapter({
  provider: 'openai_compatible',
  baseUrl: 'https://llm.example.test',
  apiKey: 'secret-key',
  model: 'test-model',
}, { fetch });

test('preserves persona, business context, and conversation order', async () => {
  let request;
  const adapter = createAdapter(async (_url, options) => {
    request = JSON.parse(options.body);
    return jsonResponse({
      choices: [{ message: { content: 'Thanks for your answer.' } }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    });
  });
  adapter.createConversation({
    callId: 'call-a',
    systemPrompt: 'Be concise and polite.',
    qaEntries: [{ question: 'Price?', answer: 'The price is 10.' }],
    knowledgeContext: 'The service is available Monday to Friday.',
  });

  const events = await collect(adapter.streamResponse({
    callId: 'call-a',
    userText: 'What is the price?',
  }));

  assert.deepEqual(request.messages.map(({ role, content }) => ({ role, content })), [
    { role: 'system', content: 'Be concise and polite.\n\nBusiness Q&A:\nQ: Price?\nA: The price is 10.\n\nBusiness context:\nThe service is available Monday to Friday.' },
    { role: 'user', content: 'What is the price?' },
  ]);
  assert.equal(events.at(-1).type, 'complete');
  assert.equal(events.at(-1).usage.total_tokens, 25);
  assert.equal(adapter.getConversation('call-a').messages.at(-1).role, 'assistant');
});

test('normalizes streamed response text and usage', async () => {
  const adapter = createAdapter(async () => streamResponse([
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
    'data: {"choices":[{"delta":{"content":" there"}}]}\n',
    'data: {"usage":{"prompt_tokens":3,"completion_tokens":2}}\n',
    'data: [DONE]\n',
  ]));
  adapter.createConversation({ callId: 'call-stream', systemPrompt: 'Answer.' });

  const events = await collect(adapter.streamResponse({
    callId: 'call-stream',
    userText: 'Hi',
  }));

  assert.deepEqual(events.filter((event) => event.type === 'text').map((event) => event.text), [
    'Hello',
    ' there',
  ]);
  assert.deepEqual(events.at(-1).usage, { prompt_tokens: 3, completion_tokens: 2 });
});

test('reports provider failures without exposing the API key', async () => {
  const adapter = createAdapter(async () => jsonResponse({ error: 'bad' }, 401));
  adapter.createConversation({ callId: 'call-error' });

  await assert.rejects(
    collect(adapter.streamResponse({ callId: 'call-error', userText: 'Hi' })),
    /status 401/
  );
});

test('aborts a request on timeout', async () => {
  let aborted = false;
  const adapter = new ConfigurableLlmAdapter({
    provider: 'openai',
    baseUrl: 'https://llm.example.test',
    apiKey: 'secret-key',
    model: 'test-model',
    timeoutMs: 10,
  }, {
    fetch: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        reject(options.signal.reason);
      }, { once: true });
    }),
  });
  adapter.createConversation({ callId: 'call-timeout' });

  await assert.rejects(
    collect(adapter.streamResponse({ callId: 'call-timeout', userText: 'Hi' })),
    /timed out/
  );
  assert.equal(aborted, true);
});

test('supports caller cancellation and supersedes obsolete generations', async () => {
  let aborted = false;
  const adapter = createAdapter(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted = true;
      reject(options.signal.reason);
    }, { once: true });
  }));
  adapter.createConversation({ callId: 'call-cancel' });
  const cancellation = new AbortController();
  const pending = collect(adapter.streamResponse({
    callId: 'call-cancel',
    userText: 'Old question',
    signal: cancellation.signal,
  }));
  cancellation.abort(new Error('caller interrupted'));
  await assert.rejects(pending, /caller interrupted/);
  assert.equal(aborted, true);

  const generation = adapter.getConversation('call-cancel').generation;
  const obsolete = collect(adapter.streamResponse({
    callId: 'call-cancel',
    userText: 'Obsolete question',
    generation,
  }));
  adapter.supersede('call-cancel');
  await assert.rejects(obsolete, /aborted|cancelled/i);
  assert.equal(adapter.getConversation('call-cancel').generation, generation + 1);
});

test('isolates conversation history by call ID', async () => {
  const requests = [];
  const adapter = createAdapter(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  });
  adapter.createConversation({ callId: 'call-one', systemPrompt: 'One' });
  adapter.createConversation({ callId: 'call-two', systemPrompt: 'Two' });

  await collect(adapter.streamResponse({ callId: 'call-one', userText: 'Private one' }));
  await collect(adapter.streamResponse({ callId: 'call-two', userText: 'Private two' }));

  assert.equal(requests[0].messages.some((message) => message.content === 'Private two'), false);
  assert.equal(requests[1].messages.some((message) => message.content === 'Private one'), false);
  assert.throws(() => adapter.getConversation('missing-call'), /Conversation not found/);
});

test('rejects incompatible providers and missing models', () => {
  assert.throws(() => new ConfigurableLlmAdapter({
    provider: 'unsupported',
    baseUrl: 'https://llm.example.test',
    model: 'model',
  }), /Unsupported LLM provider/);
  assert.throws(() => new ConfigurableLlmAdapter({
    provider: 'openai',
    baseUrl: 'https://llm.example.test',
  }), /LLM model is required/);
});
