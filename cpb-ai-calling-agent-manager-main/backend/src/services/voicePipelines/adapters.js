import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { encodePcm16ToMulaw, resamplePcm16 } from '../audioCodec.js';

class VoicePipelineNotImplementedError extends Error {
  constructor(stage) {
    super(`${stage} adapter is configured but live runtime integration is not implemented`);
    this.name = 'VoicePipelineNotImplementedError';
    this.statusCode = 501;
  }
}

export class DeepgramSttAdapter {
  constructor(config = {}, dependencies = {}) {
    this.provider = 'deepgram';
    this.config = {
      model: 'nova-3',
      language: 'en-US',
      encoding: 'linear16',
      sampleRate: 16000,
      channels: 1,
      interimResults: true,
      smartFormat: true,
      punctuate: true,
      endpointingMs: 800,
      utteranceEndMs: 1000,
      connectionTimeoutMs: 10000,
      maxReconnectAttempts: 2,
      ...config,
    };
    this.config.apiKey = this.config.apiKey || process.env.DEEPGRAM_API_KEY;
    this.clientFactory = dependencies.clientFactory || ((apiKey) => createClient(apiKey));
    this.events = new EventEmitter();
    this.connection = null;
    this.connectionGeneration = 0;
    this.reconnectAttempts = 0;
    this.closed = false;
    this.connectStartedAt = null;
    this.metrics = {
      connectionSetupLatencyMs: null,
      firstPartialLatencyMs: null,
      firstFinalLatencyMs: null,
      endpointingLatencyMs: null,
      audioBytesSent: 0,
      partialCount: 0,
      finalCount: 0,
    };
    this.lastAudioAt = null;
    this.recentFinals = new Set();
  }

  on(event, listener) {
    this.events.on(event, listener);
    return this;
  }

  once(event, listener) {
    this.events.once(event, listener);
    return this;
  }

  async connect() {
    this.validateConfig();
    const apiKey = this.config.apiKey || process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('Deepgram API key is not configured');
    this.closed = false;
    this.connectStartedAt = Date.now();
    await this.openConnection(apiKey);
    return this;
  }

  validateConfig() {
    const { encoding, sampleRate, channels } = this.config;
    if (encoding !== 'linear16' || sampleRate !== 16000 || channels !== 1) {
      throw new Error(
        'Deepgram STT requires linear16 PCM audio at 16000 Hz mono'
      );
    }
    if (!this.config.language || !this.config.model) {
      throw new Error('Deepgram model and language are required');
    }
    if (!Number.isInteger(this.config.endpointingMs) || this.config.endpointingMs < 0) {
      throw new Error('Deepgram endpointingMs must be a non-negative integer');
    }
    if (!Number.isInteger(this.config.utteranceEndMs) || this.config.utteranceEndMs < 0) {
      throw new Error('Deepgram utteranceEndMs must be a non-negative integer');
    }
  }

