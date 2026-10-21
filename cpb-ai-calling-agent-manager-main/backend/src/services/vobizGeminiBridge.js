import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import Integration from '../models/Integration.js';
import AICaller from '../models/AICaller.js';
import Campaign from '../models/Campaign.js';
import Lead from '../models/Lead.js';
import TelephonyConfig from '../models/TelephonyConfig.js';
import CallSession from '../models/CallSession.js';
import {
  decodeMulawToPcm16,
  encodePcm16ToMulaw,
  getSampleRateFromMimeType,
  resamplePcm16,
} from './audioCodec.js';
import callSessionService from './callSessionService.js';
import vobizService from './vobizService.js';
import { normalizeCallTranscript } from './transcriptText.js';
import {
  languageOpeningDirective,
  languagePreferenceSection,
  openingLanguageLine,
  resolveSessionPromptRegion,
  romanTranscriptRule,
} from './languagePrompts.js';

const VOBIZ_MEDIA_STREAM_PATH = '/api/telephony/vobiz/media-stream';
const GEMINI_LIVE_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
const MAX_QA_CONTEXT_ENTRIES = 20;
const TOOL_END_CALL_NAME = 'end_call';
const VOBIZ_FRAME_MS = 20;
const VOBIZ_FRAME_BYTES = 160; // 20ms @ 8kHz mulaw mono
const CLEAR_AUDIO_ACK_TIMEOUT_MS = 1200;
const VOBIZ_MAX_BUFFERED_FRAMES = 300;
const VOBIZ_BATCH_FRAMES = 1; // one 20ms frame per playAudio event
const DEFAULT_PREWARM_MAX_BUFFER_MS = 5000;
const DEFAULT_PREWARM_ENABLED = true;
const DEFAULT_PREWARM_TTL_MS = 600000; // 10 minutes (Aligned with Hard Stop and Lease)
const PREWARM_ADOPT_WAIT_MS = 4000;
const DEFAULT_VERBOSE_PROGRESS_LOGS = false;
const HARD_STOP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes safety timeout
const SPEECH_RMS_THRESHOLD = 500;

const pcm16HasSpeech = (pcm16Buffer) => {
  if (!pcm16Buffer || pcm16Buffer.length < 2) return false;
  let sum = 0;
  const samples = pcm16Buffer.length >> 1;
  for (let i = 0; i < pcm16Buffer.length; i += 2) {
    const sample = pcm16Buffer.readInt16LE(i);
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(samples, 1)) >= SPEECH_RMS_THRESHOLD;
};

class VobizGeminiBridge {
  constructor() {
    this.wss = null;
    this.sessions = new Map();
    const prewarmEnabledRaw = process.env.VOBIZ_GEMINI_PREWARM_ENABLED ?? String(DEFAULT_PREWARM_ENABLED);
    const prewarmTtlMs = Number.parseInt(
      process.env.VOBIZ_GEMINI_PREWARM_TTL_MS || String(DEFAULT_PREWARM_TTL_MS),
      10
    );
    const prewarmMaxBufferMs = Number.parseInt(
      process.env.VOBIZ_GEMINI_PREWARM_MAX_BUFFER_MS || String(DEFAULT_PREWARM_MAX_BUFFER_MS),
      10
    );
    this.config = {
      prewarmEnabled: String(prewarmEnabledRaw).toLowerCase() !== 'false',
      verboseProgressLogs:
        String(process.env.VOBIZ_GEMINI_VERBOSE_PROGRESS_LOGS || String(DEFAULT_VERBOSE_PROGRESS_LOGS)).toLowerCase() ===
        'true',
      prewarmTtlMs:
        Number.isFinite(prewarmTtlMs) && prewarmTtlMs > 0 ? prewarmTtlMs : DEFAULT_PREWARM_TTL_MS,
      prewarmMaxBufferMs:
        Number.isFinite(prewarmMaxBufferMs) && prewarmMaxBufferMs > 0
          ? prewarmMaxBufferMs
          : DEFAULT_PREWARM_MAX_BUFFER_MS,
      tokenPricingUsdPer1M: {
        inputText: Number.parseFloat(process.env.VOBIZ_GEMINI_INPUT_TEXT_USD_PER_1M) || 0.75,
        inputAudio: Number.parseFloat(process.env.VOBIZ_GEMINI_INPUT_AUDIO_USD_PER_1M) || 3.0,
        inputImageVideo: Number.parseFloat(process.env.VOBIZ_GEMINI_INPUT_IMAGE_VIDEO_USD_PER_1M) || 1.0,
        outputText: Number.parseFloat(process.env.VOBIZ_GEMINI_OUTPUT_TEXT_USD_PER_1M) || 4.5,
        outputAudio: Number.parseFloat(process.env.VOBIZ_GEMINI_OUTPUT_AUDIO_USD_PER_1M) || 12.0,
      },
      // INR to USD conversion rate (override via env var). Default ~0.012 (1 INR ~= 0.012 USD)
      inrToUsdRate: Number.parseFloat(process.env.INR_TO_USD_RATE) || 0.012,
      // Vobiz platform per-minute INR cost (0.45 + 0.2 = 0.65 INR/min)
      vobizInrPerMinute: Number.parseFloat(process.env.VOBIZ_INR_PER_MINUTE) || 0.65,
      progressLogsEnabled: String(process.env.VOBIZ_BRIDGE_PROGRESS_LOGS || 'false').toLowerCase() === 'true',
    };
    this.prewarmedCalls = new Map();
    this.agentNamesBySessionId = new Map();
    this.agentNamesByCallSessionId = new Map();
    this.runtimeMetrics = {
      startedAt: new Date().toISOString(),
      sessionsStarted: 0,
      sessionsClosed: 0,
    };
  }

  log(level, message, data = {}) {
    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    const enriched = this.withAgentName(data);
    const agentName = enriched?.agentName;
    const prefix = agentName ? `[VobizGeminiBridge] [${agentName}]` : '[VobizGeminiBridge]';
    logger(prefix, message, enriched);
  }

  agentNameFromSession(session) {
    return this.sanitizePromptValue(session?.aiCaller?.name || session?.params?.agentName, 200);
  }

  async ensureAgentName(session) {
    const known = this.agentNameFromSession(session);
    if (known) {
      this.rememberAgent(session);
      return known;
    }

    const mapped = this.lookupAgentName({
      sessionId: session?.id,
      callSessionId: session?.callSessionId,
    });
    if (mapped) {
      session.params = { ...(session.params || {}), agentName: mapped };
      this.rememberAgent(session);
      return mapped;
    }

    try {
      let aiCallerId = this.sanitizePromptValue(session?.params?.aiCallerId, 120);
      if (!aiCallerId && session?.callSessionId) {
        const persisted = await CallSession.findById(session.callSessionId).select('callerId');
        aiCallerId = this.sanitizePromptValue(persisted?.callerId, 120);
      }
      if (!aiCallerId) return '';

      const caller = await AICaller.findById(aiCallerId).select('name');
      const agentName = this.sanitizePromptValue(caller?.name, 200);
      if (!agentName) return '';

      session.params = { ...(session.params || {}), aiCallerId, agentName };
      if (session.aiCaller) {
        session.aiCaller.name = session.aiCaller.name || agentName;
      }
      this.rememberAgent(session);
      return agentName;
    } catch (error) {
      this.log('warn', 'Failed to resolve AI caller name', {
        sessionId: session?.id,
        callSessionId: session?.callSessionId,
        message: error?.message,
      });
      return '';
    }
  }

  rememberAgent(session) {
    const agentName = this.agentNameFromSession(session);
    if (!agentName) return;
    if (session?.id) this.agentNamesBySessionId.set(session.id, agentName);
    const callSessionId = this.sanitizePromptValue(session?.callSessionId, 120);
    if (callSessionId) this.agentNamesByCallSessionId.set(callSessionId, agentName);
  }

  forgetAgent(session) {
    if (session?.id) this.agentNamesBySessionId.delete(session.id);
    const callSessionId = this.sanitizePromptValue(session?.callSessionId, 120);
    if (callSessionId) this.agentNamesByCallSessionId.delete(callSessionId);
  }

  lookupAgentName(data = {}) {
    const sessionId = data.sessionId || data.prewarmSessionId;
    if (sessionId && this.agentNamesBySessionId.has(sessionId)) {
      return this.agentNamesBySessionId.get(sessionId);
    }
    const callSessionId = data.callSessionId ? String(data.callSessionId) : '';
    if (callSessionId && this.agentNamesByCallSessionId.has(callSessionId)) {
      return this.agentNamesByCallSessionId.get(callSessionId);
    }
    const session =
      (sessionId && this.sessions.get(sessionId)) ||
      (callSessionId && this.prewarmedCalls.get(callSessionId)) ||
      null;
    return this.agentNameFromSession(session);
  }

