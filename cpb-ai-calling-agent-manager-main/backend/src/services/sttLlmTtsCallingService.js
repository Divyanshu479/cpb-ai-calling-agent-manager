import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import AICaller from '../models/AICaller.js';
import Campaign from '../models/Campaign.js';
import Lead from '../models/Lead.js';
import voicePipelineService from './voicePipelineService.js';
import callSessionService from './callSessionService.js';
import { decodeMulawToPcm16, resamplePcm16 } from './audioCodec.js';
import { createPipelineMetrics, estimatePipelineCost, summarizeLatencies } from './voicePipelineMetrics.js';

const VOBIZ_PATH = '/api/telephony/vobiz/stt-llm-tts-stream';
const TWILIO_PATH = '/api/telephony/twilio/stt-llm-tts-stream';
const FRAME_BYTES = 160;

export class SttLlmTtsCallingService {
  constructor() {
    this.servers = new Set();
    this.sessions = new Map();
  }

  initialize(server) {
    const wss = new WebSocketServer({ noServer: true });
    this.servers.add(wss);
    server.on('upgrade', (request, socket, head) => {
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      if (![VOBIZ_PATH, TWILIO_PATH].includes(requestUrl.pathname)) return;
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    });
    wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request).catch((error) => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
        console.error('[STT_LLM_TTS] WebSocket setup failed:', error.message);
      });
    });
  }

  async handleConnection(ws, request) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const provider = url.pathname === TWILIO_PATH ? 'twilio' : 'vobiz';
    const session = {
      id: randomUUID(),
      callSessionId: url.searchParams.get('callSessionId') || null,
      provider,
      ws,
      streamId: null,
      providerCallId: url.searchParams.get('callSid') || null,
      turnId: 0,
      transcriptTurns: [],
      currentTurn: null,
      closed: false,
      stt: null,
      llm: null,
      tts: null,
      params: Object.fromEntries(url.searchParams.entries()),
      metrics: createPipelineMetrics(),
      startedAt: Date.now(),
      lastEndpointAt: null,
      turnStartedAt: null,
    };
    this.sessions.set(session.id, session);
    ws.on('message', (raw) => this.handleMessage(session, raw).catch((error) => this.fail(session, error)));
    ws.on('close', () => this.closeSession(session, 'media-close'));
    ws.on('error', (error) => this.fail(session, error));
  }

  async handleMessage(session, raw) {
    if (session.closed) return;
    const message = JSON.parse(raw.toString());
    const event = String(message.event || '').toLowerCase();
    if (event === 'connected') return;
    if (event === 'start') {
      await this.startSession(session, message);
      return;
    }
    if (event === 'media') {
      this.sendAudioToStt(session, message.media?.payload);
      return;
    }
    if (event === 'stop') {
      this.closeSession(session, 'media-stop');
    }
  }

  async startSession(session, message) {
    const params = message.start?.customParameters || message.start?.parameters || {};
    session.params = { ...session.params, ...params };
    session.streamId = message.start?.streamSid || message.start?.streamId || message.streamId || null;
    session.providerCallId = session.providerCallId ||
      message.start?.callSid || message.start?.call_uuid || message.start?.callId || null;

    const caller = await AICaller.findById(session.params.aiCallerId)
      .select('name description s2sConfig qaEntries guardrails');
    if (!caller || caller.s2sConfig?.pipeline !== 'STT_LLM_TTS') {
      throw new Error('STT_LLM_TTS caller configuration is required');
    }
    const config = caller.s2sConfig.toObject?.() || caller.s2sConfig;
    const runtime = await voicePipelineService.validateForCall({
      ...config,
      pipeline: 'STT_LLM_TTS',
    });
    session.stt = runtime.adapters.stt;
    session.llm = runtime.adapters.llm;
    session.tts = runtime.adapters.tts;
    session.llm.createConversation({
      callId: session.id,
      systemPrompt: config.systemPrompt,
      qaEntries: caller.qaEntries,
      knowledgeContext: caller.description,
    });
    session.stt
      .on('transcript', (event) => this.handleTranscript(session, event))
      .on('speech_started', () => this.interrupt(session))
      .on('endpoint', () => {
        session.lastEndpointAt = Date.now();
        const delay = session.stt?.metrics?.endpointingLatencyMs;
        if (Number.isFinite(delay)) session.metrics.endOfTurnDelayMs.push(delay);
        this.finishTurn(session);
      })
      .on('error', (error) => this.fail(session, error));
    await session.stt.connect();
    this.sessions.set(session.id, session);
  }

  sendAudioToStt(session, payload) {
    if (!payload || !session.stt) return;
    session.metrics ||= createPipelineMetrics();
    const mulaw = Buffer.from(payload, 'base64');
    const pcm8 = decodeMulawToPcm16(mulaw);
    const pcm16 = resamplePcm16(pcm8, 8000, 16000);
    session.metrics.audioBytesSentToStt += pcm16.length;
    session.stt.sendAudio(pcm16);
  }

  handleTranscript(session, event) {
    session.metrics ||= createPipelineMetrics();
    if (event.type === 'partial' && Number.isFinite(event.latencyMs)) {
      session.metrics.sttPartialLatencyMs.push(event.latencyMs);
    }
    if (event.type === 'partial') return;
    if (!event.text || !event.speechFinal) return;
    if (Number.isFinite(event.latencyMs)) session.metrics.sttFinalLatencyMs.push(event.latencyMs);
    session.pendingText = `${session.pendingText || ''} ${event.text}`.trim();
    session.transcriptTurns.push({
      speaker: 'user',
      text: event.text,
      timestamp: new Date(),
    });
  }

  async finishTurn(session) {
    session.metrics ||= createPipelineMetrics();
    const text = String(session.pendingText || '').trim();
    session.pendingText = '';
    if (!text || session.closed || session.currentTurn) return;
    const turnId = ++session.turnId;
    session.metrics.turnCount += 1;
    const controller = new AbortController();
    session.currentTurn = { turnId, controller };
    session.turnStartedAt = Date.now();
    const turnMetrics = { llmFirstTokenAt: null, ttsFirstAudioAt: null, firstTransportAt: null };
    const llmEvents = session.llm.streamResponse({
      callId: session.id,
      userText: text,
      signal: controller.signal,
    });
    const textChunks = (async function* () {
      for await (const event of llmEvents) {
        if (event.type === 'text') {
          if (!turnMetrics.llmFirstTokenAt) {
            turnMetrics.llmFirstTokenAt = Date.now();
            session.metrics.llmTimeToFirstTokenMs.push(turnMetrics.llmFirstTokenAt - session.turnStartedAt);
          }
          yield event.text;
        }
        if (event.type === 'complete' && event.text) {
          if (event.usage) session.metrics.llmUsage = event.usage;
          session.transcriptTurns.push({
            speaker: 'ai',
            text: event.text,
            timestamp: new Date(),
          });
        }
      }
    }());
    try {
      for await (const event of session.tts.streamText(textChunks, {
        signal: controller.signal,
        generation: turnId,
      })) {
        if (event.type === 'audio' && session.currentTurn?.turnId === turnId) {
          if (!turnMetrics.ttsFirstAudioAt) {
            turnMetrics.ttsFirstAudioAt = Date.now();
            session.metrics.ttsTimeToFirstAudioMs.push(turnMetrics.ttsFirstAudioAt - session.turnStartedAt);
            if (session.lastEndpointAt) {
              const userLatency = turnMetrics.ttsFirstAudioAt - session.lastEndpointAt;
              session.metrics.endOfTurnToFirstAudioMs.push(userLatency);
              session.metrics.userPerceivedLatencyMs.push(userLatency);
            }
          }
          const transportStartedAt = Date.now();
          this.sendAudio(session, event.audio);
          session.metrics.audioTransportDelayMs.push(Date.now() - transportStartedAt);
        } else if (event.type === 'complete') {
          session.metrics.ttsCharacters += Number(event.characters) || 0;
        }
      }
    } finally {
      if (session.currentTurn?.turnId === turnId) session.currentTurn = null;
    }
  }

  interrupt(session) {
    if (session.currentTurn) {
      session.currentTurn.controller.abort(new Error('Caller interrupted'));
      session.currentTurn = null;
    }
    session.llm?.supersede(session.id);
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(
        session.provider === 'vobiz'
          ? { event: 'clearAudio', streamId: session.streamId }
          : { event: 'clear', streamSid: session.streamId }
      ));
    }
  }

  sendAudio(session, audio) {
    session.metrics ||= createPipelineMetrics();
    for (let offset = 0; offset < audio.length; offset += FRAME_BYTES) {
      const frame = audio.subarray(offset, offset + FRAME_BYTES);
      if (frame.length === 0 || session.ws.readyState !== WebSocket.OPEN) return;
      if (!session.metrics.currentTransportStartedAt) {
        session.metrics.currentTransportStartedAt = Date.now();
      }
      if (session.provider === 'vobiz') {
        session.ws.send(JSON.stringify({
          event: 'playAudio',
          streamId: session.streamId || undefined,
          media: { contentType: 'audio/x-mulaw', sampleRate: 8000, payload: frame.toString('base64') },
        }));
      } else {
        session.ws.send(JSON.stringify({
          event: 'media',
          streamSid: session.streamId,
          media: { payload: frame.toString('base64') },
        }));
      }
    }
  }

  async fail(session, error) {
    if (session.closed) return;
    console.error('[STT_LLM_TTS] session failed:', error.message);
    this.closeSession(session, 'stt-llm-tts-error');
  }

  async closeSession(session, reason) {
    if (!session || session.closed) return;
    session.closed = true;
    session.metrics ||= createPipelineMetrics();
    session.currentTurn?.controller.abort(new Error('Call ended'));
    session.stt?.close();
    session.tts?.active?.close?.();
    const tokenUsage = session.llm?.getConversation?.(session.id)?.usage || {};
    session.llm?.closeConversation(session.id);
    this.sessions.delete(session.id);
    if (session.callSessionId) {
      await callSessionService.finalizeSessionFromBridge({
        callSessionId: session.callSessionId,
        callSid: session.providerCallId,
        provider: session.provider,
        reason,
        transcriptTurns: session.transcriptTurns,
        tokenUsage,
        bridgeMetrics: {
          turns: session.turnId,
          pipeline: 'STT_LLM_TTS',
          latency: summarizeLatencies(session.metrics),
          cost: estimatePipelineCost({
            durationMs: Date.now() - session.startedAt,
            audioBytesSentToStt: session.metrics.audioBytesSentToStt,
            ttsCharacters: session.metrics.ttsCharacters,
            llmUsage: session.metrics.llmUsage,
            rates: {
              telephonyPerMinuteInr: process.env.TELEPHONY_COST_PER_MINUTE_INR,
              sttPerMinuteInr: process.env.DEEPGRAM_COST_PER_MINUTE_INR,
              llmInputPerMillionTokensInr: process.env.LLM_INPUT_COST_PER_MILLION_TOKENS_INR,
              llmOutputPerMillionTokensInr: process.env.LLM_OUTPUT_COST_PER_MILLION_TOKENS_INR,
              ttsPerMillionCharactersInr: process.env.ELEVENLABS_COST_PER_MILLION_CHARACTERS_INR,
            },
          }),
        },
      }).catch((error) => console.error('[STT_LLM_TTS] session finalization failed:', error.message));
    }
  }
}

export default new SttLlmTtsCallingService();