  async openConnection(apiKey) {
    const generation = ++this.connectionGeneration;
    const deepgram = this.clientFactory(apiKey);
    const connection = deepgram.listen.live({
      model: this.config.model,
      language: this.config.language,
      encoding: this.config.encoding,
      sample_rate: this.config.sampleRate,
      channels: this.config.channels,
      interim_results: this.config.interimResults,
      smart_format: this.config.smartFormat,
      punctuate: this.config.punctuate,
      endpointing: this.config.endpointingMs,
      utterance_end_ms: this.config.utteranceEndMs,
    });
    this.connection = connection;

    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Deepgram connection timed out'));
      }, this.config.connectionTimeoutMs);

      connection.on(LiveTranscriptionEvents.Open, () => {
        if (generation !== this.connectionGeneration) return;
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.reconnectAttempts = 0;
        this.metrics.connectionSetupLatencyMs = Date.now() - this.connectStartedAt;
        this.events.emit('connected', { latencyMs: this.metrics.connectionSetupLatencyMs });
        resolve();
      });
      connection.on(LiveTranscriptionEvents.Transcript, (payload) => {
        if (generation === this.connectionGeneration) this.handleTranscript(payload);
      });
      connection.on(LiveTranscriptionEvents.SpeechStarted, (payload) => {
        if (generation === this.connectionGeneration) {
          this.events.emit('speech_started', { type: 'speech_started', payload: payload || {} });
        }
      });
      connection.on(LiveTranscriptionEvents.UtteranceEnd, (payload) => {
        if (generation !== this.connectionGeneration) return;
        this.metrics.endpointingLatencyMs = this.lastAudioAt
          ? Date.now() - this.lastAudioAt
          : null;
        this.events.emit('endpoint', {
          type: 'endpoint',
          receivedAt: Date.now(),
          payload: payload || {},
          latencyMs: this.metrics.endpointingLatencyMs,
        });
      });
      connection.on(LiveTranscriptionEvents.Error, (error) => {
        if (generation !== this.connectionGeneration) return;
        this.events.emit('error', this.safeError(error));
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error('Deepgram connection error'));
        }
      });
      connection.on(LiveTranscriptionEvents.Close, () => {
        if (generation !== this.connectionGeneration) return;
        this.events.emit('closed', { reconnecting: !this.closed });
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('Deepgram connection closed before opening'));
        }
        if (!this.closed) this.reconnect(apiKey).catch((error) => this.events.emit('error', error));
      });
    });
  }

  handleTranscript(payload = {}) {
    const alternative = payload.channel?.alternatives?.[0];
    const text = typeof alternative?.transcript === 'string'
      ? alternative.transcript.trim()
      : '';
    if (!text) return;
    const isFinal = payload.is_final === true;
    const speechFinal = payload.speech_final === true;
    const now = Date.now();
    const dedupeKey = `${payload.start ?? 'unknown'}:${text}`;
    if (isFinal && this.recentFinals.has(dedupeKey)) return;
    if (isFinal) {
      this.recentFinals.add(dedupeKey);
      if (this.recentFinals.size > 1000) {
        this.recentFinals.delete(this.recentFinals.values().next().value);
      }
    }
    if (isFinal) this.metrics.finalCount += 1;
    else this.metrics.partialCount += 1;
    if (!isFinal && this.metrics.firstPartialLatencyMs === null) {
      this.metrics.firstPartialLatencyMs = now - this.connectStartedAt;
    }
    if (isFinal && this.metrics.firstFinalLatencyMs === null) {
      this.metrics.firstFinalLatencyMs = now - this.connectStartedAt;
    }
    this.events.emit('transcript', {
      type: isFinal ? 'final' : 'partial',
      text,
      isFinal,
      speechFinal,
      confidence: alternative.confidence ?? null,
      receivedAt: now,
      latencyMs: now - this.connectStartedAt,
      start: payload.start ?? null,
      duration: payload.duration ?? null,
    });
  }

  sendAudio(audio) {
    if (!Buffer.isBuffer(audio) && !(audio instanceof Uint8Array)) {
      throw new TypeError('Deepgram audio must be a Buffer or Uint8Array');
    }
    if (!this.connection || typeof this.connection.send !== 'function') {
      throw new Error('Deepgram connection is not open');
    }
    this.connection.send(audio);
    this.metrics.audioBytesSent += audio.byteLength;
    this.lastAudioAt = Date.now();
  }

  async reconnect(apiKey = this.config.apiKey || process.env.DEEPGRAM_API_KEY) {
    if (this.closed || this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      if (!this.closed) this.events.emit('reconnect_failed');
      return false;
    }
    this.reconnectAttempts += 1;
    this.events.emit('reconnecting', { attempt: this.reconnectAttempts });
    await this.openConnection(apiKey);
    return true;
  }

  close() {
    this.closed = true;
    this.connectionGeneration += 1;
    if (this.connection && typeof this.connection.finish === 'function') {
      this.connection.finish();
    } else if (this.connection && typeof this.connection.close === 'function') {
      this.connection.close();
    }
    this.connection = null;
    this.events.emit('closed', { reconnecting: false });
    this.events.removeAllListeners();
  }

  safeError(error) {
    if (!(error instanceof Error)) return new Error('Deepgram connection error');
    const apiKey = this.config.apiKey || process.env.DEEPGRAM_API_KEY;
    const message = apiKey ? error.message.replaceAll(apiKey, '[REDACTED]') : error.message;
    return new Error(message);
  }
}