  withAgentName(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.agentName) return data;
    const agentName = this.lookupAgentName(data);
    if (!agentName) return data;
    return { ...data, agentName };
  }

  logVerbose(message, data = {}) {
    if (!this.config.verboseProgressLogs) {
      return;
    }
    this.log('info', message, data);
  }

  createSessionMetrics() {
    return {
      createdAtMs: Date.now(),
      providerEvents: {},
      mediaPacketsIn: 0,
      mediaBytesIn: 0,
      modelMessagesIn: 0,
      modelAudioPartsIn: 0,
      modelAudioBytesIn: 0,
      userAudioChunksSentToModel: 0,
      userAudioBytesSentToModel: 0,
      playbackFramesSent: 0,
      playbackFramesDropped: 0,
      interruptions: 0,
      setupCompleteMs: null,
      playbackQueueHighWaterMark: 0,
      toolCallsIn: 0,
      topLevelToolCallsIn: 0,
      modelTurnPartToolCallsIn: 0,
      toolResponsesOut: 0,
      endCallRequests: 0,
      proactiveGreetingPrompts: 0,
      proactiveGreetingRetries: 0,
      maxCallDurationSeconds: null,
      maxDurationWrapUpSent: false,
      firstModelAudioLatencyMs: null,
      usageMetadataEvents: 0,
      playbackEventsSent: 0,
      playAudioDropped: 0,
      prewarmAudioPartsDropped: 0,
      tokenUsage: {
        promptTokenCount: 0,
        responseTokenCount: 0,
        totalTokenCount: 0,
        thoughtsTokenCount: 0,
        cachedContentTokenCount: 0,
        toolUsePromptTokenCount: 0,
        promptTokensByModality: { text: 0, audio: 0, image: 0, video: 0, other: 0 },
        responseTokensByModality: { text: 0, audio: 0, image: 0, video: 0, other: 0 },
      },
      estimatedTokenCostUsd: {
        inputUsd: 0,
        outputUsd: 0,
        totalUsd: 0,
      },
      geminiAudioPartArrivalTimestamps: [],
      playAudioSendTimestamps: [],
    };
  }

  extractProviderCallId(payload = {}) {
    return this.sanitizePromptValue(
      payload?.call_uuid ||
      payload?.callId ||
      payload?.call_id ||
      payload?.uuid ||
      payload?.sid ||
      payload?.id ||
      payload?.call?.uuid ||
      payload?.call?.id ||
      payload?.data?.call_uuid ||
      payload?.data?.callId ||
      payload?.response?.call_uuid ||
      '',
      120
    );
  }

  elapsedMs(session) {
    return Date.now() - session.metrics.createdAtMs;
  }

  rememberTranscript(session, speaker, text, extra = {}) {
    const cleaned = normalizeCallTranscript(text);
    if (!cleaned) return false;
    session.transcript.push({
      speaker,
      text: cleaned,
      timestamp: new Date().toISOString(),
      ...extra,
    });
    return true;
  }

  sanitizePromptValue(value, maxLength = 2000) {
    if (value === null || value === undefined) return '';
    const str = String(value)
      .replace(/\u0000/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!maxLength || maxLength <= 0) return str;
    return str.slice(0, maxLength);
  }

  clearProactiveGreetingRetryTimer(session) {
    if (session.proactiveGreetingRetryTimer) {
      clearTimeout(session.proactiveGreetingRetryTimer);
      session.proactiveGreetingRetryTimer = null;
    }
  }

  sendRealtimeTextInstruction(session, text) {
    const cleanText = this.sanitizePromptValue(text, 3000);
    if (!cleanText) return;
    if (!session.geminiWs || session.geminiWs.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Skipped realtime text instruction because Gemini socket is not open', {
        sessionId: session.id,
      });
      return;
    }

    session.geminiWs.send(
      JSON.stringify({
        realtimeInput: {
          text: cleanText,
        },
      })
    );
  }

  getBufferedMulawMs(session) {
    const queuedFramesMs = (session.outboundMulawQueue?.length || 0) * VOBIZ_FRAME_MS;
    const partialFrameMs = session.outboundMulawRemainder?.length
      ? Math.round((session.outboundMulawRemainder.length / VOBIZ_FRAME_BYTES) * VOBIZ_FRAME_MS)
      : 0;
    return queuedFramesMs + partialFrameMs;
  }

  markModelAudioStarted(session) {
    if (session.firstModelAudioAtMs) return;
    session.firstModelAudioAtMs = Date.now();
    this.clearProactiveGreetingRetryTimer(session);
    if (session.setupCompletedAtMs) {
      session.metrics.firstModelAudioLatencyMs = session.firstModelAudioAtMs - session.setupCompletedAtMs;
    }
    this.log('info', 'First model audio detected', {
      sessionId: session.id,
      firstModelAudioLatencyMs: session.metrics.firstModelAudioLatencyMs,
      proactiveGreetingPrompts: session.metrics.proactiveGreetingPrompts,
      proactiveGreetingRetries: session.metrics.proactiveGreetingRetries,
    });
  }

  buildProactiveGreetingInstruction(session) {
    const leadName = this.sanitizePromptValue(session.lead?.name, 80);
    const callerName = this.sanitizePromptValue(session.aiCaller?.name, 120);
    const preferredLanguage =
      this.sanitizePromptValue(session.params.language, 30) ||
      this.sanitizePromptValue(session.aiCaller?.s2sConfig?.language, 30);
    const promptRegion = resolveSessionPromptRegion(session);

    const context = [];
    if (callerName) context.push(`Caller identity/context: ${callerName}.`);
    if (leadName) context.push(`Lead first name: ${leadName}.`);
    if (preferredLanguage) context.push(openingLanguageLine(preferredLanguage, promptRegion));

    if (session.isPrewarmSession) {
      return [
        'SYSTEM DIRECTIVE: The call may connect soon. Generate exactly one short opening line now.',
        'Keep it under 12 words and then wait silently for the user.',
        'Do not continue speaking, and do not end the call, until user speech is detected.',
        ...context,
      ].join(' ');
    }

    return [
      'SYSTEM DIRECTIVE: The call has just connected. Respond immediately with a short, friendly opening line.',
      'If the user has already said hello, acknowledge them directly instead of repeating a long intro.',
      'Keep the opener under 12 words and then continue naturally.',
      ...context,
      'Do not wait for additional input before speaking.',
    ].join(' ');
  }

  requestProactiveGreeting(session, reason = 'setup-complete') {
    if (!this.sessions.has(session.id)) return;
    if (!session.geminiReady) return;
    if (session.firstModelAudioAtMs) return;
    if (session.metrics.proactiveGreetingPrompts > 0 && reason === 'setup-complete') return;

    const instruction = this.buildProactiveGreetingInstruction(session);
    this.sendRealtimeTextInstruction(session, instruction);
    session.metrics.proactiveGreetingPrompts += 1;
    if (reason !== 'setup-complete') session.metrics.proactiveGreetingRetries += 1;

    this.log('info', 'Proactive greeting requested', {
      sessionId: session.id,
      reason,
      proactiveGreetingPrompts: session.metrics.proactiveGreetingPrompts,
      proactiveGreetingRetries: session.metrics.proactiveGreetingRetries,
    });

    this.clearProactiveGreetingRetryTimer(session);
    if (!session.firstModelAudioAtMs && session.metrics.proactiveGreetingRetries < 1) {
      session.proactiveGreetingRetryTimer = setTimeout(() => {
        if (!this.sessions.has(session.id)) return;
        if (session.firstModelAudioAtMs) return;
        this.requestProactiveGreeting(session, 'retry-timeout');
      }, 2200);
    }
  }

  initialize(server) {
    if (this.wss) return;

    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      if (requestUrl.pathname !== VOBIZ_MEDIA_STREAM_PATH) return;

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (ws, request) => {
      this.handleVobizConnection(ws, request).catch((err) => {
        this.log('error', 'Vobiz connection error', { message: err?.message });
        try {
          if (ws && ws.readyState === WebSocket.OPEN) ws.close();
        } catch (e) { }
      });
    });

    this.log('info', 'Vobiz WebSocket bridge initialized');
  }

  async resolveIntegration(customParams) {
    const explicitId = customParams.integrationId;
    if (explicitId) {
      const integration = await Integration.findOne({ _id: explicitId, isActive: true });
      if (integration) return integration;
    }

    const aiCallerId = customParams.aiCallerId;
    if (aiCallerId) {
      const caller = await AICaller.findById(aiCallerId).select('s2sConfig');
      const callerIntegrationId = caller?.s2sConfig?.integrationId;
      if (callerIntegrationId) {
        const integration = await Integration.findOne({ _id: callerIntegrationId, isActive: true });
        if (integration) return integration;
      }
    }

    const defaultGeminiIntegration = await Integration.findOne({
      type: 's2s',
      isActive: true,
      $or: [
        { isDefault: true },
        { name: /gemini/i },
        { 'metadata.templateId': 'gemini_live' },
      ],
    }).sort({ isDefault: -1, updatedAt: -1 });

    return defaultGeminiIntegration;
  }

  async handleVobizConnection(ws, request) {
    const sessionId = randomUUID();
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const params = Object.fromEntries(requestUrl.searchParams.entries());
    const callSessionId = this.sanitizePromptValue(params.callSessionId, 120) || null;

    const session = {
      id: sessionId,
      vobizWs: ws,
      geminiWs: null,
      params: { ...params },
      aiCaller: null,
      campaign: null,
      lead: null,
      callSessionId: null,
      providerCallId: this.sanitizePromptValue(params.callSid, 120) || null,
      vobizStreamId: null,
      transcript: [],
      modelIsSpeaking: false,
      pendingAudioChunks: [],
      geminiReady: false,
      setupCompletedAtMs: null,
      firstModelAudioAtMs: null,
      proactiveGreetingRetryTimer: null,
      awaitingClearAudioAck: false,
      clearAudioAckTimer: null,
      maxCallDurationTimer: null,
      maxCallDurationHardStopTimer: null,
      maxCallDurationSeconds: null,
      maxDurationWrapUpRequested: false,
      endingCallInProgress: false,
      toolEndReason: '',
      toolEndSummary: '',
      model: null,
      outboundMulawQueue: [],
      outboundMulawRemainder: Buffer.alloc(0),
      outboundResampleSourceRate: null,
      vobizPlaybackTimer: null,
      sttWs: null,
      sttReady: false,
      sttHumanQueue: [],
      sttHumanRemainder: Buffer.alloc(0),
      sttAiQueue: [],
      sttAiRemainder: Buffer.alloc(0),
      sttMixerTimer: null,
      metrics: this.createSessionMetrics(),
      closeMeta: { vobiz: null, gemini: null },
      usageTurnIndex: 0,
      usageByResponseId: new Map(),
      processedToolCallIds: new Set(),
      lastQueueHighWarnAtMs: 0,
    };

    session.callSessionId = callSessionId;
    if (callSessionId && this.agentNamesByCallSessionId.has(callSessionId)) {
      this.agentNamesBySessionId.set(sessionId, this.agentNamesByCallSessionId.get(callSessionId));
    }

    this.sessions.set(sessionId, session);
    this.runtimeMetrics.sessionsStarted += 1;

    this.log('info', 'Vobiz client connected', { sessionId, callSessionId, url: request.url });

    if (this.config.prewarmEnabled && callSessionId) {
      this.prewarmCallSession({ callSessionId, params }).catch((error) => {
        this.log('warn', 'Failed to start Vobiz prewarm session', {
          sessionId,
          callSessionId,
          message: error?.message,
        });
      });
    }

    ws.on('message', async (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        await this.handleVobizMessage(session, message);
      } catch (err) {
        this.log('error', 'Failed to process Vobiz message', { sessionId: session.id, message: err?.message });
      }
    });

    ws.on('close', (code, reasonBuffer) => {
      const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || '');
      session.closeMeta.vobiz = { code, reason };
      this.log('info', 'Vobiz socket closed', { sessionId, code, reason });
      this.log('info', 'Vobiz close summary', {
        sessionId,
        packetsIn: session.metrics.mediaPacketsIn,
        bytesIn: session.metrics.mediaBytesIn,
        modelMessagesIn: session.metrics.modelMessagesIn,
        modelAudioPartsIn: session.metrics.modelAudioPartsIn,
        playbackEventsSent: session.metrics.playbackEventsSent,
        playbackQueueHighWaterMark: session.metrics.playbackQueueHighWaterMark,
        awaitingClearAudioAck: session.awaitingClearAudioAck,
        providerEvents: session.metrics.providerEvents,
      });
      this.closeSession(session, 'vobiz-close');
    });

    ws.on('error', (error) => {
      this.log('error', 'Vobiz socket error', { sessionId, message: error?.message });
      this.closeSession(session, 'vobiz-error');
    });
  }

  async handleVobizMessage(session, message) {
    const event = (message?.event || '').toLowerCase();
    const metricKey = event || 'unknown';
    session.metrics.providerEvents[metricKey] = (session.metrics.providerEvents[metricKey] || 0) + 1;

    switch (event) {
      case 'connected':
        this.log('info', 'Vobiz connected event', {
          sessionId: session.id,
          protocol: message?.protocol,
        });
        break;
      case 'start':
        await this.handleStart(session, message);
        break;
      case 'media':
        this.handleMediaEvent(session, message);
        break;
      case 'clearedaudio':
        this.handleClearedAudio(session, message);
        break;
      case 'playedstream':
        this.log('info', 'Vobiz playback acknowledged', {
          sessionId: session.id,
          name: message?.name || message?.Name || undefined,
        });
        break;
      case 'error':
        this.log('error', 'Vobiz stream error event', {
          sessionId: session.id,
          message,
        });
        break;
      case 'stop':
        this.log('info', 'Vobiz stop event', { sessionId: session.id });
        this.closeSession(session, 'vobiz-stop');
        break;
      default:
        this.log('info', 'Vobiz unhandled event', {
          sessionId: session.id,
          event,
          keys: Object.keys(message || {}),
        });
        break;
    }
  }

  async handleStart(session, message) {
    const startParams = message.start?.parameters || message.start?.customParameters || {};
    session.params = { ...(session.params || {}), ...(startParams || {}) };
    const providerCallIdFromEvent =
      this.extractProviderCallId(message?.start || {}) || this.extractProviderCallId(message || {});
    if (providerCallIdFromEvent) {
      session.providerCallId = providerCallIdFromEvent;
      session.params.callSid = session.params.callSid || providerCallIdFromEvent;
    }
    session.vobizStreamId =
      this.sanitizePromptValue(message.start?.streamId || message.streamId || message.start?.StreamSid, 120) ||
      session.vobizStreamId ||
      null;
    session.callSessionId = this.sanitizePromptValue(session.params.callSessionId, 120) || null;
    if (!session.providerCallId && session.callSessionId) {
      try {
        const persistedSession = await CallSession.findById(session.callSessionId).select('providerCallId twilioCallSid');
        const persistedProviderCallId = this.sanitizePromptValue(
          persistedSession?.providerCallId || persistedSession?.twilioCallSid || '',
          120
        );
        if (persistedProviderCallId) {
          session.providerCallId = persistedProviderCallId;
          session.params.callSid = session.params.callSid || persistedProviderCallId;
        }
      } catch (error) {
        this.log('warn', 'Failed to load provider call id for Vobiz bridge start', {
          sessionId: session.id,
          callSessionId: session.callSessionId,
          message: error?.message,
        });
      }
    }
    session.connectedAt = session.connectedAt || new Date();
    session.status = 'connected';

    if (await this.adoptPrewarmedCall(session)) {
      this.scheduleMaxCallDuration(session);
      // Always wire the hard-stop safety timer on the live session
      this.scheduleHardStopTimeout(session);
      // Start no-response watchdog — hangs up if user never sends audio
      this.scheduleNoResponseTimeout(session);
      if (session.outboundMulawQueue.length > 0) {
        this.log('info', 'Using prewarmed Vobiz greeting audio after adopt', {
          sessionId: session.id,
          bufferedFrames: session.outboundMulawQueue.length,
        });
        this.ensureVobizPlaybackLoop(session);
      } else if (!session.firstModelAudioAtMs) {
        this.requestProactiveGreeting(session, 'post-adopt-no-buffer');
      }
      return;
    }

    if (session.params.aiCallerId) {
      session.aiCaller = await AICaller.findById(session.params.aiCallerId).select(
        'name description s2sConfig qaEntries guardrails'
      );
      this.rememberAgent(session);
    }

    if (session.params.campaignId) {
      session.campaign = await Campaign.findById(session.params.campaignId).select(
        'name description settings'
      );
    }

    if (session.params.leadId) {
      session.lead = await Lead.findById(session.params.leadId).select(
        'name phone phoneNumber email customFields'
      );
    }

    // resolve integration and connect Gemini
    session.integration = await this.resolveIntegration(session.params);
    if (!session.integration) {
      this.log('error', 'No S2S integration available for Vobiz session', { sessionId: session.id });
      this.closeSession(session, 'no-integration');
      return;
    }

    try {
      await this.connectGeminiSession(session);
      // Schedule hard-stop timeout for safety
      this.scheduleHardStopTimeout(session);
    } catch (err) {
      this.log('error', 'Failed to start Gemini session for Vobiz', {
        sessionId: session.id,
        message: err?.message,
      });
      this.closeSession(session, 'gemini-start-failed');
    }
  }

  async startVobizRecording(session) {
    const callUuid = session.providerCallId;
    if (!callUuid) {
      this.log('warn', 'Skipping Vobiz recording: no providerCallId available', {
        sessionId: session.id,
      });
      return;
    }

    try {
      let telephony = null;
      const telephonyIntegrationId = session.params?.telephonyIntegrationId;
      if (telephonyIntegrationId) {
        telephony = await Integration.findOne({ _id: telephonyIntegrationId, type: 'telephony' });
      }
      if (!telephony) {
        telephony = await Integration.findOne({ type: 'telephony', isDefault: true, isActive: true });
      }

      const metadata = telephony?.metadata instanceof Map ? Object.fromEntries(telephony.metadata) : (telephony?.metadata || {});
      const authId = telephony?.authConfig?.username;
      const authToken = telephony?.authConfig?.password;

      if (!authId || !authToken) {
        this.log('warn', 'Skipping Vobiz recording: missing Vobiz credentials', {
          sessionId: session.id,
        });
        return;
      }

      const result = await vobizService.startRecording({
        authId,
        authToken,
        callUuid,
        apiBaseUrl: metadata.apiBaseUrl || '',
      });

      if (result.success) {
        this.log('info', 'Vobiz recording started', { sessionId: session.id, callUuid });
      } else {
        this.log('warn', 'Vobiz recording API returned failure', {
          sessionId: session.id,
          callUuid,
          error: result.error,
        });
      }
    } catch (error) {
      this.log('warn', 'Vobiz recording exception', {
        sessionId: session.id,
        callUuid,
        message: error?.message,
      });
    }
  }

  async prewarmCallSession({ callSessionId, params = {} } = {}) {
    if (!this.config.prewarmEnabled) {
      return { success: false, reason: 'prewarm-disabled' };
    }

    const normalizedCallSessionId = this.sanitizePromptValue(callSessionId, 120);
    if (!normalizedCallSessionId) {
      return { success: false, reason: 'missing-call-session-id' };
    }

    if (this.prewarmedCalls.has(normalizedCallSessionId)) {
      const existing = this.prewarmedCalls.get(normalizedCallSessionId);
      const incomingName = this.sanitizePromptValue(params.agentName, 200);
      if (incomingName && !this.agentNameFromSession(existing)) {
        existing.params = { ...(existing.params || {}), agentName: incomingName };
        this.rememberAgent(existing);
      }
      return { success: true, reused: true, sessionId: existing?.id };
    }

    const prewarmSession = {
      id: `prewarm-${randomUUID()}`,
      vobizWs: null,
      geminiWs: null,
      params: { ...params },
      aiCaller: null,
      campaign: null,
      lead: null,
      callSessionId: normalizedCallSessionId,
      providerCallId: this.sanitizePromptValue(params.callSid, 120) || null,
      vobizStreamId: null,
      transcript: [],
      modelIsSpeaking: false,
      pendingAudioChunks: [],
      geminiReady: false,
      setupCompletedAtMs: null,
      firstModelAudioAtMs: null,
      proactiveGreetingRetryTimer: null,
      awaitingClearAudioAck: false,
      clearAudioAckTimer: null,
      maxCallDurationTimer: null,
      maxCallDurationHardStopTimer: null,
      maxCallDurationSeconds: null,
      maxDurationWrapUpRequested: false,
      endingCallInProgress: false,
      toolEndReason: '',
      toolEndSummary: '',
      model: null,
      outboundMulawQueue: [],
      outboundMulawRemainder: Buffer.alloc(0),
      outboundResampleSourceRate: null,
      vobizPlaybackTimer: null,
      sttWs: null,
      sttReady: false,
      sttHumanQueue: [],
      sttHumanRemainder: Buffer.alloc(0),
      sttAiQueue: [],
      sttAiRemainder: Buffer.alloc(0),
      sttMixerTimer: null,
      metrics: this.createSessionMetrics(),
      closeMeta: { vobiz: null, gemini: null },
      isPrewarmSession: true,
      abandoned: false,
      usageTurnIndex: 0,
      usageByResponseId: new Map(),
      processedToolCallIds: new Set(),
      lastQueueHighWarnAtMs: 0,
    };

    this.attachPrewarmConnectGate(prewarmSession);
    this.sessions.set(prewarmSession.id, prewarmSession);
    this.prewarmedCalls.set(normalizedCallSessionId, prewarmSession);
    this.rememberAgent(prewarmSession);

    prewarmSession.prewarmExpiryTimer = setTimeout(() => {
      if (!this.sessions.has(prewarmSession.id)) return;
      this.log('warn', 'Vobiz prewarm session expired before stream start', {
        callSessionId: normalizedCallSessionId,
        prewarmTtlMs: this.config.prewarmTtlMs,
      });
      this.closeSession(prewarmSession, 'prewarm-timeout');
    }, this.config.prewarmTtlMs);

    try {
      if (prewarmSession.params.aiCallerId) {
        prewarmSession.aiCaller = await AICaller.findById(prewarmSession.params.aiCallerId).select(
          'name description s2sConfig qaEntries guardrails'
        );
        this.rememberAgent(prewarmSession);
      }
      if (this.prewarmStopped(prewarmSession)) {
        return { success: false, reason: 'prewarm-abandoned' };
      }

      if (prewarmSession.params.campaignId) {
        prewarmSession.campaign = await Campaign.findById(prewarmSession.params.campaignId).select(
          'name description settings'
        );
      }
      if (this.prewarmStopped(prewarmSession)) {
        return { success: false, reason: 'prewarm-abandoned' };
      }

      if (prewarmSession.params.leadId) {
        prewarmSession.lead = await Lead.findById(prewarmSession.params.leadId).select(
          'name phone phoneNumber email customFields'
        );
      }
      if (this.prewarmStopped(prewarmSession)) {
        return { success: false, reason: 'prewarm-abandoned' };
      }

      this.log('info', 'Starting Vobiz Gemini prewarm session', {
        callSessionId: normalizedCallSessionId,
        sessionId: prewarmSession.id,
        prewarmTtlMs: this.config.prewarmTtlMs,
      });

      const integration = await this.resolveIntegration(prewarmSession.params);
      if (!integration) {
        throw new Error('No active S2S integration found for prewarm');
      }

      prewarmSession.integration = integration;
      if (this.prewarmStopped(prewarmSession)) {
        return { success: false, reason: 'prewarm-abandoned' };
      }
      await this.connectGeminiSession(prewarmSession);
      if (this.prewarmStopped(prewarmSession)) {
        return { success: false, reason: 'prewarm-abandoned' };
      }
      return { success: true, sessionId: prewarmSession.id };
    } catch (error) {
      this.log('warn', 'Failed to start Vobiz prewarm session', {
        callSessionId: normalizedCallSessionId,
        message: error?.message,
      });
      this.closeSession(prewarmSession, 'prewarm-setup-failed');
      return { success: false, reason: 'prewarm-setup-failed', error: error?.message };
    }
  }

  async adoptPrewarmedCall(session) {
    const callSessionId = this.sanitizePromptValue(session.callSessionId, 120);
    if (!callSessionId) return false;

    const prewarmed = this.prewarmedCalls.get(callSessionId);
    if (!prewarmed || prewarmed.id === session.id) return false;

    this.prewarmedCalls.delete(callSessionId);

    if (prewarmed.prewarmExpiryTimer) {
      clearTimeout(prewarmed.prewarmExpiryTimer);
      prewarmed.prewarmExpiryTimer = null;
    }

    this.clearProactiveGreetingRetryTimer(prewarmed);

    const socketReadyAtClaim = this.prewarmSocketUsable(prewarmed);
    if (!socketReadyAtClaim) {
      await this.waitForPrewarmSocket(prewarmed);
    }

    if (!this.prewarmSocketUsable(prewarmed)) {
      const agentName = await this.ensureAgentName(prewarmed);
      const readyState = prewarmed.geminiWs?.readyState;
      this.log('warn', prewarmed.geminiWs
        ? 'Prewarmed Gemini websocket was not usable at adopt time'
        : 'Prewarmed Vobiz session had no Gemini websocket at adopt time', {
        prewarmSessionId: prewarmed.id,
        callSessionId,
        ...(readyState !== undefined ? { readyState } : {}),
        ...(agentName ? { agentName } : {}),
      });
      this.agentNamesBySessionId.delete(prewarmed.id);
      this.abandonPrewarm(prewarmed, 'prewarm-not-ready');
      return false;
    }

    prewarmed.geminiWs.removeAllListeners('message');
    prewarmed.geminiWs.removeAllListeners('error');
    prewarmed.geminiWs.removeAllListeners('close');
    session.geminiWs = prewarmed.geminiWs;
    this.attachGeminiSocketListeners(session);

    session.integration = prewarmed.integration || session.integration;
    session.aiCaller = prewarmed.aiCaller || session.aiCaller;
    this.rememberAgent(session);
    session.campaign = prewarmed.campaign || session.campaign;
    session.lead = prewarmed.lead || session.lead;
    session.params = { ...(prewarmed.params || {}), ...(session.params || {}) };
    session.callSessionId = session.callSessionId || prewarmed.callSessionId || null;
    session.providerCallId = session.providerCallId || prewarmed.providerCallId || null;
    session.geminiReady = prewarmed.geminiReady;
    session.transcript = Array.isArray(prewarmed.transcript) ? prewarmed.transcript : [];
    session.modelIsSpeaking = Boolean(prewarmed.modelIsSpeaking);
    session.outboundMulawQueue = Array.isArray(prewarmed.outboundMulawQueue)
      ? prewarmed.outboundMulawQueue
      : [];
    session.outboundMulawRemainder = prewarmed.outboundMulawRemainder || Buffer.alloc(0);
    session.outboundResampleSourceRate = prewarmed.outboundResampleSourceRate || null;
    session.setupCompletedAtMs = prewarmed.setupCompletedAtMs || null;
    session.firstModelAudioAtMs = prewarmed.firstModelAudioAtMs || null;
    session.usageTurnIndex = prewarmed.usageTurnIndex || 0;
    session.usageByResponseId =
      prewarmed.usageByResponseId instanceof Map ? new Map(prewarmed.usageByResponseId) : new Map();
    session.processedToolCallIds =
      prewarmed.processedToolCallIds instanceof Set ? new Set(prewarmed.processedToolCallIds) : new Set();
    session.toolEndReason = prewarmed.toolEndReason || '';
    session.toolEndSummary = prewarmed.toolEndSummary || '';

    // Always open a FRESH Deepgram connection on the live session.
    // Deepgram closes idle WebSocket connections after ~10-15s of no audio, 
    // which happens during the prewarm ringing phase.
    // We discard the prewarm socket and reconnect instantly.
    if (prewarmed.sttMixerTimer) {
      clearInterval(prewarmed.sttMixerTimer);
      prewarmed.sttMixerTimer = null;
    }
    if (prewarmed.sttWs) {
      try {
        prewarmed.sttWs.removeAllListeners();
        prewarmed.sttWs.close();
      } catch (e) { /* ignore */ }
    }
    
    // Reset STT state on the live session
    session.sttWs = null;
    session.sttReady = false;
    session.sttHumanQueue = [];
    session.sttHumanRemainder = Buffer.alloc(0);
    session.sttAiQueue = [];
    session.sttAiRemainder = Buffer.alloc(0);
    session.sttMixerTimer = null;
    
    // Open fresh connection — will be ready within ~200ms
    this.connectDeepgram(session);
    this.log('info', 'Deepgram STT reconnecting on live session (prewarm socket discarded)', {
      prewarmSessionId: prewarmed.id,
    });


    session.metrics.modelMessagesIn += prewarmed.metrics.modelMessagesIn;
    session.metrics.modelAudioPartsIn += prewarmed.metrics.modelAudioPartsIn;
    session.metrics.modelAudioBytesIn += prewarmed.metrics.modelAudioBytesIn;
    session.metrics.proactiveGreetingPrompts += prewarmed.metrics.proactiveGreetingPrompts;
    session.metrics.proactiveGreetingRetries += prewarmed.metrics.proactiveGreetingRetries;
    session.metrics.setupCompleteMs = prewarmed.metrics.setupCompleteMs ?? session.metrics.setupCompleteMs;
    session.metrics.firstModelAudioLatencyMs =
      prewarmed.metrics.firstModelAudioLatencyMs ?? session.metrics.firstModelAudioLatencyMs;

    this.sessions.delete(prewarmed.id);

    this.log('info', 'Adopted prewarmed Vobiz Gemini session', {
      sessionId: session.id,
      prewarmSessionId: prewarmed.id,
      bufferedFrames: session.outboundMulawQueue.length,
      geminiReady: session.geminiReady,
    });
    this.agentNamesBySessionId.delete(prewarmed.id);

    return true;
  }

  handleMediaEvent(session, message) {
    const payload = message?.media?.payload || message?.payload || '';
    if (!payload) return;
    session.metrics.mediaPacketsIn += 1;
    const vobizAudio = Buffer.from(payload, 'base64');
    session.metrics.mediaBytesIn += vobizAudio.length;
    const pcm8 = decodeMulawToPcm16(vobizAudio);
    const pcm16 = resamplePcm16(pcm8, 8000, 16000);
    const encoded = pcm16.toString('base64');

    if (pcm16HasSpeech(pcm16)) {
      session.lastActiveMs = Date.now();
    }

    if (session.sttReady) {
      session.sttHumanQueue.push(pcm16);
    }

    if (this.config.progressLogsEnabled && session.metrics.mediaPacketsIn % 500 === 0) {
      this.log('info', 'Vobiz inbound media progress', {
        sessionId: session.id,
        packetsIn: session.metrics.mediaPacketsIn,
        bytesIn: session.metrics.mediaBytesIn,
        geminiReady: session.geminiReady,
        pendingGeminiAudioChunks: session.pendingAudioChunks.length,
      });
    }

    if (!session.geminiWs || session.geminiWs.readyState !== WebSocket.OPEN || !session.geminiReady) {
      session.pendingAudioChunks.push(encoded);
      return;
    }

    this.sendAudioChunkToGemini(session, encoded);
  }

  sendAudioChunkToGemini(session, base64Pcm16) {
    if (!session.geminiWs || session.geminiWs.readyState !== WebSocket.OPEN) return;
    const payload = {
      realtimeInput: {
        audio: {
          data: base64Pcm16,
          mimeType: 'audio/pcm;rate=16000',
        },
      },
    };
    session.geminiWs.send(JSON.stringify(payload));
    session.metrics.userAudioChunksSentToModel += 1;
    session.metrics.userAudioBytesSentToModel += Buffer.byteLength(base64Pcm16, 'base64');

    if (this.config.progressLogsEnabled && session.metrics.userAudioChunksSentToModel % 500 === 0) {
      this.log('info', 'Gemini user audio chunks sent', {
        sessionId: session.id,
        chunksOut: session.metrics.userAudioChunksSentToModel,
        bytesOut: session.metrics.userAudioBytesSentToModel,
      });
    }
  }

  queueVobizAudio(session, pcm16Buffer) {
    if (!pcm16Buffer || pcm16Buffer.length === 0) return;
    const combined = session.outboundMulawRemainder.length
      ? Buffer.concat([session.outboundMulawRemainder, pcm16Buffer])
      : pcm16Buffer;

    let offset = 0;
    while (combined.length - offset >= VOBIZ_FRAME_BYTES) {
      session.outboundMulawQueue.push(combined.subarray(offset, offset + VOBIZ_FRAME_BYTES));
      offset += VOBIZ_FRAME_BYTES;
    }

    session.outboundMulawRemainder = combined.subarray(offset);
    if (session.outboundMulawQueue.length > session.metrics.playbackQueueHighWaterMark) {
      session.metrics.playbackQueueHighWaterMark = session.outboundMulawQueue.length;
    }
    // Only log if playback queue is critically backed up (>600 frames / 12s), avoiding false alarms during normal proactive greeting
    if (session.outboundMulawQueue.length > 600) {
      const nowMs = Date.now();
      if (nowMs - (session.lastQueueHighWarnAtMs || 0) >= 10000) {
        session.lastQueueHighWarnAtMs = nowMs;
        this.log('debug', 'Vobiz playback queue backlog', {
          sessionId: session.id,
          queuedFrames: session.outboundMulawQueue.length,
          queuedMs: session.outboundMulawQueue.length * VOBIZ_FRAME_MS,
        });
      }
    }
    this.ensureVobizPlaybackLoop(session);
  }

  ensureVobizPlaybackLoop(session) {
    if (!session.vobizWs || session.vobizWs.readyState !== WebSocket.OPEN) return;
    if (session.awaitingClearAudioAck) return;
    if (session.vobizPlaybackTimer) return;
    session.vobizPlaybackTimer = setInterval(() => this.flushVobizPlaybackFrame(session), VOBIZ_FRAME_MS);
  }

  flushVobizPlaybackFrame(session) {
    if (!this.sessions.has(session.id)) {
      this.stopVobizPlaybackLoop(session);
      return;
    }

    if (!session.vobizWs || session.vobizWs.readyState !== WebSocket.OPEN) {
      this.stopVobizPlaybackLoop(session);
      return;
    }

    if (session.awaitingClearAudioAck) {
      this.stopVobizPlaybackLoop(session);
      return;
    }

    if (session.outboundMulawQueue.length === 0) {
      this.stopVobizPlaybackLoop(session);
      return;
    }

    const framesToSend = Math.min(VOBIZ_BATCH_FRAMES, session.outboundMulawQueue.length);
    const batch = [];
    for (let i = 0; i < framesToSend; i++) {
      const frame = session.outboundMulawQueue.shift();
      if (frame) {
        batch.push(frame);
        session.metrics.playbackFramesSent += 1;
      }
    }

    if (batch.length > 0) {
      const combined = Buffer.concat(batch);
      this.sendAudioToVobiz(session, combined.toString('base64'));
    }
  }

  scheduleMaxCallDuration(_session) {
    // Vobiz sessions now relies on Gemini-native turn control.
    // Keep this hook to avoid startup errors when adopt logic invokes it.
  }

  // Auto-hangup if there is continuous silence for 30 seconds.
  // This checks both if the user is silent and if the AI is not speaking.
  scheduleNoResponseTimeout(session) {
    if (!session || session.isPrewarmSession) return;
    if (session.noResponseTimer) {
      clearInterval(session.noResponseTimer);
    }
    // Set initial active timestamp
    session.lastActiveMs = Date.now();
    const SILENCE_TIMEOUT_MS = 30000;
    
    const timer = setInterval(async () => {
      if (!this.sessions.has(session.id)) return;
      
      // Activity is speech on the line, audio still playing to the caller, or the model
      // generating. A finalized transcript is too late: someone talking without a pause
      // never produces one, and the 30s watchdog then hangs up a live conversation.
      const aiStillAudible = (session.outboundMulawQueue?.length || 0) > 0 || Boolean(session.vobizPlaybackTimer);
      if (session.modelIsSpeaking || aiStillAudible) {
        session.lastActiveMs = Date.now();
        return;
      }
      
      // If user hasn't spoken and AI hasn't spoken for 30 seconds
      if (Date.now() - session.lastActiveMs > SILENCE_TIMEOUT_MS) {
        this.log('warn', 'Silence timeout: no one is talking, hanging up', {
          sessionId: session.id,
          elapsedMs: this.elapsedMs(session),
        });
        clearInterval(session.noResponseTimer);
        await this.executeEndCall(session, {
          source: 'silence-timeout',
          reason: 'no-activity',
          summary: 'Call ended automatically due to 30 seconds of silence.',
        }).catch((err) => {
          this.log('error', 'Error in silence end-call', {
            sessionId: session.id,
            message: err?.message,
          });
        });
      }
    }, 5000); // Check every 5 seconds
    
    // Store so closeSession can cancel it
    session.noResponseTimer = timer;
    this.log('info', 'Silence watchdog started', {
      sessionId: session.id,
      timeoutMs: SILENCE_TIMEOUT_MS,
    });
  }

  scheduleHardStopTimeout(session) {
    if (!session || session.isPrewarmSession) return;
    if (session.maxCallDurationHardStopTimer) {
      clearTimeout(session.maxCallDurationHardStopTimer);
    }
    const durationMinutes = Math.round(HARD_STOP_TIMEOUT_MS / 60000);
    session.maxCallDurationHardStopTimer = setTimeout(() => {
      if (!this.sessions.has(session.id)) return;
      this.log('warn', `Hard-stop ${durationMinutes}-minute timeout reached, forcefully ending call`, {
        sessionId: session.id,
      });
      this.executeEndCall(session, {
        source: 'hard-stop-timeout',
        reason: 'max-duration-exceeded',
        summary: `Call auto-terminated after ${durationMinutes} minutes`,
      }).catch((err) => {
        this.log('error', 'Error executing hard-stop end-call', {
          sessionId: session.id,
          message: err?.message,
        });
      });
    }, HARD_STOP_TIMEOUT_MS);
    this.log('info', `Hard-stop ${durationMinutes}-minute timeout scheduled`, {
      sessionId: session.id,
      timeoutMs: HARD_STOP_TIMEOUT_MS,
    });
  }

  stopVobizPlaybackLoop(session) {
    if (!session.vobizPlaybackTimer) return;
    clearInterval(session.vobizPlaybackTimer);
    session.vobizPlaybackTimer = null;
  }

  sendAudioToVobiz(session, mulawPayload) {
    if (!session.vobizWs || session.vobizWs.readyState !== WebSocket.OPEN) return;

    // Record send timestamp for jitter analysis
    const nowMs = Date.now();
    session.metrics.playAudioSendTimestamps.push({ at: nowMs, bytes: Buffer.byteLength(mulawPayload, 'base64') });
    if (session.metrics.playAudioSendTimestamps.length > 100) {
      session.metrics.playAudioSendTimestamps.shift();
    }

    const playAudioEvent = {
      event: 'playAudio',
      media: {
        contentType: 'audio/x-mulaw',
        sampleRate: 8000,
        payload: mulawPayload,
      },
    };

    if (session.vobizStreamId) {
      playAudioEvent.streamId = session.vobizStreamId;
    }

    session.vobizWs.send(JSON.stringify(playAudioEvent));
    session.metrics.playbackEventsSent += 1;
    if (this.config.progressLogsEnabled && session.metrics.playbackEventsSent % 500 === 0) {
      this.log('info', 'Vobiz outbound playAudio progress', {
        sessionId: session.id,
        playbackEventsSent: session.metrics.playbackEventsSent,
        queueDepth: session.outboundMulawQueue.length,
        batchMs: (Buffer.byteLength(mulawPayload, 'base64') / 160) * 20,
        streamId: session.vobizStreamId || undefined,
      });
    }
  }

  clearVobizAudio(session) {
    if (!session.vobizWs || session.vobizWs.readyState !== WebSocket.OPEN) return;

    session.awaitingClearAudioAck = true;
    if (session.clearAudioAckTimer) {
      clearTimeout(session.clearAudioAckTimer);
      session.clearAudioAckTimer = null;
    }
    session.clearAudioAckTimer = setTimeout(() => {
      if (!this.sessions.has(session.id)) return;
      if (!session.awaitingClearAudioAck) return;
      session.awaitingClearAudioAck = false;
      this.log('warn', 'Vobiz clearAudio ack timeout; resuming playback loop', {
        sessionId: session.id,
        timeoutMs: CLEAR_AUDIO_ACK_TIMEOUT_MS,
      });
      this.ensureVobizPlaybackLoop(session);
    }, CLEAR_AUDIO_ACK_TIMEOUT_MS);

    session.metrics.playbackFramesDropped += session.outboundMulawQueue.length;
    session.outboundMulawQueue = [];
    session.outboundMulawRemainder = Buffer.alloc(0);
    session.sttAiQueue = [];
    session.sttAiRemainder = Buffer.alloc(0);
    this.stopVobizPlaybackLoop(session);

    this.log('info', 'Clearing Vobiz playback buffer', {
      sessionId: session.id,
      framesDroppedTotal: session.metrics.playbackFramesDropped,
    });

    const clearAudioEvent = { event: 'clearAudio' };
    if (session.vobizStreamId) {
      clearAudioEvent.streamId = session.vobizStreamId;
    }
    session.vobizWs.send(JSON.stringify(clearAudioEvent));
  }

  handleClearedAudio(session, message) {
    session.awaitingClearAudioAck = false;
    if (session.clearAudioAckTimer) {
      clearTimeout(session.clearAudioAckTimer);
      session.clearAudioAckTimer = null;
    }
    this.log('info', 'Vobiz clearedAudio acknowledged', {
      sessionId: session.id,
      streamId: message?.streamId || message?.StreamID || session.vobizStreamId || undefined,
    });

    if (session.outboundMulawQueue.length > 0) {
      this.ensureVobizPlaybackLoop(session);
    }
  }



  normalizeThinkingLevel(value, model = '') {
    const modelStr = String(model || '').toLowerCase();
    // Low-latency live models (like gemini-3.1-flash-live-preview) explicitly reject thinkingConfig
    if (modelStr && !modelStr.includes('thinking')) {
      return null;
    }
    const normalized = this.sanitizePromptValue(value, 40).toLowerCase();
    if (!normalized) return null;
    if (['minimal', 'low', 'medium', 'high'].includes(normalized)) return normalized;
    return null;
  }

  createEmptyModalityTokenCounts() {
    return { text: 0, audio: 0, image: 0, video: 0, other: 0 };
  }

  extractModalityTokenCounts(details) {
    const counts = this.createEmptyModalityTokenCounts();
    if (!Array.isArray(details)) return counts;
    for (const entry of details) {
      const tokenCount = Number.parseInt(entry?.tokenCount ?? entry?.token_count ?? 0, 10);
      if (!Number.isFinite(tokenCount) || tokenCount <= 0) continue;
      const modality = this.sanitizePromptValue(entry?.modality, 40).toLowerCase();
      switch (modality) {
        case 'audio':
          counts.audio += tokenCount;
          break;
        case 'image':
          counts.image += tokenCount;
          break;
        case 'video':
          counts.video += tokenCount;
          break;
        case 'text':
        default:
          counts.text += tokenCount;
      }
    }
    return counts;
  }

  mergeModalityTokenCountsByMax(previous, next) {
    const merged = this.createEmptyModalityTokenCounts();
    for (const key of Object.keys(merged)) {
      merged[key] = Math.max(previous?.[key] || 0, next?.[key] || 0);
    }
    return merged;
  }

  mergeUsageSnapshotsByMax(previous, next) {
    if (!previous) return next;
    return {
      promptTokenCount: Math.max(previous.promptTokenCount || 0, next.promptTokenCount || 0),
      responseTokenCount: Math.max(previous.responseTokenCount || 0, next.responseTokenCount || 0),
      totalTokenCount: Math.max(previous.totalTokenCount || 0, next.totalTokenCount || 0),
      thoughtsTokenCount: Math.max(previous.thoughtsTokenCount || 0, next.thoughtsTokenCount || 0),
      cachedContentTokenCount: Math.max(
        previous.cachedContentTokenCount || 0,
        next.cachedContentTokenCount || 0
      ),
      toolUsePromptTokenCount: Math.max(
        previous.toolUsePromptTokenCount || 0,
        next.toolUsePromptTokenCount || 0
      ),
      promptTokensByModality: this.mergeModalityTokenCountsByMax(
        previous.promptTokensByModality,
        next.promptTokensByModality
      ),
      responseTokensByModality: this.mergeModalityTokenCountsByMax(
        previous.responseTokensByModality,
        next.responseTokensByModality
      ),
    };
  }

  normalizeUsageSnapshot(usageMetadata = {}) {
    const promptTokenCount = Number.parseInt(usageMetadata.promptTokenCount ?? 0, 10) || 0;
    const responseTokenCount =
      Number.parseInt(usageMetadata.responseTokenCount ?? usageMetadata.candidatesTokenCount ?? 0, 10) || 0;
    const totalTokenCount =
      Number.parseInt(usageMetadata.totalTokenCount ?? promptTokenCount + responseTokenCount, 10) ||
      promptTokenCount + responseTokenCount;
    const thoughtsTokenCount = Number.parseInt(usageMetadata.thoughtsTokenCount ?? 0, 10) || 0;
    const cachedContentTokenCount = Number.parseInt(usageMetadata.cachedContentTokenCount ?? 0, 10) || 0;
    const toolUsePromptTokenCount = Number.parseInt(usageMetadata.toolUsePromptTokenCount ?? 0, 10) || 0;

    const promptTokensByModality = this.extractModalityTokenCounts(usageMetadata.promptTokensDetails);
    const responseTokensByModality = this.extractModalityTokenCounts(usageMetadata.responseTokensDetails);

    const knownPromptTokens = Object.values(promptTokensByModality).reduce((s, v) => s + v, 0);
    const knownResponseTokens = Object.values(responseTokensByModality).reduce((s, v) => s + v, 0);

    if (promptTokenCount > knownPromptTokens) {
      promptTokensByModality.text += promptTokenCount - knownPromptTokens;
    }
    if (responseTokenCount > knownResponseTokens) {
      responseTokensByModality.text += responseTokenCount - knownResponseTokens;
    }

    return {
      promptTokenCount,
      responseTokenCount,
      totalTokenCount,
      thoughtsTokenCount,
      cachedContentTokenCount,
      toolUsePromptTokenCount,
      promptTokensByModality,
      responseTokensByModality,
    };
  }

  roundUsd(value) {
    return Number((value || 0).toFixed(8));
  }

  estimateTokenCostUsd(tokenUsage) {
    const rates = this.config.tokenPricingUsdPer1M;
    const prompt = tokenUsage?.promptTokensByModality || this.createEmptyModalityTokenCounts();
    const response = tokenUsage?.responseTokensByModality || this.createEmptyModalityTokenCounts();

    const inputUsd =
      ((prompt.text + prompt.other) * rates.inputText + prompt.audio * rates.inputAudio +
        (prompt.image + prompt.video) * rates.inputImageVideo) /
      1_000_000;

    const outputUsd =
      ((response.text + response.other) * rates.outputText + response.audio * rates.outputAudio) /
      1_000_000;

    return {
      inputUsd: this.roundUsd(inputUsd),
      outputUsd: this.roundUsd(outputUsd),
      totalUsd: this.roundUsd(inputUsd + outputUsd),
      pricingModel: DEFAULT_MODEL,
      ratesPer1M: rates,
    };
  }

  recomputeAggregatedUsageMetrics(session) {
    const aggregate = {
      promptTokenCount: 0,
      responseTokenCount: 0,
      totalTokenCount: 0,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 0,
      toolUsePromptTokenCount: 0,
      promptTokensByModality: this.createEmptyModalityTokenCounts(),
      responseTokensByModality: this.createEmptyModalityTokenCounts(),
    };

    for (const snapshot of session.usageByResponseId.values()) {
      aggregate.promptTokenCount += snapshot.promptTokenCount || 0;
      aggregate.responseTokenCount += snapshot.responseTokenCount || 0;
      aggregate.totalTokenCount += snapshot.totalTokenCount || 0;
      aggregate.thoughtsTokenCount += snapshot.thoughtsTokenCount || 0;
      aggregate.cachedContentTokenCount += snapshot.cachedContentTokenCount || 0;
      aggregate.toolUsePromptTokenCount += snapshot.toolUsePromptTokenCount || 0;

      for (const modality of Object.keys(aggregate.promptTokensByModality)) {
        aggregate.promptTokensByModality[modality] += snapshot.promptTokensByModality?.[modality] || 0;
        aggregate.responseTokensByModality[modality] += snapshot.responseTokensByModality?.[modality] || 0;
      }
    }

    session.metrics.tokenUsage = aggregate;
    session.metrics.estimatedTokenCostUsd = this.estimateTokenCostUsd(aggregate);
  }

  updateUsageMetrics(session, payload) {
    const usageMetadata = payload?.usageMetadata;
    if (!usageMetadata) return;

    const usageKey = this.sanitizePromptValue(payload?.responseId, 120) || `turn-${session.usageTurnIndex || 0}`;
    const snapshot = this.normalizeUsageSnapshot(usageMetadata);
    const previous = session.usageByResponseId.get(usageKey);
    const merged = this.mergeUsageSnapshotsByMax(previous, snapshot);
    session.usageByResponseId.set(usageKey, merged);
    session.metrics.usageMetadataEvents += 1;
    this.recomputeAggregatedUsageMetrics(session);

    if (session.metrics.usageMetadataEvents % 250 === 0) {
      this.log('debug', 'Vobiz Gemini usage metadata progress', {
        sessionId: session.id,
        usageMetadataEvents: session.metrics.usageMetadataEvents,
        promptTokenCount: session.metrics.tokenUsage.promptTokenCount,
        responseTokenCount: session.metrics.tokenUsage.responseTokenCount,
        estimatedTokenCostUsd: session.metrics.estimatedTokenCostUsd.totalUsd,
      });
    }
  }

  buildContextualSystemPrompt(session, basePrompt, preferredLanguage) {
    const promptRegion = resolveSessionPromptRegion(session);
    const sections = [
      languageOpeningDirective(promptRegion),
      this.sanitizePromptValue(basePrompt, 4000) ||
      'You are a helpful AI assistant making phone calls. Keep responses concise and conversational.',
    ];

    sections.push(languagePreferenceSection(promptRegion, preferredLanguage));

    sections.push(
      `Audio Hallucination & Noise Policy:
- Phone audio is narrow and noisy. Unclear sound is silence, not a foreign language.
- NEVER write Korean, Spanish, Portuguese, Chinese, Japanese, Arabic, or any language outside English and Indian languages.
- ${romanTranscriptRule(promptRegion)}
- If you cannot make out words, leave the transcript empty. Do not guess.`
    );

    sections.push(
      `Call completion policy:
- When the conversation is complete or the user says goodbye/thanks/bye, give a brief polite farewell then IMMEDIATELY call the ${TOOL_END_CALL_NAME} tool.
- If the user is completely silent for more than 15 seconds, say "Hello, are you there?" once. If still no response after another 10 seconds, politely end the call and call ${TOOL_END_CALL_NAME}.
- If the user asks you to stop, hang up, or end the call, comply immediately and call ${TOOL_END_CALL_NAME}.
- If a system directive asks you to wrap up due to time limit, prioritize a concise close and call ${TOOL_END_CALL_NAME}.
- Always call ${TOOL_END_CALL_NAME} after your final spoken farewell — never leave the call open.`
    );

    sections.push(
      `Automated system and voicemail detection policy:
- You are ONLY meant to speak with real humans. If you detect that you are talking to any automated system, immediately call ${TOOL_END_CALL_NAME} with reason "automated_system_detected". Do NOT engage further.
- Voicemail indicators: "leave a message", "not available", "after the tone/beep", "please record your message", "mailbox is full", a long beep tone. If you hear any of these, call ${TOOL_END_CALL_NAME} with reason "voicemail_detected" immediately — do NOT leave a voicemail message.
- Apple Call Assistant / Live Voicemail indicators: "screening calls with a call assistant", "go ahead and speak", "they'll see a live transcription", "record your name and reason for calling", "I'll see if this person is available", "please stay on the line", "this person is not available", "leave an additional message". These are NOT a receptionist, family member, or doorkeeper. Call ${TOOL_END_CALL_NAME} with reason "call_screening_detected" immediately. Do not explain the call to the assistant.
- Google Call Screen indicators: "screening this call", "who's calling", "Google is screening this call". Call ${TOOL_END_CALL_NAME} with reason "call_screening_detected" immediately.
- IVR / phone menu indicators: "press 1", "press 2", "dial", "extension", robotic menu navigation prompts. Call ${TOOL_END_CALL_NAME} with reason "ivr_detected" immediately.
- If the first voice you hear is clearly robotic or synthesized and does not sound like a natural human greeting, treat it as an automated system.
- Never attempt to navigate IVR menus, leave voicemails, or interact with call screeners. End the call instantly.`
    );

    if (session.aiCaller?.name || session.aiCaller?.description) {
      const callerLines = [];
      if (session.aiCaller?.name) {
        callerLines.push(`- Name: ${this.sanitizePromptValue(session.aiCaller.name, 200)}`);
      }
      if (session.aiCaller?.description) {
        callerLines.push(`- Description: ${this.sanitizePromptValue(session.aiCaller.description, 600)}`);
      }
      if (callerLines.length) {
        sections.push(`AI Caller Context:\n${callerLines.join('\n')}`);
      }
    }

    if (session.campaign?.name || session.campaign?.description) {
      const campaignLines = [];
      if (session.campaign?.name) {
        campaignLines.push(`- Campaign: ${this.sanitizePromptValue(session.campaign.name, 200)}`);
      }
      if (session.campaign?.description) {
        campaignLines.push(`- Objective: ${this.sanitizePromptValue(session.campaign.description, 800)}`);
      }
      if (campaignLines.length) {
        sections.push(`Campaign Context:\n${campaignLines.join('\n')}`);
      }
    }

    if (session.lead) {
      const leadLines = [];
      const leadName = this.sanitizePromptValue(session.lead.name, 200);
      const leadPhone = this.sanitizePromptValue(session.lead.phoneNumber || session.lead.phone, 40);
      const leadEmail = this.sanitizePromptValue(session.lead.email, 200);
      if (leadName) leadLines.push(`- Name: ${leadName}`);
      if (leadPhone) leadLines.push(`- Phone: ${leadPhone}`);
      if (leadEmail) leadLines.push(`- Email: ${leadEmail}`);

      if (leadLines.length) {
        sections.push(
          `Lead Context:\n${leadLines.join('\n')}\nUse this context naturally during the call and avoid exposing internal metadata unless asked.`
        );
      }
    }

    const qaEntries = Array.isArray(session.aiCaller?.qaEntries) ? session.aiCaller.qaEntries : [];
    if (qaEntries.length > 0) {
      const qaLines = qaEntries
        .filter((entry) => this.sanitizePromptValue(entry?.question, 500) && this.sanitizePromptValue(entry?.answer, 1200))
        .slice(0, MAX_QA_CONTEXT_ENTRIES)
        .map(
          (entry, index) =>
            `${index + 1}. Q: ${this.sanitizePromptValue(entry.question, 500)}\n   A: ${this.sanitizePromptValue(entry.answer, 1200)}`
        );

      if (qaLines.length) {
        sections.push(
          `Knowledge Q&A (prefer these answers when relevant):\n${qaLines.join('\n')}\nIf not covered, ask a follow-up question instead of guessing.`
        );
      }
    }

    return sections.filter(Boolean).join('\n\n');
  }

  getLiveToolsConfig() {
    return [
      {
        functionDeclarations: [
          {
            name: TOOL_END_CALL_NAME,
            description: 'Ends the active phone call after a polite wrap-up. Use this when the conversation is complete or the user asks to finish.',
            parameters: {
              type: 'OBJECT',
              properties: {
                reason: { type: 'STRING', description: 'Short reason for ending the call.' },
                summary: { type: 'STRING', description: 'Optional one-line summary of the conversation outcome.' },
              },
              required: ['reason'],
            },
          },
        ],
      },
    ];
  }

  parseFunctionCallArgs(args) {
    if (!args) return {};
    if (typeof args === 'object') return args;
    if (typeof args === 'string') {
      try {
        return JSON.parse(args);
      } catch {
        return {};
      }
    }
    return {};
  }

  sendToolResponse(session, functionResponses) {
    if (!Array.isArray(functionResponses) || functionResponses.length === 0) {
      return;
    }
    if (!session.geminiWs || session.geminiWs.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Skipped tool response because Gemini socket is not open', {
        sessionId: session.id,
      });
      return;
    }

    session.geminiWs.send(
      JSON.stringify({
        toolResponse: {
          functionResponses,
        },
      })
    );
    session.metrics.toolResponsesOut += functionResponses.length;
  }

  async executeEndCall(
    session,
    { source = 'end-call-requested', reason = 'not-specified', summary = '' } = {}
  ) {
    if (!session || !this.sessions.has(session.id)) return;
    if (session.endingCallInProgress) {
      this.log('info', 'Ignoring duplicate end-call request', {
        sessionId: session.id,
        source,
        reason,
      });
      return;
    }

    if (session.isPrewarmSession) {
      this.log('info', 'Ignoring end-call during Vobiz prewarm', {
        sessionId: session.id,
        source,
        reason,
      });
      return;
    }

    session.endingCallInProgress = true;
    session.metrics.endCallRequests += 1;
    const safeReason = this.sanitizePromptValue(reason, 200) || 'conversation-complete';
    const safeSummary = this.sanitizePromptValue(summary, 500);
    session.toolEndReason = safeReason;
    session.toolEndSummary = safeSummary;

    this.log('info', 'Ending Vobiz call', {
      sessionId: session.id,
      source,
      reason: safeReason,
      summary: safeSummary || undefined,
      isPrewarmSession: Boolean(session.isPrewarmSession),
    });

    try {
      const callUuid = this.sanitizePromptValue(
        session.providerCallId || session.params?.callSid || session.callSessionId || '',
        120
      );

      if (!callUuid) {
        this.log('warn', 'Cannot hang up Vobiz call: missing provider call UUID', {
          sessionId: session.id,
          source,
          reason: safeReason,
          callSessionId: session.callSessionId || undefined,
        });
      } else {
        let telephony = null;
        const telephonyIntegrationId = session.params?.telephonyIntegrationId;
        if (telephonyIntegrationId) {
          telephony = await Integration.findOne({ _id: telephonyIntegrationId, type: 'telephony' });
        }
        if (!telephony) {
          telephony = await Integration.findOne({ type: 'telephony', isDefault: true, isActive: true });
        }

        const metadata = telephony?.metadata instanceof Map ? Object.fromEntries(telephony.metadata) : (telephony?.metadata || {});
        const authId = telephony?.authConfig?.username;
        const authToken = telephony?.authConfig?.password;
        const apiBaseUrl = metadata.apiBaseUrl || '';

        if (!authId || !authToken) {
          this.log('warn', 'Cannot hang up Vobiz call: missing auth credentials', {
            sessionId: session.id,
            source,
            reason: safeReason,
          });
        } else {
          await vobizService.hangupCall({
            authId,
            authToken,
            callUuid,
            apiBaseUrl,
          });

          this.log('info', 'Vobiz hangup API called', {
            sessionId: session.id,
            source,
            callUuid,
          });
        }
      }

      if (session.vobizWs && session.vobizWs.readyState === WebSocket.OPEN) {
        try {
          session.vobizWs.send(
            JSON.stringify({
              event: 'stop',
              ...(session.vobizStreamId ? { streamId: session.vobizStreamId } : {}),
            })
          );
        } catch (sendError) {
          this.log('warn', 'Failed to send Vobiz stop event before closing session', {
            sessionId: session.id,
            message: sendError?.message,
          });
        }
      }
    } finally {
      if (this.sessions.has(session.id)) {
        this.closeSession(session, source);
      }
    }
  }

  async handleToolCallMessage(session, toolCall, source = 'top-level') {
    const functionCalls = Array.isArray(toolCall?.functionCalls) ? toolCall.functionCalls : [];
    if (functionCalls.length === 0) {
      return;
    }

    const dedupedCalls = [];
    for (const functionCall of functionCalls) {
      const rawId =
        this.sanitizePromptValue(functionCall?.id, 120) ||
        `${this.sanitizePromptValue(functionCall?.name, 80)}:${JSON.stringify(
          functionCall?.args ?? functionCall?.arguments ?? {}
        )}`;
      if (session.processedToolCallIds.has(rawId)) {
        continue;
      }
      session.processedToolCallIds.add(rawId);
      dedupedCalls.push(functionCall);
    }

    if (dedupedCalls.length === 0) {
      return;
    }

    session.metrics.toolCallsIn += dedupedCalls.length;
    if (source === 'model-turn-part') {
      session.metrics.modelTurnPartToolCallsIn += dedupedCalls.length;
    } else {
      session.metrics.topLevelToolCallsIn += dedupedCalls.length;
    }

    this.log('info', 'Gemini tool call received', {
      sessionId: session.id,
      source,
      functionNames: dedupedCalls.map((call) => call?.name || 'unknown'),
      totalToolCallsIn: session.metrics.toolCallsIn,
    });

    const functionResponses = [];
    let endCallRequest = null;

    for (const functionCall of dedupedCalls) {
      const functionId = functionCall?.id;
      const functionName = functionCall?.name;

      if (functionName === TOOL_END_CALL_NAME && session.isPrewarmSession) {
        const rejectedResponse = {
          name: functionName,
          response: {
            ok: false,
            accepted: false,
            error: 'The call has not connected yet. Wait for the user.',
          },
        };
        if (functionId) {
          rejectedResponse.id = functionId;
        }
        functionResponses.push(rejectedResponse);
        continue;
      }

      if (functionName === TOOL_END_CALL_NAME) {
        const args = this.parseFunctionCallArgs(functionCall?.args ?? functionCall?.arguments);
        const reason = this.sanitizePromptValue(args?.reason, 200) || 'conversation-complete';
        const summary = this.sanitizePromptValue(args?.summary, 500);

        const successResponse = {
          name: functionName,
          response: {
            ok: true,
            accepted: true,
            reason,
          },
        };
        if (functionId) {
          successResponse.id = functionId;
        }
        functionResponses.push(successResponse);

        endCallRequest = {
          source: 'tool-end-call',
          reason,
          summary,
        };
        continue;
      }

      const failedResponse = {
        name: functionName,
        response: {
          ok: false,
          accepted: false,
          error: `Unknown tool: ${functionName || 'undefined'}`,
        },
      };
      if (functionId) {
        failedResponse.id = functionId;
      }
      functionResponses.push(failedResponse);
    }

    this.sendToolResponse(session, functionResponses);

    if (endCallRequest) {
      setTimeout(() => {
        this.executeEndCall(session, endCallRequest).catch((error) => {
          this.log('error', 'Error executing end-call tool', {
            sessionId: session.id,
            message: error?.message,
          });
        });
      }, 120);
    }
  }

  attachGeminiSocketListeners(session) {
    if (!session.geminiWs) return;

    session.geminiWs.on('message', (raw) => {
      this.handleGeminiMessage(session, raw);
    });

    session.geminiWs.on('close', (code, reasonBuffer) => {
      const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || '');
      session.closeMeta.gemini = { code, reason };
      this.log('info', 'Gemini socket closed', { sessionId: session.id, code, reason });
      this.closeSession(session, session.isPrewarmSession ? 'prewarm-gemini-close' : 'gemini-close');
    });

    session.geminiWs.on('error', (error) => {
      this.log('error', 'Gemini socket error', { sessionId: session.id, message: error?.message });
      this.closeSession(session, session.isPrewarmSession ? 'prewarm-gemini-error' : 'gemini-error');
    });
  }

  handleGeminiMessage(session, raw) {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      this.log('warn', 'Failed to parse Gemini payload as JSON', { sessionId: session.id });
      return;
    }

    session.metrics.modelMessagesIn += 1;

    // Update token usage aggregates if Gemini includes usage metadata
    try {
      if (payload?.usageMetadata) {
        this.updateUsageMetrics(session, payload);
      } else if (payload?.serverContent?.usageMetadata) {
        this.updateUsageMetrics(session, payload.serverContent);
      }
    } catch (e) {
      this.log('warn', 'Failed to update usage metrics', { sessionId: session.id, message: e?.message });
    }

    if (payload.error) {
      this.log('error', 'Gemini payload error', { sessionId: session.id, error: payload.error });
      this.closeSession(session, 'gemini-payload-error');
      return;
    }

    if (payload.toolCall) {
      this.handleToolCallMessage(session, payload.toolCall, 'top-level').catch((error) => {
        this.log('error', 'Failed handling Gemini tool call', {
          sessionId: session.id,
          message: error?.message,
        });
      });
    }

    if (payload.toolCallCancellation) {
      this.log('info', 'Gemini requested tool call cancellation', {
        sessionId: session.id,
        ids: payload.toolCallCancellation?.ids || [],
      });
    }

    if (payload.setupComplete) {
      session.geminiReady = true;
      session.setupCompletedAtMs = Date.now();
      session.metrics.setupCompleteMs = this.elapsedMs(session);
      this.log('info', 'Gemini setup complete', {
        sessionId: session.id,
        pendingAudioChunks: session.pendingAudioChunks.length,
      });
      if (session.pendingAudioChunks.length > 0) {
        for (const chunk of session.pendingAudioChunks) {
          this.sendAudioChunkToGemini(session, chunk);
        }
        session.pendingAudioChunks = [];
      }
      this.requestProactiveGreeting(session, 'setup-complete');
      return;
    }

    const serverContent = payload.serverContent;
    if (!serverContent) return;

    if (serverContent.interrupted) {
      session.metrics.interruptions += 1;
      this.log('info', 'Gemini interruption signaled', {
        sessionId: session.id,
        interruptions: session.metrics.interruptions,
      });

      // Bug fix: flush any partial AI transcript before clearing the queue
      if (session.currentAiTranscript && session.currentAiTranscript.trim()) {
        const flushed = session.currentAiTranscript.trim();
        this.log('info', 'Flushing interrupted AI transcript', {
          sessionId: session.id,
          text: normalizeCallTranscript(flushed) || flushed,
        });
        this.rememberTranscript(session, 'ai', flushed);
        session.currentAiTranscript = '';
      }

      this.clearVobizAudio(session);
      session.modelIsSpeaking = false;
      session.outboundMulawQueue = [];
      session.outboundMulawRemainder = Buffer.alloc(0);
      session.sttAiQueue = [];
      session.sttAiRemainder = Buffer.alloc(0);
    }

    if (serverContent.inputTranscription?.text) {
      const heard = normalizeCallTranscript(serverContent.inputTranscription.text);
      if (heard) session.lastActiveMs = Date.now();
      if (heard && !session.sttReady) {
        this.log('info', 'Using Gemini fallback transcript (user)', {
          sessionId: session.id,
          text: heard,
        });
        this.rememberTranscript(session, 'user', heard);
      } else if (heard) {
        session.transcript.push({
          speaker: 'user',
          text: heard,
          timestamp: new Date().toISOString(),
          isPendingDeepgram: true,
        });
      }
    }

    if (serverContent.outputTranscription?.text) {
      session.currentAiTranscript = (session.currentAiTranscript || '') + serverContent.outputTranscription.text;
    }

    if (serverContent.generationComplete || serverContent.turnComplete) {
      session.modelIsSpeaking = false;
      if (session.currentAiTranscript && session.currentAiTranscript.trim()) {
        const spoken = session.currentAiTranscript.trim();
        const cleaned = normalizeCallTranscript(spoken);
        this.log('info', 'Using Gemini native transcript (ai)', {
          sessionId: session.id,
          text: cleaned || spoken,
        });
        this.rememberTranscript(session, 'ai', spoken);
        session.currentAiTranscript = '';
      }
    }

    if (serverContent.interrupted) {
      if (session.currentAiTranscript && session.currentAiTranscript.trim()) {
        const spoken = session.currentAiTranscript.trim();
        this.log('info', 'Using Gemini native transcript (ai) [interrupted]', {
          sessionId: session.id,
          text: normalizeCallTranscript(spoken) || spoken,
        });
        this.rememberTranscript(session, 'ai', spoken);
        session.currentAiTranscript = '';
      }
      return;
    }

    const parts = serverContent.modelTurn?.parts || [];

    const partFunctionCalls = parts
      .map((part) => part?.functionCall)
      .filter((functionCall) => functionCall && functionCall.name);

    if (partFunctionCalls.length > 0) {
      this.handleToolCallMessage(session, { functionCalls: partFunctionCalls }, 'model-turn-part').catch(
        (error) => {
          this.log('error', 'Failed handling model-turn part functionCall', {
            sessionId: session.id,
            message: error?.message,
          });
        }
      );
    }

    for (const part of parts) {
      const inlineData = part.inlineData;
      if (!inlineData?.data) continue;
      if (session.isPrewarmSession && !session.vobizStreamId) {
        const bufferedMs = this.getBufferedMulawMs(session);
        if (bufferedMs >= this.config.prewarmMaxBufferMs) {
          session.metrics.prewarmAudioPartsDropped += 1;
          if (session.metrics.prewarmAudioPartsDropped % 25 === 0) {
            this.log('warn', 'Dropping excess Vobiz prewarm model audio to limit overhead', {
              sessionId: session.id,
              bufferedMs,
              prewarmMaxBufferMs: this.config.prewarmMaxBufferMs,
              prewarmAudioPartsDropped: session.metrics.prewarmAudioPartsDropped,
            });
          }
          continue;
        }
      }
      this.markModelAudioStarted(session);
      session.metrics.modelAudioPartsIn += 1;

      const geminiAudioPcm = Buffer.from(inlineData.data, 'base64');
      session.metrics.modelAudioBytesIn += geminiAudioPcm.length;

      // Log timing of Gemini audio arrival for jitter diagnosis
      const nowMs = Date.now();
      session.metrics.geminiAudioPartArrivalTimestamps.push({ at: nowMs, bytes: geminiAudioPcm.length });
      if (session.metrics.geminiAudioPartArrivalTimestamps.length > 100) {
        session.metrics.geminiAudioPartArrivalTimestamps.shift();
      }

      if (this.config.progressLogsEnabled && session.metrics.modelAudioPartsIn % 100 === 0) {
        this.log('info', 'Gemini response audio production', {
          sessionId: session.id,
          audioPartsIn: session.metrics.modelAudioPartsIn,
          bytesIn: session.metrics.modelAudioBytesIn,
          mimeType: inlineData.mimeType,
          queueDepth: session.outboundMulawQueue.length,
        });
      }
      const geminiRate = getSampleRateFromMimeType(inlineData.mimeType, 24000);
      const pcm8 = this.convertGeminiPcmToTelephonyPcm(session, geminiAudioPcm, geminiRate);
      if (!pcm8 || pcm8.length === 0) continue;
      const mulaw = encodePcm16ToMulaw(pcm8);
      session.modelIsSpeaking = true;
      this.queueVobizAudio(session, mulaw);

      if (session.sttReady) {
        const pcm16 = resamplePcm16(pcm8, 8000, 16000);
        session.sttAiQueue.push(pcm16);
      }
    }

    if ((serverContent.generationComplete || serverContent.turnComplete) && session.outboundMulawRemainder.length) {
      session.outboundMulawQueue.push(session.outboundMulawRemainder);
      session.outboundMulawRemainder = Buffer.alloc(0);
      this.ensureVobizPlaybackLoop(session);
    }
  }

  convertGeminiPcmToTelephonyPcm(session, geminiPcm16, inputRate) {
    if (!geminiPcm16 || geminiPcm16.length === 0) {
      return Buffer.alloc(0);
    }

    if (!Number.isFinite(inputRate) || inputRate <= 0 || inputRate === 8000) {
      return Buffer.from(geminiPcm16);
    }

    const ratio = inputRate / 8000;
    if (!Number.isInteger(ratio) || ratio < 1) {
      // Fallback for non-integer sample-rate conversions.
      return resamplePcm16(geminiPcm16, inputRate, 8000);
    }

    if (session.outboundResampleSourceRate !== inputRate || !session.outboundPcmRemainder) {
      session.outboundResampleSourceRate = inputRate;
      session.outboundPcmRemainder = Buffer.alloc(0);
    }

    const combined = session.outboundPcmRemainder.length
      ? Buffer.concat([session.outboundPcmRemainder, geminiPcm16])
      : geminiPcm16;

    const totalSamples = Math.floor(combined.length / 2);
    const usableSamples = totalSamples - (totalSamples % ratio);
    if (usableSamples <= 0) {
      session.outboundPcmRemainder = combined;
      return Buffer.alloc(0);
    }

    const outputSamples = usableSamples / ratio;
    const output = Buffer.allocUnsafe(outputSamples * 2);

    for (let outIdx = 0; outIdx < outputSamples; outIdx += 1) {
      const start = outIdx * ratio;
      let sum = 0;
      for (let j = 0; j < ratio; j += 1) {
        sum += combined.readInt16LE((start + j) * 2);
      }
      output.writeInt16LE(Math.round(sum / ratio), outIdx * 2);
    }

    session.outboundPcmRemainder = combined.subarray(usableSamples * 2);
    return output;
  }

  attachPrewarmConnectGate(session) {
    let settle = () => {};
    session.geminiConnectPromise = new Promise((resolve) => {
      settle = resolve;
    });
    session.settleGeminiConnect = (ready) => {
      if (session.geminiConnectSettled) return;
      session.geminiConnectSettled = true;
      settle(Boolean(ready));
    };
  }

  prewarmStopped(session) {
    return Boolean(session?.abandoned || session?.closed);
  }

  prewarmSocketUsable(session) {
    const ws = session?.geminiWs;
    if (!ws || this.prewarmStopped(session)) return false;
    return ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN;
  }

  async waitForPrewarmSocket(session) {
    if (this.prewarmSocketUsable(session) || !session?.geminiConnectPromise) {
      return this.prewarmSocketUsable(session);
    }
    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), PREWARM_ADOPT_WAIT_MS);
    });
    await Promise.race([session.geminiConnectPromise, timedOut]);
    clearTimeout(timer);
    return this.prewarmSocketUsable(session);
  }

  abandonPrewarm(session, reason) {
    if (!session) return;
    session.abandoned = true;
    session.settleGeminiConnect?.(false);
    if (!session.closed) {
      this.closeSession(session, reason);
    }
  }

  async connectGeminiSession(session) {
    if (this.prewarmStopped(session)) {
      session.settleGeminiConnect?.(false);
      return;
    }
    this.connectDeepgram(session);
    const apiKey = session.integration?.authConfig?.token?.trim();
    if (!apiKey) throw new Error('Gemini API key missing');

    const model = session.params.model || session.integration?.metadata?.model || DEFAULT_MODEL;
    session.model = model;

    const wsBase = (session.integration.baseUrl || GEMINI_LIVE_WS_BASE).trim();
    const separator = wsBase.includes('?') ? '&' : '?';
    const geminiUrl = `${wsBase}${separator}key=${encodeURIComponent(apiKey)}`;

    session.geminiWs = new WebSocket(geminiUrl);
    if (this.prewarmStopped(session)) {
      try { session.geminiWs.close(); } catch (e) { }
      session.geminiWs = null;
      session.settleGeminiConnect?.(false);
      return;
    }
    session.settleGeminiConnect?.(true);

    session.geminiWs.on('open', () => {
      if (this.prewarmStopped(session)) return;
      const baseSystemPrompt =
        session.params.systemPrompt ||
        session.aiCaller?.s2sConfig?.systemPrompt ||
        session.campaign?.systemPrompt ||
        'You are a helpful AI assistant making phone calls. Keep responses concise and conversational.';
      const preferredVoice =
        this.sanitizePromptValue(session.params.voice, 100) ||
        this.sanitizePromptValue(session.aiCaller?.s2sConfig?.voice, 100) ||
        null;
      const preferredLanguage =
        this.sanitizePromptValue(session.params.language, 30) ||
        this.sanitizePromptValue(session.aiCaller?.s2sConfig?.language, 30) ||
        null;
      const thinkingLevel = this.normalizeThinkingLevel(
        session.params.thinkingLevel || session.aiCaller?.s2sConfig?.thinkingLevel,
        model
      );
      const systemPrompt = this.buildContextualSystemPrompt(session, baseSystemPrompt, preferredLanguage);
      const temperature = Number.parseFloat(
        session.params.temperature ?? session.aiCaller?.s2sConfig?.temperature ?? '0.8'
      );
      const generationConfig = {
        responseModalities: ['AUDIO'],
        temperature: Number.isFinite(temperature) ? temperature : 0.8,
      };

      if (preferredVoice) {
        generationConfig.speechConfig = {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: preferredVoice,
            },
          },
        };
      }

      if (thinkingLevel) {
        generationConfig.thinkingConfig = {
          thinkingLevel,
        };
      }
      const tools = this.getLiveToolsConfig();

      const setupPayload = {
        setup: {
          model: `models/${model}`,
          generationConfig,
          tools,
          // realtimeInputConfig: {
          //   automaticActivityDetection: {
          //     disabled: false,
          //     startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
          //     endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          //     prefixPaddingMs: 40,
          //     silenceDurationMs: 200,
          //   },
          // },
          systemInstruction: { parts: [{ text: systemPrompt }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };

      this.log('info', 'Sending Gemini setup payload', {
        sessionId: session.id,
        model: setupPayload.setup.model,
        preferredVoice,
        preferredLanguage,
        promptRegion: resolveSessionPromptRegion(session),
        thinkingLevel,
        promptLength: systemPrompt.length,
        tools: tools.flatMap((t) => t?.functionDeclarations || []).map((d) => d?.name).filter(Boolean),
      });

      this.log('info', 'Sending Gemini setup payload (vobiz)', {
        sessionId: session.id,
        model: setupPayload.setup.model,
        promptLength: systemPrompt.length,
        promptPreview: systemPrompt.slice(0, 200),
        promptSource: Boolean(session.params.systemPrompt)
          ? 'params.systemPrompt'
          : Boolean(session.aiCaller?.s2sConfig?.systemPrompt)
            ? 'aiCaller.s2sConfig.systemPrompt'
            : Boolean(session.campaign?.systemPrompt)
              ? 'campaign.systemPrompt'
              : 'default',
      });

      session.geminiWs.send(JSON.stringify(setupPayload));
    });

    this.attachGeminiSocketListeners(session);
  }

  closeSession(session, reason) {
    if (!session) return;
    if (session.closed) return;
    session.closed = true;
    session.closeReason = session.closeReason || reason;
    session.settleGeminiConnect?.(false);
    try {
      if (session.vobizPlaybackTimer) clearInterval(session.vobizPlaybackTimer);
    } catch (e) { }
    try {
      if (session.sttMixerTimer) clearInterval(session.sttMixerTimer);
    } catch (e) { }
    try {
      if (session.sttWs && session.sttWs.readyState === WebSocket.OPEN) session.sttWs.close();
    } catch (e) { }

    try {
      if (session.clearAudioAckTimer) clearTimeout(session.clearAudioAckTimer);
    } catch (e) { }

    try {
      if (session.maxCallDurationHardStopTimer) clearTimeout(session.maxCallDurationHardStopTimer);
    } catch (e) { }

    try {
      if (session.noResponseTimer) clearTimeout(session.noResponseTimer);
    } catch (e) { }

    try {
      if (session.geminiWs && (
        session.geminiWs.readyState === WebSocket.OPEN ||
        session.geminiWs.readyState === WebSocket.CONNECTING
      )) session.geminiWs.close();
    } catch (e) { }

    try {
      if (session.vobizWs && session.vobizWs.readyState === WebSocket.OPEN) session.vobizWs.close();
    } catch (e) { }

    if (session.callSessionId) {
      const prewarmed = this.prewarmedCalls.get(this.sanitizePromptValue(session.callSessionId, 120));
      if (prewarmed?.id === session.id) {
        this.prewarmedCalls.delete(this.sanitizePromptValue(session.callSessionId, 120));
      }
    }

    if (session.prewarmExpiryTimer) {
      clearTimeout(session.prewarmExpiryTimer);
      session.prewarmExpiryTimer = null;
    }

    this.sessions.delete(session.id);

    if (session.isPrewarmSession) {
      this.log('info', 'Vobiz prewarm session closed without updating the call record', {
        sessionId: session.id,
        callSessionId: session.callSessionId || undefined,
        reason,
        geminiReady: session.geminiReady,
      });
      this.forgetAgent(session);
      return;
    }

    this.runtimeMetrics.sessionsClosed += 1;

    const transcriptTurns = Array.isArray(session.transcript)
      ? session.transcript
        .map((entry) => ({
          speaker: entry?.speaker,
          text: this.sanitizePromptValue(entry?.text, 5000),
          timestamp: entry?.timestamp || new Date().toISOString(),
        }))
        .filter((entry) => entry.speaker && entry.text)
      : [];

    const transcriptText = Array.isArray(session.transcript)
      ? session.transcript
        .map((entry) => {
          const speaker = this.sanitizePromptValue(entry?.speaker, 20) || 'unknown';
          const text = this.sanitizePromptValue(entry?.text, 5000);
          return text ? `${speaker}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n')
      : '';

    const summary = {
      provider: 'vobiz',
      sessionId: session.id,
      callSessionId: session.callSessionId || session.params.callSessionId || null,
      providerCallId:
        session.providerCallId || this.sanitizePromptValue(session.params?.callSid || '', 120) || null,
      streamSid: session.vobizStreamId || null,
      reason,
      toolEndReason: session.toolEndReason || '',
      toolEndSummary: session.toolEndSummary || '',
      durationMs: reason === 'prewarm-timeout' ? 0 : this.elapsedMs(session),
      setupCompleteMs: session.metrics.setupCompleteMs,
      mediaPacketsIn: session.metrics.mediaPacketsIn,
      mediaBytesIn: session.metrics.mediaBytesIn,
      playbackFramesSent: session.metrics.playbackFramesSent,
      playbackFramesDropped: session.metrics.playbackFramesDropped,
      modelMessagesIn: session.metrics.modelMessagesIn,
      modelAudioPartsIn: session.metrics.modelAudioPartsIn,
      modelAudioBytesIn: session.metrics.modelAudioBytesIn,
      userAudioChunksSentToModel: session.metrics.userAudioChunksSentToModel,
      userAudioBytesSentToModel: session.metrics.userAudioBytesSentToModel,
      interruptions: session.metrics.interruptions,
      playbackQueueHighWaterMark: session.metrics.playbackQueueHighWaterMark,
      maxCallDurationSeconds: session.metrics.maxCallDurationSeconds,
      toolCallsIn: session.metrics.toolCallsIn,
      topLevelToolCallsIn: session.metrics.topLevelToolCallsIn,
      modelTurnPartToolCallsIn: session.metrics.modelTurnPartToolCallsIn,
      toolResponsesOut: session.metrics.toolResponsesOut,
      endCallRequests: session.metrics.endCallRequests,
      proactiveGreetingPrompts: session.metrics.proactiveGreetingPrompts,
      proactiveGreetingRetries: session.metrics.proactiveGreetingRetries,
      prewarmAudioPartsDropped: session.metrics.prewarmAudioPartsDropped,
      firstModelAudioLatencyMs: session.metrics.firstModelAudioLatencyMs,
      usageMetadataEvents: session.metrics.usageMetadataEvents,
      providerEvents: session.metrics.providerEvents,
      tokenUsage: session.metrics.tokenUsage,
      estimatedTokenCostUsd: session.metrics.estimatedTokenCostUsd,
      transcriptTurns,
      transcriptText,
      modelFarewellDetected: false,
      closeMeta: session.closeMeta,
      runtimeMetrics: this.runtimeMetrics,
      closedAt: new Date().toISOString(),
      bridgeMetrics: {
        ...session.metrics,
        durationMs: reason === 'prewarm-timeout' ? 0 : this.elapsedMs(session),
      },
    };

    // Compute Vobiz platform per-minute cost (INR -> USD) and attach breakdown
    try {
      const durationMs = summary.durationMs || 0;
      const minutes = Math.ceil(Math.max(0, durationMs) / 60000);
      const platformInr = minutes * (this.config.vobizInrPerMinute || 0.65);
      const platformUsd = (platformInr || 0) * (this.config.inrToUsdRate || 0.012);
      const tokenUsd = (session.metrics.estimatedTokenCostUsd?.totalUsd) || 0;
      const totalUsd = tokenUsd + platformUsd;

      const usdToInrRate = Number.parseFloat(process.env.USD_TO_INR_RATE) ||
        (this.config.inrToUsdRate ? 1 / Number.parseFloat(this.config.inrToUsdRate) : 83.333333);

      const tokenInr = Number((tokenUsd * usdToInrRate).toFixed(6));
      const totalInr = Number((tokenInr + platformInr).toFixed(6));

      const estimatedWithPlatform = {
        // USD breakdown (legacy)
        ...session.metrics.estimatedTokenCostUsd,
        vobizPlatformCostUsd: this.roundUsd(platformUsd),
        minutesCharged: minutes,
        totalUsdWithPlatform: this.roundUsd(totalUsd),
        // INR breakdown (primary)
        tokenCostInr: tokenInr,
        vobizPlatformCostInr: Number((platformInr || 0).toFixed(6)),
        totalInrWithPlatform: totalInr,
        usdToInrRate,
      };

      summary.estimatedTokenCostUsd = estimatedWithPlatform;
      summary.estimatedTokenCostInr = {
        tokenCostInr: estimatedWithPlatform.tokenCostInr,
        vobizPlatformCostInr: estimatedWithPlatform.vobizPlatformCostInr,
        totalInrWithPlatform: estimatedWithPlatform.totalInrWithPlatform,
        minutesCharged: estimatedWithPlatform.minutesCharged,
        usdToInrRate,
      };

      summary.bridgeMetrics = {
        ...summary.bridgeMetrics,
        estimatedTokenCostUsd: estimatedWithPlatform,
        estimatedTokenCostInr: summary.estimatedTokenCostInr,
        vobizPlatformInrPerMinute: this.config.vobizInrPerMinute,
      };
    } catch (e) {
      this.log('warn', 'Failed to compute Vobiz platform cost', { sessionId: session.id, message: e?.message });
    }

    this.log('info', 'Vobiz session metrics summary', summary);
    this.forgetAgent(session);

    try {
      callSessionService.finalizeSessionFromBridge(summary).catch(() => { });
    } catch (e) { }
  }
  getAudioChunk(session, queueKey, remainderKey, size) {
    if (session[remainderKey].length >= size) {
      const chunk = session[remainderKey].subarray(0, size);
      session[remainderKey] = session[remainderKey].subarray(size);
      return chunk;
    }

    const buffers = [session[remainderKey]];
    let totalLen = session[remainderKey].length;

    while (totalLen < size && session[queueKey].length > 0) {
      const b = session[queueKey].shift();
      buffers.push(b);
      totalLen += b.length;
    }

    const combined = Buffer.concat(buffers);
    if (combined.length >= size) {
      const chunk = combined.subarray(0, size);
      session[remainderKey] = combined.subarray(size);
      return chunk;
    } else {
      session[remainderKey] = combined;
      return null;
    }
  }

  ensureSttMixerLoop(session) {
    if (session.sttMixerTimer) return;
    session.sttMixerTimer = setInterval(() => {
      if (!session.sttReady || !session.sttWs || session.sttWs.readyState !== WebSocket.OPEN) return;

      const humanChunk = this.getAudioChunk(session, 'sttHumanQueue', 'sttHumanRemainder', 640);
      
      // We no longer process aiChunk since Gemini natively transcribes AI responses
      // and stereo mixing costs CPU and double Deepgram usage.

      if (!humanChunk) return;

      session.sttWs.send(humanChunk);
    }, 20);
  }



  connectDeepgram(session) {
    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramKey) {
      return;
    }

    const url = [
      'wss://api.deepgram.com/v1/listen',
      '?model=nova-3',
      '&smart_format=true',
      '&encoding=linear16',
      '&sample_rate=16000',
      '&endpointing=800', // Increased to 800ms silence threshold for more complete sentences instead of fragments
      '&language=multi',  // Supports Hindi + English + 8 others on Nova-3
    ].join('');
    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${deepgramKey}` }
    });

    session.sttWs = ws;

    ws.on('open', () => {
      session.sttReady = true;
      const agentName = this.lookupAgentName({ sessionId: session.id });
      console.log('------------------------------------------------');
      console.log(`[STT] Deepgram connected for session: ${session.id}${agentName ? ` agent: ${agentName}` : ''}`);
      console.log('------------------------------------------------');
      this.log('info', 'Deepgram STT connected', { sessionId: session.id });
      this.ensureSttMixerLoop(session);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'Results') {
          const alt = msg.channel?.alternatives?.[0];
          const transcript = alt?.transcript;

          if (transcript && transcript.trim()) {
            session.lastActiveMs = Date.now();
          }

          if (!(msg.is_final || msg.speech_final) || !transcript || !transcript.trim()) {
            return;
          }
          const cleanedTranscript = normalizeCallTranscript(transcript);
          if (!cleanedTranscript) return;

            // Bug fix: resolve stale placeholders (older than 5s) with their Gemini fallback text
            const now = Date.now();
            for (const turn of session.transcript) {
              if (turn.isPendingDeepgram && (now - new Date(turn.timestamp).getTime()) > 5000) {
                turn.isPendingDeepgram = false; // keep Gemini fallback text as-is
              }
            }

            // Bug fix: use findIndex (oldest first) instead of findLastIndex to match results in order
            const pendingIndex = session.transcript.findIndex(t => t.isPendingDeepgram);
            
            if (pendingIndex !== -1) {
              session.transcript[pendingIndex].text = cleanedTranscript;
              session.transcript[pendingIndex].isPendingDeepgram = false;
              this.log('info', 'Deepgram STT transcript (swapped placeholder)', {
                sessionId: session.id,
                speaker: 'user',
                text: cleanedTranscript,
              });
            } else {
              this.rememberTranscript(session, 'user', cleanedTranscript);
              this.log('info', 'Deepgram STT transcript', {
                sessionId: session.id,
                speaker: 'user',
                text: cleanedTranscript,
              });
            }
        }
      } catch (e) {
        // ignore parse errors
      }
    });

    ws.on('error', (err) => {
      this.log('error', 'Deepgram STT error', { sessionId: session.id, error: err.message });
      session.sttReady = false;
    });

    ws.on('close', () => {
      this.log('info', 'Deepgram STT closed', { sessionId: session.id });
      session.sttReady = false;
    });
  }
}

const vobizGeminiBridge = new VobizGeminiBridge();
export default vobizGeminiBridge;