export class ConfigurableLlmAdapter {
  constructor(config = {}, dependencies = {}) {
    this.provider = String(config.provider || 'openai_compatible').toLowerCase();
    this.config = {
      timeoutMs: 30000,
      maxTokens: 512,
      temperature: 0.7,
      ...config,
    };
    this.fetch = dependencies.fetch || globalThis.fetch;
    this.conversations = new Map();
    this.generations = new Map();
    this.validateConfig();
  }

  validateConfig() {
    const supported = ['openai', 'openai_compatible', 'anthropic'];
    if (!supported.includes(this.provider)) {
      throw new Error(`Unsupported LLM provider: ${this.provider}`);
    }
    if (!this.config.model) throw new Error('LLM model is required');
    if (
      Array.isArray(this.config.availableModels) &&
      this.config.availableModels.length > 0 &&
      !this.config.availableModels.some((model) => (model.id || model) === this.config.model)
    ) {
      throw new Error(`LLM model ${this.config.model} is not available for provider ${this.provider}`);
    }
    if (typeof this.fetch !== 'function') throw new Error('Fetch is not available for the LLM adapter');
    if (!this.config.baseUrl) throw new Error('LLM integration base URL is required');
  }

  createConversation({ callId, systemPrompt, qaEntries = [], knowledgeContext = '' } = {}) {
    if (!callId || typeof callId !== 'string') throw new Error('A call ID is required');
    if (this.conversations.has(callId)) throw new Error(`Conversation already exists for call ${callId}`);
    const context = [
      systemPrompt || 'You are a helpful AI assistant making phone calls.',
      this.formatBusinessContext(qaEntries, knowledgeContext),
    ].filter(Boolean).join('\n\n');
    const conversation = {
      callId,
      messages: [{ role: 'system', content: context }],
      generation: 0,
      createdAt: Date.now(),
      usage: null,
    };
    this.conversations.set(callId, conversation);
    return { callId, generation: conversation.generation };
  }

  formatBusinessContext(qaEntries, knowledgeContext) {
    const qa = qaEntries
      .filter((entry) => entry?.question && entry?.answer)
      .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
      .join('\n');
    const knowledge = typeof knowledgeContext === 'string' ? knowledgeContext.trim() : '';
    return [qa && `Business Q&A:\n${qa}`, knowledge && `Business context:\n${knowledge}`]
      .filter(Boolean)
      .join('\n\n');
  }

  getConversation(callId) {
    const conversation = this.conversations.get(callId);
    if (!conversation) throw new Error('Conversation not found');
    return conversation;
  }

  supersede(callId) {
    const conversation = this.getConversation(callId);
    conversation.generation += 1;
    const active = this.generations.get(callId);
    if (active) active.abort();
    return conversation.generation;
  }

  closeConversation(callId) {
    const active = this.generations.get(callId);
    if (active) active.abort();
    this.generations.delete(callId);
    this.conversations.delete(callId);
  }

  async *streamResponse({ callId, userText, generation, signal } = {}) {
    const conversation = this.getConversation(callId);
    if (!userText || typeof userText !== 'string') throw new Error('User text is required');
    const expectedGeneration = generation ?? conversation.generation;
    if (expectedGeneration !== conversation.generation) return;

    conversation.messages.push({ role: 'user', content: userText });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('LLM request timed out')), this.config.timeoutMs);
    const abort = () => controller.abort(signal?.reason || new Error('LLM request cancelled'));
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    this.generations.set(callId, controller);

    try {
      const response = await this.fetch(this.requestUrl(), {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify(this.requestBody(conversation.messages)),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`LLM provider request failed with status ${response.status}`);
      }
      let text = '';
      let usage = null;
      if (this.provider === 'anthropic' || this.config.stream !== false) {
        for await (const event of this.parseStream(response)) {
          if (event.type === 'usage') {
            usage = event.usage;
            conversation.usage = usage;
            continue;
          }
          if (event.type !== 'text') continue;
          if (expectedGeneration !== conversation.generation) return;
          text += event.text;
          yield { type: 'text', text: event.text, callId, generation: expectedGeneration };
        }
      } else {
        const payload = await response.json();
        text = this.extractText(payload);
        usage = payload.usage || null;
        conversation.usage = usage;
        if (text) yield { type: 'text', text, callId, generation: expectedGeneration };
      }
      if (expectedGeneration !== conversation.generation) return;
      conversation.messages.push({ role: 'assistant', content: text });
      yield { type: 'complete', text, usage, callId, generation: expectedGeneration };
    } catch (error) {
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error('LLM request cancelled');
      }
      throw this.safeProviderError(error);
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abort);
      if (this.generations.get(callId) === controller) this.generations.delete(callId);
    }
  }

  requestUrl() {
    const baseUrl = String(this.config.baseUrl).replace(/\/+$/, '');
    if (this.provider === 'anthropic') {
      return /\/messages$/.test(baseUrl) ? baseUrl : `${baseUrl}/v1/messages`;
    }
    return /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/v1/chat/completions`;
  }

  requestHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.config.apiKey && this.provider !== 'anthropic') {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    if (this.provider === 'anthropic') {
      headers['x-api-key'] = this.config.apiKey;
      headers['anthropic-version'] = this.config.apiVersion || '2023-06-01';
    }
    if (this.config.authType === 'api_key_header' || this.config.authType === 'custom_header') {
      delete headers.Authorization;
      delete headers['x-api-key'];
      headers[this.config.headerName] = this.config.headerValue;
    }
    return headers;
  }

  requestBody(messages) {
    if (this.provider === 'anthropic') {
      const system = messages.find((message) => message.role === 'system')?.content || '';
      return {
        model: this.config.model,
        system,
        messages: messages.filter((message) => message.role !== 'system'),
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        stream: true,
      };
    }
    return {
      model: this.config.model,
      messages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: this.config.stream !== false,
    };
  }

  async *parseStream(response) {
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
      const payload = await response.json();
      yield { type: 'text', text: this.extractText(payload) };
      if (payload.usage) yield { type: 'usage', usage: payload.usage };
      return;
    }
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += Buffer.from(chunk).toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const value = line.replace(/^data:\s*/, '').trim();
        if (!value || value === '[DONE]') continue;
        let payload;
        try {
          payload = JSON.parse(value);
        } catch {
          continue;
        }
        const text = this.provider === 'anthropic'
          ? payload.delta?.text
          : payload.choices?.[0]?.delta?.content;
        if (text) yield { type: 'text', text };
        if (payload.usage) yield { type: 'usage', usage: payload.usage };
      }
    }
  }

  extractText(payload = {}) {
    return payload.choices?.[0]?.message?.content ||
      payload.content?.find((item) => item.type === 'text')?.text ||
      '';
  }

  safeProviderError(error) {
    const apiKey = this.config.apiKey;
    const message = error instanceof Error ? error.message : 'LLM provider error';
    return new Error(apiKey ? message.replaceAll(apiKey, '[REDACTED]') : message);
  }
}

export class ElevenLabsTtsAdapter {
  constructor(config = {}, dependencies = {}) {
    this.provider = 'elevenlabs';
    this.config = {
      model: 'eleven_flash_v2_5',
      outputFormat: 'pcm_16000',
      telephonyFormat: 'mulaw_8000',
      timeoutMs: 30000,
      maxTextBufferChars: 4000,
      maxAudioBufferBytes: 1024 * 1024,
      ...config,
    };
    this.WebSocket = dependencies.WebSocket || WebSocket;
    this.events = new EventEmitter();
    this.active = null;
    this.validateConfig();
  }

  on(event, listener) {
    this.events.on(event, listener);
    return this;
  }

  validateConfig() {
    if (!this.config.apiKey) {
      throw new Error('ElevenLabs API key is not configured');
    }
    if (!this.config.voice) throw new Error('ElevenLabs voice is required');
    if (!this.config.model) throw new Error('ElevenLabs model is required');
    if (this.config.outputFormat !== 'pcm_16000') {
      throw new Error('ElevenLabs TTS requires pcm_16000 output for the configured converter');
    }
    if (this.config.telephonyFormat !== 'mulaw_8000') {
      throw new Error('Telephony output must be mulaw_8000 for Vobiz/Twilio');
    }
  }

  async *streamText(textChunks, { signal, generation = 0 } = {}) {
    if (!textChunks || typeof textChunks[Symbol.asyncIterator] !== 'function') {
      throw new TypeError('ElevenLabs text input must be an async iterable');
    }
    const session = this.openSession(signal, generation);
    this.active = session;
    const queue = [];
    let queueBytes = 0;
    let queueEnded = false;
    let queueError = null;
    let notify;
    const wake = () => {
      if (notify) {
        const resolve = notify;
        notify = null;
        resolve();
      }
    };
    session.onAudio = enqueue;
    session.wake = wake;
    const producer = (async () => {
      try {
        await session.ready;
        for await (const text of textChunks) {
          if (session.closed) break;
          const value = String(text || '');
          if (!value) continue;
          session.textChars += value.length;
          session.textBufferChars += value.length;
          if (session.textBufferChars > this.config.maxTextBufferChars) {
            throw new Error('ElevenLabs text buffer limit exceeded');
          }
          session.socket.send(JSON.stringify({ text: value, try_trigger_generation: true }));
          session.textBufferChars = 0;
        }
        if (!session.closed) {
          session.socket.send(JSON.stringify({ text: '', flush: true }));
        }
      } catch (error) {
        queueError = error;
        session.abort(error);
      } finally {
        queueEnded = true;
        wake();
      }
    })();

    try {
      while (!queueEnded || (!session.finalReceived && !session.error) || queue.length > 0) {
        if (queueError) throw queueError;
        if (queue.length === 0) {
          await new Promise((resolve) => { notify = resolve; });
          continue;
        }
        const chunk = queue.shift();
        queueBytes -= chunk.length;
        yield this.normalizeAudioChunk(chunk, session);
      }
      await producer;
      if (session.error) throw session.error;
      this.events.emit('complete', this.completionEvent(session));
      yield { type: 'complete', ...this.completionEvent(session) };
    } finally {
      session.close();
      if (this.active === session) this.active = null;
    }

    function enqueue(chunk) {
      if (session.closed) return;
      const buffer = Buffer.from(chunk);
      queueBytes += buffer.length;
      if (queueBytes > session.maxAudioBufferBytes) {
        session.abort(new Error('ElevenLabs audio buffer limit exceeded'));
        return;
      }
      queue.push(buffer);
      wake();
    }
  }

  openSession(signal, generation) {
    const startedAt = Date.now();
    const session = {
      startedAt,
      firstAudioAt: null,
      textChars: 0,
      textBufferChars: 0,
      maxAudioBufferBytes: this.config.maxAudioBufferBytes,
      generation,
      closed: false,
      error: null,
      onAudio: null,
      wake: null,
      abort: (reason) => {
        session.error = reason instanceof Error ? reason : new Error('ElevenLabs request cancelled');
        session.close();
        session.wake?.();
      },
      close: () => {
        if (session.closed) return;
        session.closed = true;
        if (session.socket && session.socket.readyState === this.WebSocket.OPEN) {
          session.socket.close();
        }
      },
    };
    const url = new URL(`wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.config.voice)}/stream-input`);
    url.searchParams.set('model_id', this.config.model);
    url.searchParams.set('output_format', this.config.outputFormat);
    let resolveReady;
    let rejectReady;
    session.ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const socket = new this.WebSocket(url.toString());
    session.socket = socket;
    const timeout = setTimeout(() => {
      const error = new Error('ElevenLabs connection timed out');
      rejectReady(error);
      session.abort(error);
    }, this.config.timeoutMs);
    const abort = () => session.abort(signal?.reason || new Error('ElevenLabs request cancelled'));
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    socket.on('open', () => {
      clearTimeout(timeout);
      resolveReady();
      this.events.emit('connected', { latencyMs: Date.now() - startedAt });
      socket.send(JSON.stringify({
        text: ' ',
        xi_api_key: this.config.apiKey,
        voice_settings: this.config.voiceSettings || { stability: 0.5, similarity_boost: 0.75 },
        generation_config: { chunk_length_schedule: this.config.chunkLengthSchedule || [50, 120, 240, 320] },
      }));
    });
    socket.on('message', (message, isBinary) => {
      if (session.closed) return;
      if (isBinary) {
        if (!session.firstAudioAt) {
          session.firstAudioAt = Date.now();
          this.events.emit('first_audio', { latencyMs: session.firstAudioAt - startedAt });
        }
        session.onAudio?.(message);
        return;
      }
      let payload;
      try {
        payload = JSON.parse(message.toString());
      } catch {
        session.abort(new Error('Invalid ElevenLabs response'));
        return;
      }
      if (payload.audio) {
        const audio = Buffer.from(payload.audio, 'base64');
        if (!session.firstAudioAt) {
          session.firstAudioAt = Date.now();
          this.events.emit('first_audio', { latencyMs: session.firstAudioAt - startedAt });
        }
        session.onAudio?.(audio);
      }
      if (payload.isFinal) {
        session.finalReceived = true;
        session.wake?.();
      }
      if (payload.error) session.abort(new Error(String(payload.error)));
    });
    socket.on('error', (error) => {
      const safeError = this.safeError(error);
      rejectReady(safeError);
      session.abort(safeError);
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      if (!session.closed && !session.finalReceived) {
        const error = new Error('ElevenLabs connection closed unexpectedly');
        rejectReady(error);
        session.abort(error);
      }
    });
    return session;
  }

  normalizeAudioChunk(chunk, session) {
    if (this.config.outputFormat !== 'pcm_16000') {
      throw new Error('Unsupported ElevenLabs audio format');
    }
    const pcm8 = resamplePcm16(chunk, 16000, 8000);
    const mulaw = encodePcm16ToMulaw(pcm8);
    return {
      type: 'audio',
      audio: mulaw,
      encoding: 'mulaw',
      sampleRate: 8000,
      channels: 1,
      telephonyReady: true,
      generation: session.generation,
    };
  }

  completionEvent(session) {
    return {
      characters: session.textChars,
      timeToFirstAudioMs: session.firstAudioAt ? session.firstAudioAt - session.startedAt : null,
      synthesisTimeMs: Date.now() - session.startedAt,
      generation: session.generation,
    };
  }

  safeError(error) {
    const message = error instanceof Error ? error.message : 'ElevenLabs provider error';
    return new Error(this.config.apiKey ? message.replaceAll(this.config.apiKey, '[REDACTED]') : message);
  }
}

export const createVoicePipelineAdapters = ({ stt, llm, tts } = {}) => ({
  stt: new DeepgramSttAdapter(stt),
  llm: new ConfigurableLlmAdapter(llm),
  tts: new ElevenLabsTtsAdapter(tts),
});
