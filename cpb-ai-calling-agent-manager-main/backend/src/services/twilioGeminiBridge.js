import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { normalizeCallTranscript } from './transcriptText.js';
import {
  languageOpeningDirective,
  languagePreferenceSection,
  openingLanguageLine,
  resolveSessionPromptRegion,
} from './languagePrompts.js';
import Integration from '../models/Integration.js';
import AICaller from '../models/AICaller.js';
import Campaign from '../models/Campaign.js';
import Lead from '../models/Lead.js';
import TelephonyConfig from '../models/TelephonyConfig.js';
import {
  decodeMulawToPcm16,
  encodePcm16ToMulaw,
  getSampleRateFromMimeType,
  resamplePcm16,
} from './audioCodec.js';
import twilioService from './twilioService.js';
import callSessionService from './callSessionService.js';

const TWILIO_MEDIA_STREAM_PATH = '/api/telephony/twilio/media-stream';
const GEMINI_LIVE_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
const TWILIO_FRAME_BYTES = 160; // 20ms @ 8kHz mulaw mono
const TWILIO_FRAME_MS = 20;
const MAX_QA_CONTEXT_ENTRIES = 20;
const MAX_LEAD_CUSTOM_FIELDS = 20;
const DEFAULT_MAX_CALL_WRAP_UP_GRACE_SECONDS = 30;
const TOOL_END_CALL_NAME = 'end_call';
const DEFAULT_PROACTIVE_GREETING_ENABLED = true;
const DEFAULT_PROACTIVE_GREETING_RETRY_MS = 2200;
const DEFAULT_PROACTIVE_GREETING_MAX_RETRIES = 1;
const DEFAULT_PREWARM_ENABLED = true;
const DEFAULT_PREWARM_TTL_MS = 120000;
const DEFAULT_PREWARM_MAX_BUFFER_MS = 5000;
const DEFAULT_TOKEN_PRICING_MODEL = 'gemini-3.1-flash-live-preview';
// Source: https://ai.google.dev/pricing (Live API), captured April 1, 2026.
const DEFAULT_TOKEN_PRICING_USD_PER_1M = Object.freeze({
  inputText: 0.75,
  inputAudio: 3.0,
  inputImageVideo: 1.0,
  outputText: 4.5,
  outputAudio: 12.0,
});
const LOG_LEVEL_PRIORITY = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

class TwilioGeminiBridge {
  static parseNonNegativeFloat(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  constructor() {
    const configuredLevel = (process.env.TWILIO_GEMINI_LOG_LEVEL || 'info').toLowerCase();
    const mediaLogInterval = Number.parseInt(
      process.env.TWILIO_GEMINI_PROGRESS_LOG_INTERVAL || '250',
      10
    );

    this.wss = null;
    this.sessions = new Map();
    const maxCallWrapUpGraceSeconds = Number.parseInt(
      process.env.TWILIO_GEMINI_MAX_CALL_WRAPUP_GRACE_SECONDS ||
        String(DEFAULT_MAX_CALL_WRAP_UP_GRACE_SECONDS),
      10
    );
    const proactiveGreetingRetryMs = Number.parseInt(
      process.env.TWILIO_GEMINI_PROACTIVE_GREETING_RETRY_MS ||
        String(DEFAULT_PROACTIVE_GREETING_RETRY_MS),
      10
    );
    const proactiveGreetingMaxRetries = Number.parseInt(
      process.env.TWILIO_GEMINI_PROACTIVE_GREETING_MAX_RETRIES ||
        String(DEFAULT_PROACTIVE_GREETING_MAX_RETRIES),
      10
    );
    const proactiveGreetingEnabledRaw =
      process.env.TWILIO_GEMINI_PROACTIVE_GREETING_ENABLED ?? String(DEFAULT_PROACTIVE_GREETING_ENABLED);
    const proactiveGreetingEnabled = String(proactiveGreetingEnabledRaw).toLowerCase() !== 'false';
    const prewarmEnabledRaw =
      process.env.TWILIO_GEMINI_PREWARM_ENABLED ?? String(DEFAULT_PREWARM_ENABLED);
    const prewarmEnabled = String(prewarmEnabledRaw).toLowerCase() !== 'false';
    const prewarmTtlMs = Number.parseInt(
      process.env.TWILIO_GEMINI_PREWARM_TTL_MS || String(DEFAULT_PREWARM_TTL_MS),
      10
    );
    const prewarmMaxBufferMs = Number.parseInt(
      process.env.TWILIO_GEMINI_PREWARM_MAX_BUFFER_MS || String(DEFAULT_PREWARM_MAX_BUFFER_MS),
      10
    );
    this.config = {
      logLevel: LOG_LEVEL_PRIORITY[configuredLevel] !== undefined ? configuredLevel : 'info',
      progressLogsEnabled: process.env.TWILIO_GEMINI_PROGRESS_LOGS === 'true',
      progressLogInterval:
        Number.isFinite(mediaLogInterval) && mediaLogInterval > 0 ? mediaLogInterval : 250,
      reportsEnabled: process.env.TWILIO_GEMINI_REPORTS_ENABLED === 'true',
      reportPath:
        process.env.TWILIO_GEMINI_REPORT_PATH ||
        path.resolve(process.cwd(), 'reports', 'twilio-gemini-sessions.ndjson'),
      maxCallWrapUpGraceSeconds:
        Number.isFinite(maxCallWrapUpGraceSeconds) && maxCallWrapUpGraceSeconds > 0
          ? maxCallWrapUpGraceSeconds
          : DEFAULT_MAX_CALL_WRAP_UP_GRACE_SECONDS,
      proactiveGreetingEnabled,
      proactiveGreetingRetryMs:
        Number.isFinite(proactiveGreetingRetryMs) && proactiveGreetingRetryMs > 0
          ? proactiveGreetingRetryMs
          : DEFAULT_PROACTIVE_GREETING_RETRY_MS,
      proactiveGreetingMaxRetries:
        Number.isFinite(proactiveGreetingMaxRetries) && proactiveGreetingMaxRetries >= 0
          ? proactiveGreetingMaxRetries
          : DEFAULT_PROACTIVE_GREETING_MAX_RETRIES,
      prewarmEnabled,
      prewarmTtlMs:
        Number.isFinite(prewarmTtlMs) && prewarmTtlMs > 0 ? prewarmTtlMs : DEFAULT_PREWARM_TTL_MS,
      prewarmMaxBufferMs:
        Number.isFinite(prewarmMaxBufferMs) && prewarmMaxBufferMs > 0
          ? prewarmMaxBufferMs
          : DEFAULT_PREWARM_MAX_BUFFER_MS,
      tokenPricingUsdPer1M: {
        inputText: TwilioGeminiBridge.parseNonNegativeFloat(
          process.env.TWILIO_GEMINI_INPUT_TEXT_USD_PER_1M,
          DEFAULT_TOKEN_PRICING_USD_PER_1M.inputText
        ),
        inputAudio: TwilioGeminiBridge.parseNonNegativeFloat(
          process.env.TWILIO_GEMINI_INPUT_AUDIO_USD_PER_1M,
          DEFAULT_TOKEN_PRICING_USD_PER_1M.inputAudio
        ),
        inputImageVideo: TwilioGeminiBridge.parseNonNegativeFloat(
          process.env.TWILIO_GEMINI_INPUT_IMAGE_VIDEO_USD_PER_1M,
          DEFAULT_TOKEN_PRICING_USD_PER_1M.inputImageVideo
        ),
        outputText: TwilioGeminiBridge.parseNonNegativeFloat(
          process.env.TWILIO_GEMINI_OUTPUT_TEXT_USD_PER_1M,
          DEFAULT_TOKEN_PRICING_USD_PER_1M.outputText
        ),
        outputAudio: TwilioGeminiBridge.parseNonNegativeFloat(
          process.env.TWILIO_GEMINI_OUTPUT_AUDIO_USD_PER_1M,
          DEFAULT_TOKEN_PRICING_USD_PER_1M.outputAudio
        ),
      },
    };
    this.runtimeMetrics = {
      startedAt: new Date().toISOString(),
      sessionsStarted: 0,
      sessionsClosed: 0,
      closesByReason: {},
      geminiPayloadErrors: 0,
      geminiSocketErrors: 0,
      twilioSocketErrors: 0,
    };
    this.prewarmedCalls = new Map();
  }

  createSessionMetrics() {
    const emptyModalityCounts = {
      text: 0,
      audio: 0,
      image: 0,
      video: 0,
      other: 0,
    };
    return {
      createdAtMs: Date.now(),
      twilioEvents: {},
      twilioMediaPacketsIn: 0,
      twilioMediaBytesIn: 0,
      twilioClearEventsOut: 0,
      geminiMessagesIn: 0,
      geminiAudioPartsIn: 0,
      geminiAudioBytesIn: 0,
      geminiAudioChunksOut: 0,
      geminiAudioBytesOut: 0,
      interruptions: 0,
      setupCompleteMs: null,
      queueHighWaterMark: 0,
      twilioFramesSent: 0,
      twilioFramesDropped: 0,
      maxCallDurationSeconds: null,
      maxDurationWrapUpSent: false,
      toolCallsIn: 0,
      topLevelToolCallsIn: 0,
      modelTurnPartToolCallsIn: 0,
      toolResponsesOut: 0,
      endCallRequests: 0,
      proactiveGreetingPrompts: 0,
      proactiveGreetingRetries: 0,
      prewarmAudioPartsDropped: 0,
      firstModelAudioLatencyMs: null,
      usageMetadataEvents: 0,
      tokenUsage: {
        promptTokenCount: 0,
        responseTokenCount: 0,
        totalTokenCount: 0,
        thoughtsTokenCount: 0,
        cachedContentTokenCount: 0,
        toolUsePromptTokenCount: 0,
        promptTokensByModality: { ...emptyModalityCounts },
        responseTokensByModality: { ...emptyModalityCounts },
      },
      estimatedTokenCostUsd: {
        inputUsd: 0,
        outputUsd: 0,
        totalUsd: 0,
      },
    };
  }

  elapsedMs(session) {
    return Date.now() - session.metrics.createdAtMs;
  }

  recordTwilioEvent(session, event) {
    session.metrics.twilioEvents[event] = (session.metrics.twilioEvents[event] || 0) + 1;
  }

  bumpRuntimeClose(reason) {
    this.runtimeMetrics.sessionsClosed += 1;
    this.runtimeMetrics.closesByReason[reason] =
      (this.runtimeMetrics.closesByReason[reason] || 0) + 1;
  }

  shouldLog(level) {
    const current = LOG_LEVEL_PRIORITY[this.config.logLevel] ?? LOG_LEVEL_PRIORITY.info;
    const target = LOG_LEVEL_PRIORITY[level] ?? LOG_LEVEL_PRIORITY.info;
    return target <= current;
  }

  log(level, message, data = {}) {
    if (!this.shouldLog(level)) {
      return;
    }

    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    const agentName = this.sanitizePromptValue(data?.agentName, 200);
    const prefix = agentName ? `[TwilioGeminiBridge] [${agentName}]` : '[TwilioGeminiBridge]';
    logger(prefix, message, data);
  }

  logSession(level, session, message, data = {}) {
    const agentName = this.sanitizePromptValue(session?.aiCaller?.name, 200);
    this.log(level, message, {
      ...(agentName ? { agentName } : {}),
      sessionId: session.id,
      callSid: session.callSid,
      streamSid: session.streamSid,
      elapsedMs: this.elapsedMs(session),
      ...data,
    });
  }

  async writeSessionReport(report) {
    if (!this.config.reportsEnabled) return;

    const fullPath = path.isAbsolute(this.config.reportPath)
      ? this.config.reportPath
      : path.resolve(process.cwd(), this.config.reportPath);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.appendFile(fullPath, `${JSON.stringify(report)}\n`, 'utf8');
  }

  sanitizePromptValue(value, maxLength = 500) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, maxLength);
  }

  normalizeThinkingLevel(value, model = '') {
    const modelStr = String(model || '').toLowerCase();
    // Low-latency live models (like gemini-3.1-flash-live-preview) explicitly reject thinkingConfig
    if (modelStr && !modelStr.includes('thinking')) {
      return null;
    }
    if (!value || typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    if (!['minimal', 'low', 'medium', 'high'].includes(normalized)) {
      return null;
    }
    return normalized;
  }

  // formatLeadCustomFields(customFields) {
  //   if (!customFields) return [];

  //   const entries =
  //     typeof customFields.entries === 'function'
  //       ? Array.from(customFields.entries())
  //       : Object.entries(customFields || {});

  //   return entries
  //     .filter(
  //       ([key, value]) =>
  //         this.sanitizePromptValue(key, 100) !== '' && this.sanitizePromptValue(value, 300) !== ''
  //     )
  //     .slice(0, MAX_LEAD_CUSTOM_FIELDS)
  //     .map(
  //       ([key, value]) =>
  //         `- ${this.sanitizePromptValue(key, 100)}: ${this.sanitizePromptValue(value, 300)}`
  //     );
  // }

  createEmptyModalityTokenCounts() {
    return {
      text: 0,
      audio: 0,
      image: 0,
      video: 0,
      other: 0,
    };
  }

  normalizeModalityLabel(modality) {
    const normalized = this.sanitizePromptValue(modality, 40).toLowerCase();
    switch (normalized) {
      case 'text':
        return 'text';
      case 'audio':
        return 'audio';
      case 'image':
        return 'image';
      case 'video':
        return 'video';
      default:
        return 'other';
    }
  }

  extractModalityTokenCounts(details) {
    const counts = this.createEmptyModalityTokenCounts();
    if (!Array.isArray(details)) {
      return counts;
    }

    for (const entry of details) {
      const tokenCount = Number.parseInt(entry?.tokenCount ?? entry?.token_count ?? 0, 10);
      if (!Number.isFinite(tokenCount) || tokenCount <= 0) {
        continue;
      }
      const modality = this.normalizeModalityLabel(entry?.modality);
      counts[modality] += tokenCount;
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
    if (!previous) {
      return next;
    }

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
    const cachedContentTokenCount =
      Number.parseInt(usageMetadata.cachedContentTokenCount ?? 0, 10) || 0;
    const toolUsePromptTokenCount =
      Number.parseInt(usageMetadata.toolUsePromptTokenCount ?? 0, 10) || 0;

    const promptTokensByModality = this.extractModalityTokenCounts(usageMetadata.promptTokensDetails);
    const responseTokensByModality = this.extractModalityTokenCounts(usageMetadata.responseTokensDetails);

    const knownPromptTokens = Object.values(promptTokensByModality).reduce((sum, value) => sum + value, 0);
    const knownResponseTokens = Object.values(responseTokensByModality).reduce(
      (sum, value) => sum + value,
      0
    );

    // If modality breakdown is unavailable, classify residuals as text.
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
      ((prompt.text + prompt.other) * rates.inputText +
        prompt.audio * rates.inputAudio +
        (prompt.image + prompt.video) * rates.inputImageVideo) /
      1_000_000;

    const outputUsd =
      ((response.text + response.other) * rates.outputText + response.audio * rates.outputAudio) /
      1_000_000;

    return {
      inputUsd: this.roundUsd(inputUsd),
      outputUsd: this.roundUsd(outputUsd),
      totalUsd: this.roundUsd(inputUsd + outputUsd),
      pricingModel: DEFAULT_TOKEN_PRICING_MODEL,
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
        aggregate.responseTokensByModality[modality] +=
          snapshot.responseTokensByModality?.[modality] || 0;
      }
    }

    session.metrics.tokenUsage = aggregate;
    session.metrics.estimatedTokenCostUsd = this.estimateTokenCostUsd(aggregate);
  }

  updateUsageMetrics(session, payload) {
    const usageMetadata = payload?.usageMetadata;
    if (!usageMetadata) {
      return;
    }

    const usageKey =
      this.sanitizePromptValue(payload?.responseId, 120) ||
      `turn-${session.usageTurnIndex || 0}`;
    const snapshot = this.normalizeUsageSnapshot(usageMetadata);
    const previous = session.usageByResponseId.get(usageKey);
    const merged = this.mergeUsageSnapshotsByMax(previous, snapshot);
    session.usageByResponseId.set(usageKey, merged);
    session.metrics.usageMetadataEvents += 1;
    this.recomputeAggregatedUsageMetrics(session);

    if (
      this.config.progressLogsEnabled &&
      session.metrics.usageMetadataEvents % this.config.progressLogInterval === 0
    ) {
      this.logSession('debug', session, 'Gemini usage metadata progress', {
        usageMetadataEvents: session.metrics.usageMetadataEvents,
        promptTokenCount: session.metrics.tokenUsage.promptTokenCount,
        responseTokenCount: session.metrics.tokenUsage.responseTokenCount,
        estimatedTokenCostUsd: session.metrics.estimatedTokenCostUsd.totalUsd,
      });
    }
  }

  buildContextualSystemPrompt(session, baseSystemPrompt, preferredLanguage) {
    const promptRegion = resolveSessionPromptRegion(session);
    const sections = [
      languageOpeningDirective(promptRegion),
      this.sanitizePromptValue(baseSystemPrompt, 4000) ||
        'You are a helpful AI assistant making phone calls. Keep responses concise and conversational.',
    ];

    sections.push(languagePreferenceSection(promptRegion, preferredLanguage));
  

    sections.push(
      `Call completion policy:
- When the conversation is complete or the user asks to end, give a brief polite goodbye.
- Immediately after the final goodbye, call the ${TOOL_END_CALL_NAME} tool with a short reason and one-line summary.
- If a system directive asks you to wrap up due time limit, prioritize a concise close and call ${TOOL_END_CALL_NAME}.`
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
        callerLines.push(
          `- Description: ${this.sanitizePromptValue(session.aiCaller.description, 600)}`
        );
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
        campaignLines.push(
          `- Objective: ${this.sanitizePromptValue(session.campaign.description, 800)}`
        );
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

      // const customFieldLines = this.formatLeadCustomFields(session.lead.customFields);
      // if (customFieldLines.length) {
      //   leadLines.push('- Custom fields:');
      //   leadLines.push(...customFieldLines); 
      // }

      if (leadLines.length) {
        sections.push(
          `Lead Context:\n${leadLines.join('\n')}\nUse this context naturally during the call and avoid exposing internal metadata unless asked.`
        );
      }
    }

    const qaEntries = Array.isArray(session.aiCaller?.qaEntries) ? session.aiCaller.qaEntries : [];
    if (qaEntries.length > 0) {
      const qaLines = qaEntries
        .filter(
          (entry) =>
            this.sanitizePromptValue(entry?.question, 500) &&
            this.sanitizePromptValue(entry?.answer, 1200)
        )
        .slice(0, MAX_QA_CONTEXT_ENTRIES)
        .map(
          (entry, index) =>
            `${index + 1}. Q: ${this.sanitizePromptValue(
              entry.question,
              500
            )}\n   A: ${this.sanitizePromptValue(entry.answer, 1200)}`
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
            description:
              'Ends the active phone call after a polite wrap-up. Use this when the conversation is complete or the user asks to finish.',
            parameters: {
              type: 'OBJECT',
              properties: {
                reason: {
                  type: 'STRING',
                  description: 'Short reason for ending the call.',
                },
                summary: {
                  type: 'STRING',
                  description: 'Optional one-line summary of the conversation outcome.',
                },
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
      this.logSession('warn', session, 'Skipped tool response because Gemini socket is not open');
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
      this.logSession('debug', session, 'Ignoring duplicate end-call request', { source, reason });
      return;
    }

    session.endingCallInProgress = true;
    session.metrics.endCallRequests += 1;
    const safeSummary = this.sanitizePromptValue(summary, 500);
    session.toolEndReason = this.sanitizePromptValue(reason, 200);
    session.toolEndSummary = safeSummary;
    this.logSession('info', session, 'Ending call', { source, reason, summary: safeSummary || undefined });

    try {
      if (session.callSid) {
        let telephony = null;
        const telephonyIntegrationId = session.params?.telephonyIntegrationId;
        if (telephonyIntegrationId) {
          telephony = await Integration.findOne({ _id: telephonyIntegrationId, type: 'telephony' });
        }
        if (!telephony) {
          telephony = await Integration.findOne({ type: 'telephony', isDefault: true, isActive: true });
        }
        const accountSid = telephony?.authConfig?.username;
        const authToken = telephony?.authConfig?.password;

        if (accountSid && authToken) {
          const endResult = await twilioService.endCall({
            accountSid,
            authToken,
            callSid: session.callSid,
          });

          this.logSession('info', session, 'Twilio REST call end requested', {
            source,
            callStatus: endResult?.status,
          });
        } else {
          this.logSession('warn', session, 'Twilio credentials unavailable for REST hangup', { source });
        }
      } else {
        this.logSession('warn', session, 'Cannot end Twilio call via REST: missing callSid', { source });
      }
    } catch (error) {
      this.logSession('error', session, 'Failed to end Twilio call via REST', {
        source,
        name: error?.name,
        message: error?.message,
      });
    } finally {
      if (this.sessions.has(session.id)) {
        this.closeSession(session, source);
      }
    }
  }

  async handleToolCallMessage(session, toolCall, source = 'top-level') {
    const functionCalls = Array.isArray(toolCall?.functionCalls) ? toolCall.functionCalls : [];
    if (functionCalls.length === 0) {
      this.logSession('debug', session, 'Received toolCall without functionCalls');
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
      this.logSession('debug', session, 'Skipping duplicate toolCall message', { source });
      return;
    }

    session.metrics.toolCallsIn += dedupedCalls.length;
    if (source === 'model-turn-part') {
      session.metrics.modelTurnPartToolCallsIn += dedupedCalls.length;
    } else {
      session.metrics.topLevelToolCallsIn += dedupedCalls.length;
    }
    this.logSession('info', session, 'Gemini tool call received', {
      source,
      functionNames: dedupedCalls.map((call) => call?.name || 'unknown'),
      totalToolCallsIn: session.metrics.toolCallsIn,
    });

    const functionResponses = [];
    let endCallRequest = null;

    for (const functionCall of dedupedCalls) {
      const functionId = functionCall?.id;
      const functionName = functionCall?.name;

      if (functionName === TOOL_END_CALL_NAME) {
        const args = this.parseFunctionCallArgs(functionCall?.args ?? functionCall?.arguments);
        const reason =
          this.sanitizePromptValue(args?.reason, 200) || 'conversation-complete';
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
          this.logSession('error', session, 'Error executing end-call tool', {
            message: error?.message,
          });
        });
      }, 120);
    }
  }

  parsePositiveInt(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  resolveMaxCallDurationSeconds(session) {
    const fromParams = this.parsePositiveInt(session.params?.maxCallDuration);
    if (fromParams) {
      return {
        seconds: fromParams,
        source: 'stream-parameter',
      };
    }

    const fromGuardrails = this.parsePositiveInt(session.aiCaller?.guardrails?.maxCallDuration);
    if (fromGuardrails) {
      return {
        seconds: fromGuardrails,
        source: 'ai-caller-guardrail',
      };
    }

    const fromCampaignSettings = this.parsePositiveInt(session.campaign?.settings?.maxCallDuration);
    if (fromCampaignSettings) {
      return {
        seconds: fromCampaignSettings,
        source: 'campaign-setting',
      };
    }

    return null;
  }

  clearMaxCallDurationTimers(session) {
    if (session.maxCallDurationTimer) {
      clearTimeout(session.maxCallDurationTimer);
      session.maxCallDurationTimer = null;
    }
    if (session.maxCallDurationHardStopTimer) {
      clearTimeout(session.maxCallDurationHardStopTimer);
      session.maxCallDurationHardStopTimer = null;
    }
  }

  sendRealtimeTextInstruction(session, text) {
    const cleanText = this.sanitizePromptValue(text, 3000);
    if (!cleanText) return;
    if (!session.geminiWs || session.geminiWs.readyState !== WebSocket.OPEN) {
      this.logSession('warn', session, 'Skipped realtime text instruction because Gemini socket is not open');
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

  clearProactiveGreetingRetryTimer(session) {
    if (session.proactiveGreetingRetryTimer) {
      clearTimeout(session.proactiveGreetingRetryTimer);
      session.proactiveGreetingRetryTimer = null;
    }
  }

  getBufferedMulawMs(session) {
    const queuedFramesMs = (session.outboundMulawQueue?.length || 0) * TWILIO_FRAME_MS;
    const partialFrameMs = session.outboundMulawRemainder?.length
      ? Math.round((session.outboundMulawRemainder.length / TWILIO_FRAME_BYTES) * TWILIO_FRAME_MS)
      : 0;
    return queuedFramesMs + partialFrameMs;
  }

  markModelAudioStarted(session) {
    if (session.firstModelAudioAtMs) {
      return;
    }

    session.firstModelAudioAtMs = Date.now();
    this.clearProactiveGreetingRetryTimer(session);

    if (session.setupCompletedAtMs) {
      session.metrics.firstModelAudioLatencyMs = session.firstModelAudioAtMs - session.setupCompletedAtMs;
    }

    this.logSession('info', session, 'First model audio detected', {
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
    if (callerName) {
      context.push(`Caller identity/context: ${callerName}.`);
    }
    if (leadName) {
      context.push(`Lead first name: ${leadName}.`);
    }
    if (preferredLanguage) {
      context.push(openingLanguageLine(preferredLanguage, promptRegion));
    }

    if (session.isPrewarmSession) {
      return [
        'SYSTEM DIRECTIVE: The call may connect soon. Generate exactly one short opening line now.',
        'Keep it under 12 words and then wait silently for the user.',
        'Do not continue speaking until user speech is detected.',
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
    if (!this.config.proactiveGreetingEnabled) return;
    if (!this.sessions.has(session.id)) return;
    if (!session.geminiReady) return;
    if (session.firstModelAudioAtMs) return;
    if (session.isPrewarmSession && session.metrics.proactiveGreetingPrompts > 0) return;

    const instruction = this.buildProactiveGreetingInstruction(session);
    this.sendRealtimeTextInstruction(session, instruction);
    session.metrics.proactiveGreetingPrompts += 1;
    if (reason !== 'setup-complete') {
      session.metrics.proactiveGreetingRetries += 1;
    }

    this.logSession('info', session, 'Proactive greeting requested', {
      reason,
      proactiveGreetingPrompts: session.metrics.proactiveGreetingPrompts,
      proactiveGreetingRetries: session.metrics.proactiveGreetingRetries,
    });

    this.clearProactiveGreetingRetryTimer(session);
    if (
      !session.isPrewarmSession &&
      session.metrics.proactiveGreetingRetries < this.config.proactiveGreetingMaxRetries &&
      !session.firstModelAudioAtMs
    ) {
      session.proactiveGreetingRetryTimer = setTimeout(() => {
        if (!this.sessions.has(session.id)) return;
        if (session.firstModelAudioAtMs) return;
        this.requestProactiveGreeting(session, 'retry-timeout');
      }, this.config.proactiveGreetingRetryMs);
    }
  }

  scheduleMaxCallDuration(session) {
    this.clearMaxCallDurationTimers(session);
    session.maxDurationWrapUpRequested = false;

    const maxCallDuration = this.resolveMaxCallDurationSeconds(session);
    if (!maxCallDuration) {
      return;
    }
    const { seconds: maxCallDurationSeconds, source: maxCallDurationSource } = maxCallDuration;

    session.maxCallDurationSeconds = maxCallDurationSeconds;
    session.metrics.maxCallDurationSeconds = maxCallDurationSeconds;

    session.maxCallDurationTimer = setTimeout(() => {
      this.handleMaxCallDurationReached(session);
    }, maxCallDurationSeconds * 1000);

    this.logSession('info', session, 'Max call duration timer armed', {
      maxCallDurationSeconds,
      maxCallDurationSource,
      wrapUpGraceSeconds: this.config.maxCallWrapUpGraceSeconds,
    });
  }

  handleMaxCallDurationReached(session) {
    if (!this.sessions.has(session.id)) return;
    if (session.maxDurationWrapUpRequested) return;
    session.maxDurationWrapUpRequested = true;
    session.metrics.maxDurationWrapUpSent = true;

    this.logSession('warn', session, 'Max call duration reached, requesting natural wrap-up', {
      maxCallDurationSeconds: session.maxCallDurationSeconds,
      wrapUpGraceSeconds: this.config.maxCallWrapUpGraceSeconds,
    });

    this.sendRealtimeTextInstruction(
      session,
      'SYSTEM DIRECTIVE: Maximum call duration has been reached. Politely wrap up now. In your very next response, give a concise summary, confirm any next step in one short line, and end the call with a brief goodbye.'
    );

    session.maxCallDurationHardStopTimer = setTimeout(() => {
      if (!this.sessions.has(session.id)) return;
      this.logSession('warn', session, 'Max call wrap-up grace expired, forcing call end', {
        maxCallDurationSeconds: session.maxCallDurationSeconds,
        wrapUpGraceSeconds: this.config.maxCallWrapUpGraceSeconds,
      });
      this.executeEndCall(session, {
        source: 'max-duration-hard-stop',
        reason: 'max-call-duration-exceeded',
      }).catch((error) => {
        this.logSession('error', session, 'Failed to execute max-duration hard stop', {
          message: error?.message,
        });
      });
    }, this.config.maxCallWrapUpGraceSeconds * 1000);
  }

  initialize(server) {
    if (this.wss) return;

    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      if (requestUrl.pathname !== TWILIO_MEDIA_STREAM_PATH) {
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', (twilioWs, request) => {
      this.handleTwilioConnection(twilioWs, request).catch((error) => {
        this.log('error', 'Connection setup error', {
          name: error?.name,
          message: error?.message,
        });
        if (twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.close();
        }
      });
    });

    this.log('info', 'WebSocket bridge initialized', {
      logLevel: this.config.logLevel,
      progressLogsEnabled: this.config.progressLogsEnabled,
      reportsEnabled: this.config.reportsEnabled,
      reportPath: this.config.reportsEnabled ? this.config.reportPath : undefined,
      proactiveGreeting: {
        enabled: this.config.proactiveGreetingEnabled,
        retryMs: this.config.proactiveGreetingRetryMs,
        maxRetries: this.config.proactiveGreetingMaxRetries,
      },
      prewarm: {
        enabled: this.config.prewarmEnabled,
        ttlMs: this.config.prewarmTtlMs,
        maxBufferMs: this.config.prewarmMaxBufferMs,
      },
    });
  }

  async prewarmCallSession({ callSid, params = {} } = {}) {
    if (!this.config.prewarmEnabled) {
      return { success: false, reason: 'prewarm-disabled' };
    }

    const normalizedCallSid = this.sanitizePromptValue(callSid, 120);
    if (!normalizedCallSid) {
      return { success: false, reason: 'missing-call-sid' };
    }

    if (this.prewarmedCalls.has(normalizedCallSid)) {
      const existing = this.prewarmedCalls.get(normalizedCallSid);
      return {
        success: true,
        reused: true,
        sessionId: existing?.id,
      };
    }

    const prewarmSession = {
      id: `prewarm-${randomUUID()}`,
      twilioWs: null,
      geminiWs: null,
      streamSid: null,
      callSid: normalizedCallSid,
      callSessionId: this.sanitizePromptValue(params.callSessionId, 120) || null,
      integration: null,
      aiCaller: null,
      campaign: null,
      lead: null,
      params: { ...params },
      pendingAudioChunks: [],
      geminiReady: false,
      transcript: [],
      modelIsSpeaking: false,
      outboundPcmRemainder: Buffer.alloc(0),
      outboundResampleSourceRate: null,
      outboundMulawQueue: [],
      outboundMulawRemainder: Buffer.alloc(0),
      twilioPlaybackTimer: null,
      maxCallDurationTimer: null,
      maxCallDurationHardStopTimer: null,
      maxCallDurationSeconds: null,
      maxDurationWrapUpRequested: false,
      endingCallInProgress: false,
      toolEndReason: '',
      toolEndSummary: '',
      model: null,
      setupCompletedAtMs: null,
      firstModelAudioAtMs: null,
      proactiveGreetingRetryTimer: null,
      prewarmExpiryTimer: null,
      isPrewarmSession: true,
      usageTurnIndex: 0,
      usageByResponseId: new Map(),
      processedToolCallIds: new Set(),
      metrics: this.createSessionMetrics(),
      closeMeta: {
        twilio: null,
        gemini: null,
      },
    };

    this.sessions.set(prewarmSession.id, prewarmSession);
    this.prewarmedCalls.set(normalizedCallSid, prewarmSession);
    prewarmSession.prewarmExpiryTimer = setTimeout(() => {
      if (!this.sessions.has(prewarmSession.id)) return;
      this.logSession('warn', prewarmSession, 'Prewarm session expired before Twilio stream start', {
        prewarmTtlMs: this.config.prewarmTtlMs,
      });
      this.closeSession(prewarmSession, 'prewarm-timeout');
    }, this.config.prewarmTtlMs);

    try {
      if (prewarmSession.params.aiCallerId) {
        prewarmSession.aiCaller = await AICaller.findById(prewarmSession.params.aiCallerId).select(
          'name description s2sConfig qaEntries guardrails'
        );
      }

      this.logSession('info', prewarmSession, 'Starting Gemini prewarm session', {
        prewarmTtlMs: this.config.prewarmTtlMs,
        paramKeys: Object.keys(prewarmSession.params || {}),
      });

      if (prewarmSession.params.campaignId) {
        prewarmSession.campaign = await Campaign.findById(prewarmSession.params.campaignId).select(
          'name description settings'
        );
      }

      if (prewarmSession.params.leadId) {
        prewarmSession.lead = await Lead.findById(prewarmSession.params.leadId).select(
          'name phone phoneNumber email customFields'
        );
      }

      const integration = await this.resolveIntegration(prewarmSession.params);
      if (!integration) {
        throw new Error('No active S2S integration found for prewarm');
      }
      prewarmSession.integration = integration;

      await this.connectGeminiSession(prewarmSession);
      return { success: true, sessionId: prewarmSession.id };
    } catch (error) {
      this.logSession('warn', prewarmSession, 'Failed to start prewarm session', {
        message: error?.message,
      });
      this.closeSession(prewarmSession, 'prewarm-setup-failed');
      return { success: false, reason: 'prewarm-setup-failed', error: error?.message };
    }
  }

  adoptPrewarmedCall(session) {
    const callSid = this.sanitizePromptValue(session.callSid, 120);
    if (!callSid) return false;

    const prewarmed = this.prewarmedCalls.get(callSid);
    if (!prewarmed || prewarmed.id === session.id) {
      return false;
    }

    this.prewarmedCalls.delete(callSid);

    if (prewarmed.prewarmExpiryTimer) {
      clearTimeout(prewarmed.prewarmExpiryTimer);
      prewarmed.prewarmExpiryTimer = null;
    }

    this.clearProactiveGreetingRetryTimer(prewarmed);

    if (!prewarmed.geminiWs) {
      this.logSession('warn', prewarmed, 'Prewarmed session had no Gemini websocket at adopt time', {
        prewarmSessionId: prewarmed.id,
      });
      this.sessions.delete(prewarmed.id);
      return false;
    }

    if (
      prewarmed.geminiWs.readyState === WebSocket.CLOSING ||
      prewarmed.geminiWs.readyState === WebSocket.CLOSED
    ) {
      this.logSession('warn', prewarmed, 'Prewarmed Gemini websocket was not usable at adopt time', {
        prewarmSessionId: prewarmed.id,
        readyState: prewarmed.geminiWs.readyState,
      });
      this.sessions.delete(prewarmed.id);
      return false;
    }

    if (prewarmed.geminiWs) {
      prewarmed.geminiWs.removeAllListeners('message');
      prewarmed.geminiWs.removeAllListeners('error');
      prewarmed.geminiWs.removeAllListeners('unexpected-response');
      prewarmed.geminiWs.removeAllListeners('close');
      session.geminiWs = prewarmed.geminiWs;
      this.attachGeminiSocketListeners(session);
    }

    session.integration = prewarmed.integration || session.integration;
    session.aiCaller = prewarmed.aiCaller || session.aiCaller;
    session.campaign = prewarmed.campaign || session.campaign;
    session.lead = prewarmed.lead || session.lead;
    session.params = {
      ...(prewarmed.params || {}),
      ...(session.params || {}),
    };
    session.callSessionId = session.callSessionId || prewarmed.callSessionId || null;
    session.geminiReady = prewarmed.geminiReady;
    session.transcript = Array.isArray(prewarmed.transcript) ? prewarmed.transcript : [];
    session.modelIsSpeaking = Boolean(prewarmed.modelIsSpeaking);
    session.outboundPcmRemainder = prewarmed.outboundPcmRemainder || Buffer.alloc(0);
    session.outboundResampleSourceRate = prewarmed.outboundResampleSourceRate || null;
    session.outboundMulawQueue = Array.isArray(prewarmed.outboundMulawQueue)
      ? prewarmed.outboundMulawQueue
      : [];
    session.outboundMulawRemainder = prewarmed.outboundMulawRemainder || Buffer.alloc(0);
    session.setupCompletedAtMs = prewarmed.setupCompletedAtMs || null;
    session.firstModelAudioAtMs = prewarmed.firstModelAudioAtMs || null;
    session.usageTurnIndex = prewarmed.usageTurnIndex || 0;
    session.usageByResponseId =
      prewarmed.usageByResponseId instanceof Map
        ? new Map(prewarmed.usageByResponseId)
        : new Map();
    session.processedToolCallIds =
      prewarmed.processedToolCallIds instanceof Set
        ? new Set(prewarmed.processedToolCallIds)
        : new Set();
    session.toolEndReason = prewarmed.toolEndReason || '';
    session.toolEndSummary = prewarmed.toolEndSummary || '';

    session.metrics.geminiMessagesIn += prewarmed.metrics.geminiMessagesIn;
    session.metrics.geminiAudioPartsIn += prewarmed.metrics.geminiAudioPartsIn;
    session.metrics.geminiAudioBytesIn += prewarmed.metrics.geminiAudioBytesIn;
    session.metrics.proactiveGreetingPrompts += prewarmed.metrics.proactiveGreetingPrompts;
    session.metrics.proactiveGreetingRetries += prewarmed.metrics.proactiveGreetingRetries;
    session.metrics.setupCompleteMs = prewarmed.metrics.setupCompleteMs ?? session.metrics.setupCompleteMs;
    session.metrics.firstModelAudioLatencyMs =
      prewarmed.metrics.firstModelAudioLatencyMs ?? session.metrics.firstModelAudioLatencyMs;
    session.metrics.usageMetadataEvents += prewarmed.metrics.usageMetadataEvents;
    session.metrics.tokenUsage = prewarmed.metrics.tokenUsage;
    session.metrics.estimatedTokenCostUsd = prewarmed.metrics.estimatedTokenCostUsd;

    this.sessions.delete(prewarmed.id);

    this.logSession('info', session, 'Adopted prewarmed Gemini session', {
      prewarmSessionId: prewarmed.id,
      bufferedFrames: session.outboundMulawQueue.length,
      geminiReady: session.geminiReady,
    });

    return true;
  }

  async handleTwilioConnection(twilioWs, request) {
    const sessionId = randomUUID();
    const session = {
      id: sessionId,
      twilioWs,
      geminiWs: null,
      streamSid: null,
      callSid: null,
      callSessionId: null,
      integration: null,
      aiCaller: null,
      campaign: null,
      lead: null,
      params: {},
      pendingAudioChunks: [],
      geminiReady: false,
      transcript: [],
      modelIsSpeaking: false,
      outboundPcmRemainder: Buffer.alloc(0),
      outboundResampleSourceRate: null,
      outboundMulawQueue: [],
      outboundMulawRemainder: Buffer.alloc(0),
      twilioPlaybackTimer: null,
      maxCallDurationTimer: null,
      maxCallDurationHardStopTimer: null,
      maxCallDurationSeconds: null,
      maxDurationWrapUpRequested: false,
      endingCallInProgress: false,
      toolEndReason: '',
      toolEndSummary: '',
      model: null,
      setupCompletedAtMs: null,
      firstModelAudioAtMs: null,
      proactiveGreetingRetryTimer: null,
      prewarmExpiryTimer: null,
      isPrewarmSession: false,
      usageTurnIndex: 0,
      usageByResponseId: new Map(),
      processedToolCallIds: new Set(),
      metrics: this.createSessionMetrics(),
      closeMeta: {
        twilio: null,
        gemini: null,
      },
    };

    this.sessions.set(sessionId, session);
    this.runtimeMetrics.sessionsStarted += 1;

    this.logSession('info', session, 'Twilio client connected', {
      url: request.url,
      activeSessions: this.sessions.size,
    });

    twilioWs.on('message', async (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        await this.handleTwilioMessage(session, message);
      } catch (error) {
        this.logSession('error', session, 'Failed to process Twilio message', {
          name: error?.name,
          message: error?.message,
          rawPreview: raw?.toString?.().slice?.(0, 200),
        });
      }
    });

    twilioWs.on('close', (code, reasonBuffer) => {
      const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || '');
      session.closeMeta.twilio = { code, reason };
      this.logSession('warn', session, 'Twilio socket closed', { code, reason });
      this.closeSession(session, 'twilio-close');
    });

    twilioWs.on('error', (error) => {
      this.runtimeMetrics.twilioSocketErrors += 1;
      this.logSession('error', session, 'Twilio socket error', {
        name: error?.name,
        message: error?.message,
      });
      this.closeSession(session, 'twilio-error');
    });
  }

  async handleTwilioMessage(session, message) {
    const { event } = message;
    this.recordTwilioEvent(session, event || 'unknown');

    switch (event) {
      case 'start':
        await this.handleStartEvent(session, message);
        break;
      case 'media':
        this.handleMediaEvent(session, message);
        break;
      case 'stop':
        session.closeMeta.twilio = session.closeMeta.twilio || { code: null, reason: 'stop-event' };
        this.logSession('info', session, 'Received Twilio stop event');
        this.closeSession(session, 'twilio-stop');
        break;
      case 'playedStream':
      case 'playedstream':
        this.logSession('debug', session, 'Received stream playback acknowledgement', { event });
        break;
      default:
        this.logSession('debug', session, 'Received unsupported Twilio event', { event });
        break;
    }
  }

  async handleStartEvent(session, message) {
    session.streamSid = message.streamSid || message.start?.streamSid || null;
    session.callSid = message.start?.callSid || null;
    session.params = message.start?.customParameters || {};
    session.callSessionId = this.sanitizePromptValue(session.params.callSessionId, 120) || null;
    const prewarmedForLog = this.prewarmedCalls.get(this.sanitizePromptValue(session.callSid, 120));
    if (prewarmedForLog?.aiCaller && !session.aiCaller) {
      session.aiCaller = prewarmedForLog.aiCaller;
    }
    this.logSession('info', session, 'Twilio stream start received', {
      customParamKeys: Object.keys(session.params || {}),
      callSessionId: session.callSessionId || undefined,
    });

    if (this.adoptPrewarmedCall(session)) {
      this.scheduleMaxCallDuration(session);
      if (session.outboundMulawQueue.length > 0) {
        this.logSession('info', session, 'Using prebuffered greeting audio after adopt', {
          bufferedFrames: session.outboundMulawQueue.length,
        });
        this.ensureTwilioPlaybackLoop(session);
      } else if (!session.firstModelAudioAtMs) {
        // Fallback only when no prebuffered audio exists at adopt time.
        this.requestProactiveGreeting(session, 'post-adopt-no-buffer');
      }
      return;
    }

    if (session.params.aiCallerId) {
      session.aiCaller = await AICaller.findById(session.params.aiCallerId).select(
        'name description s2sConfig qaEntries guardrails'
      );
      this.logSession('info', session, 'Resolved AI caller for session', {
        aiCallerId: session.params.aiCallerId,
        hasCaller: Boolean(session.aiCaller),
      });
    }

    if (session.params.campaignId) {
      session.campaign = await Campaign.findById(session.params.campaignId).select(
        'name description settings'
      );
      this.logSession('debug', session, 'Resolved campaign for session', {
        campaignId: session.params.campaignId,
        hasCampaign: Boolean(session.campaign),
      });
    }

    if (session.params.leadId) {
      session.lead = await Lead.findById(session.params.leadId).select(
        'name phone phoneNumber email customFields'
      );
      this.logSession('debug', session, 'Resolved lead for session', {
        leadId: session.params.leadId,
        hasLead: Boolean(session.lead),
      });
    }

    const integration = await this.resolveIntegration(session.params);
    if (!integration) {
      this.logSession('error', session, 'No integration resolved for session');
      throw new Error('No active S2S integration found for Twilio/Gemini bridge');
    }
    session.integration = integration;
    this.logSession('info', session, 'Resolved integration', {
      integrationId: integration._id?.toString?.(),
      integrationName: integration.name,
      baseUrl: integration.baseUrl,
    });

    this.scheduleMaxCallDuration(session);
    await this.connectGeminiSession(session);
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

  attachGeminiSocketListeners(session) {
    if (!session.geminiWs) return;

    session.geminiWs.on('message', (raw) => {
      this.handleGeminiMessage(session, raw);
    });

    session.geminiWs.on('error', (error) => {
      this.runtimeMetrics.geminiSocketErrors += 1;
      this.logSession('error', session, 'Gemini socket error', {
        name: error?.name,
        message: error?.message,
      });
      this.closeSession(session, session.isPrewarmSession ? 'prewarm-gemini-error' : 'gemini-error');
    });

    session.geminiWs.on('unexpected-response', (_request, response) => {
      this.logSession('error', session, 'Gemini unexpected websocket response', {
        statusCode: response?.statusCode,
        statusMessage: response?.statusMessage,
      });
    });

    session.geminiWs.on('close', (code, reasonBuffer) => {
      const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || '');
      session.closeMeta.gemini = { code, reason };
      this.logSession('warn', session, 'Gemini socket closed', {
        code,
        reason,
      });
      this.closeSession(session, session.isPrewarmSession ? 'prewarm-gemini-close' : 'gemini-close');
    });
  }

  async connectGeminiSession(session) {
    const apiKey = session.integration?.authConfig?.token?.trim();
    if (!apiKey) {
      this.logSession('error', session, 'Gemini API key missing on integration');
      throw new Error('Gemini API key is missing in S2S integration auth config');
    }

    const model =
      session.params.model ||
      session.aiCaller?.s2sConfig?.model ||
      session.integration?.metadata?.get?.('model') ||
      session.integration?.metadata?.model ||
      session.integration?.availableModels?.[0]?.id ||
      DEFAULT_MODEL;
    session.model = this.sanitizePromptValue(model, 120) || DEFAULT_MODEL;

    const wsBase = (session.integration.baseUrl || GEMINI_LIVE_WS_BASE).trim();
    const separator = wsBase.includes('?') ? '&' : '?';
    const geminiUrl = `${wsBase}${separator}key=${encodeURIComponent(apiKey)}`;
    this.logSession('info', session, 'Opening Gemini websocket', {
      model,
      wsBase,
    });

    session.geminiWs = new WebSocket(geminiUrl);

    session.geminiWs.on('open', () => {
      const baseSystemPrompt =
        session.params.systemPrompt ||
        session.aiCaller?.s2sConfig?.systemPrompt ||
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
      const systemPrompt = this.buildContextualSystemPrompt(
        session,
        baseSystemPrompt,
        preferredLanguage
      );
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
          //     // Make barge-in more responsive in phone-call conditions.
          //     startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
          //     endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          //     prefixPaddingMs: 40,
          //     silenceDurationMs: 200,
          //   },
          // },
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };

      this.logSession('info', session, 'Sending Gemini setup payload', {
        model: setupPayload.setup.model,
        preferredVoice,
        preferredLanguage,
        promptRegion: resolveSessionPromptRegion(session),
        thinkingLevel,
        hasInputTranscription: Boolean(setupPayload.setup.inputAudioTranscription),
        hasOutputTranscription: Boolean(setupPayload.setup.outputAudioTranscription),
        promptLength: systemPrompt.length,
        toolNames: tools
          .flatMap((tool) => tool?.functionDeclarations || [])
          .map((declaration) => declaration?.name)
          .filter(Boolean),
      });
      session.geminiWs.send(JSON.stringify(setupPayload));
    });
    this.attachGeminiSocketListeners(session);
  }

  handleMediaEvent(session, message) {
    const payload = message?.media?.payload;
    if (!payload) return;
    session.metrics.twilioMediaPacketsIn += 1;

    const twilioAudio = Buffer.from(payload, 'base64');
    session.metrics.twilioMediaBytesIn += twilioAudio.length;
    const pcm8 = decodeMulawToPcm16(twilioAudio);
    const pcm16 = resamplePcm16(pcm8, 8000, 16000);
    const encoded = pcm16.toString('base64');

    if (
      this.config.progressLogsEnabled &&
      session.metrics.twilioMediaPacketsIn % this.config.progressLogInterval === 0
    ) {
      this.logSession('debug', session, 'Twilio inbound media progress', {
        packetsIn: session.metrics.twilioMediaPacketsIn,
        bytesIn: session.metrics.twilioMediaBytesIn,
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
    session.metrics.geminiAudioChunksOut += 1;
    session.metrics.geminiAudioBytesOut += Buffer.byteLength(base64Pcm16, 'base64');
    if (
      this.config.progressLogsEnabled &&
      session.metrics.geminiAudioChunksOut % this.config.progressLogInterval === 0
    ) {
      this.logSession('debug', session, 'Gemini outbound audio progress', {
        chunksOut: session.metrics.geminiAudioChunksOut,
        bytesOut: session.metrics.geminiAudioBytesOut,
      });
    }
    session.geminiWs.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: base64Pcm16,
            mimeType: 'audio/pcm;rate=16000',
          },
        },
      })
    );
  }

  handleGeminiMessage(session, raw) {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      this.logSession('warn', session, 'Failed to parse Gemini payload as JSON');
      return;
    }
    session.metrics.geminiMessagesIn += 1;
    this.updateUsageMetrics(session, payload);
    if (
      this.config.progressLogsEnabled &&
      session.metrics.geminiMessagesIn % this.config.progressLogInterval === 0
    ) {
      this.logSession('debug', session, 'Gemini inbound message progress', {
        messagesIn: session.metrics.geminiMessagesIn,
      });
    }

    if (payload.error) {
      this.runtimeMetrics.geminiPayloadErrors += 1;
      this.logSession('error', session, 'Gemini payload error', {
        error: payload.error,
      });
      this.closeSession(session, 'gemini-payload-error');
      return;
    }

    if (payload.setupComplete) {
      session.geminiReady = true;
      session.setupCompletedAtMs = Date.now();
      session.metrics.setupCompleteMs = this.elapsedMs(session);
      this.logSession('info', session, 'Gemini setup complete', {
        setupCompleteMs: session.metrics.setupCompleteMs,
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

    if (payload.toolCall) {
      this.handleToolCallMessage(session, payload.toolCall, 'top-level').catch((error) => {
        this.logSession('error', session, 'Failed handling Gemini tool call', {
          message: error?.message,
        });
      });
    }

    if (payload.toolCallCancellation) {
      this.logSession('info', session, 'Gemini requested tool call cancellation', {
        ids: payload.toolCallCancellation?.ids || [],
      });
      // Continue processing in case future payload shapes include additional fields.
    }

    const serverContent = payload.serverContent;
    if (!serverContent) {
      const payloadKeys = Object.keys(payload || {});
      const isSessionResumptionOnly =
        payloadKeys.length === 1 && payloadKeys[0] === 'sessionResumptionUpdate';
      if (this.config.progressLogsEnabled && !isSessionResumptionOnly) {
        this.logSession('debug', session, 'Gemini payload without serverContent', {
          payloadKeys,
        });
      }
      return;
    }
    const wasInterrupted = Boolean(serverContent.interrupted);
    const turnComplete = Boolean(serverContent.turnComplete);
    const generationComplete = Boolean(serverContent.generationComplete);
    if (wasInterrupted) {
      session.metrics.interruptions += 1;
      this.logSession('info', session, 'Gemini interruption signaled', {
        interruptions: session.metrics.interruptions,
      });
    }

    if (wasInterrupted) {
      // Gemini VAD detected user interruption. Clear any buffered model audio
      // in Twilio so the user can barge in naturally.
      this.clearTwilioAudio(session);
      session.modelIsSpeaking = false;
      session.outboundMulawQueue = [];
      session.outboundMulawRemainder = Buffer.alloc(0);
    }

    if (serverContent.inputTranscription?.text) {
      const heard = normalizeCallTranscript(serverContent.inputTranscription.text);
      if (heard) {
        session.transcript.push({
          speaker: 'user',
          text: heard,
          timestamp: new Date().toISOString(),
        });
      }
    }
    if (serverContent.outputTranscription?.text) {
      const spoken = normalizeCallTranscript(serverContent.outputTranscription.text);
      if (spoken) {
        session.transcript.push({
          speaker: 'ai',
          text: spoken,
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (generationComplete || turnComplete) {
      session.modelIsSpeaking = false;
    }

    if (wasInterrupted) {
      if (turnComplete) {
        session.usageTurnIndex += 1;
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
          this.logSession('error', session, 'Failed handling model-turn part functionCall', {
            message: error?.message,
          });
        }
      );
    }

    for (const part of parts) {
      const inlineData = part.inlineData;
      if (!inlineData?.data) continue;
      if (session.isPrewarmSession && !session.streamSid) {
        const bufferedMs = this.getBufferedMulawMs(session);
        if (bufferedMs >= this.config.prewarmMaxBufferMs) {
          session.metrics.prewarmAudioPartsDropped += 1;
          if (session.metrics.prewarmAudioPartsDropped % 25 === 0) {
            this.logSession('warn', session, 'Dropping excess prewarm model audio to limit overhead', {
              bufferedMs,
              prewarmMaxBufferMs: this.config.prewarmMaxBufferMs,
              prewarmAudioPartsDropped: session.metrics.prewarmAudioPartsDropped,
            });
          }
          continue;
        }
      }
      this.markModelAudioStarted(session);
      session.metrics.geminiAudioPartsIn += 1;

      const geminiAudioPcm = Buffer.from(inlineData.data, 'base64');
      session.metrics.geminiAudioBytesIn += geminiAudioPcm.length;
      const geminiRate = getSampleRateFromMimeType(inlineData.mimeType, 24000);
      const pcm8 = this.convertGeminiPcmToTelephonyPcm(session, geminiAudioPcm, geminiRate);
      if (!pcm8 || pcm8.length === 0) continue;
      const mulaw = encodePcm16ToMulaw(pcm8);

      session.modelIsSpeaking = true;
      this.queueTwilioAudio(session, mulaw);
    }

    if ((generationComplete || turnComplete) && session.outboundMulawRemainder.length) {
      session.outboundMulawQueue.push(session.outboundMulawRemainder);
      session.outboundMulawRemainder = Buffer.alloc(0);
      this.ensureTwilioPlaybackLoop(session);
    }

    if (turnComplete) {
      session.usageTurnIndex += 1;
    }
  }

  queueTwilioAudio(session, mulawBuffer) {
    if (!mulawBuffer || mulawBuffer.length === 0) return;

    const combined = session.outboundMulawRemainder.length
      ? Buffer.concat([session.outboundMulawRemainder, mulawBuffer])
      : mulawBuffer;

    let offset = 0;
    while (combined.length - offset >= TWILIO_FRAME_BYTES) {
      session.outboundMulawQueue.push(combined.subarray(offset, offset + TWILIO_FRAME_BYTES));
      offset += TWILIO_FRAME_BYTES;
    }

    session.outboundMulawRemainder = combined.subarray(offset);
    if (session.outboundMulawQueue.length > session.metrics.queueHighWaterMark) {
      session.metrics.queueHighWaterMark = session.outboundMulawQueue.length;
    }
    // Only log if playback queue is critically backed up (>600 frames / 12s)
    if (session.outboundMulawQueue.length > 600) {
      this.logSession('debug', session, 'Twilio playback queue backlog', {
        queuedFrames: session.outboundMulawQueue.length,
        queuedMs: session.outboundMulawQueue.length * TWILIO_FRAME_MS,
      });
    }
    this.ensureTwilioPlaybackLoop(session);
  }

  ensureTwilioPlaybackLoop(session) {
    if (!session.streamSid) return;
    if (!session.twilioWs || session.twilioWs.readyState !== WebSocket.OPEN) return;
    if (session.twilioPlaybackTimer) return;
    session.twilioPlaybackTimer = setInterval(() => {
      this.flushTwilioPlaybackFrame(session);
    }, TWILIO_FRAME_MS);
  }

  flushTwilioPlaybackFrame(session) {
    if (!this.sessions.has(session.id)) {
      this.stopTwilioPlaybackLoop(session);
      return;
    }

    if (!session.streamSid || !session.twilioWs || session.twilioWs.readyState !== WebSocket.OPEN) {
      this.stopTwilioPlaybackLoop(session);
      return;
    }

    if (session.outboundMulawQueue.length === 0) {
      this.stopTwilioPlaybackLoop(session);
      return;
    }

    const frame = session.outboundMulawQueue.shift();
    session.metrics.twilioFramesSent += 1;
    this.sendAudioToTwilio(session, frame.toString('base64'));
  }

  stopTwilioPlaybackLoop(session) {
    if (!session.twilioPlaybackTimer) return;
    clearInterval(session.twilioPlaybackTimer);
    session.twilioPlaybackTimer = null;
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

    if (session.outboundResampleSourceRate !== inputRate) {
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

  sendAudioToTwilio(session, mulawPayload) {
    if (!session.streamSid) return;
    if (!session.twilioWs || session.twilioWs.readyState !== WebSocket.OPEN) return;

    session.twilioWs.send(
      JSON.stringify({
        event: 'media',
        streamSid: session.streamSid,
        media: {
          payload: mulawPayload,
        },
      })
    );
  }

  clearTwilioAudio(session) {
    if (!session.streamSid) return;
    if (!session.twilioWs || session.twilioWs.readyState !== WebSocket.OPEN) return;

    session.metrics.twilioFramesDropped += session.outboundMulawQueue.length;
    session.metrics.twilioClearEventsOut += 1;
    session.outboundMulawQueue = [];
    session.outboundMulawRemainder = Buffer.alloc(0);
    this.stopTwilioPlaybackLoop(session);

    this.logSession('info', session, 'Clearing Twilio playback buffer', {
      clearEventsOut: session.metrics.twilioClearEventsOut,
      framesDroppedTotal: session.metrics.twilioFramesDropped,
    });

    session.twilioWs.send(
      JSON.stringify({
        event: 'clear',
        streamSid: session.streamSid,
      })
    );
  }

  detectModelFarewell(session) {
    const aiTranscript = session.transcript
      .filter((entry) => entry?.speaker === 'ai' && entry?.text)
      .slice(-3)
      .map((entry) => entry.text.toLowerCase())
      .join(' ');

    if (!aiTranscript) {
      return false;
    }

    return /\b(goodbye|bye|take care|have a (good|great) day|see you|alvida|khuda hafiz)\b/i.test(
      aiTranscript
    );
  }

  closeSession(session, reason) {
    if (!this.sessions.has(session.id)) return;
    this.sessions.delete(session.id);
    if (!session.isPrewarmSession) {
      this.bumpRuntimeClose(reason);
    }

    if (session.callSid) {
      const prewarmed = this.prewarmedCalls.get(session.callSid);
      if (prewarmed?.id === session.id) {
        this.prewarmedCalls.delete(session.callSid);
      }
    }

    this.logSession('warn', session, 'Closing session', {
      reason,
      activeSessions: this.sessions.size,
    });

    this.clearMaxCallDurationTimers(session);
    this.clearProactiveGreetingRetryTimer(session);
    if (session.prewarmExpiryTimer) {
      clearTimeout(session.prewarmExpiryTimer);
      session.prewarmExpiryTimer = null;
    }
    this.stopTwilioPlaybackLoop(session);
    session.outboundMulawQueue = [];
    session.outboundMulawRemainder = Buffer.alloc(0);
    session.outboundPcmRemainder = Buffer.alloc(0);

    if (session.geminiWs && session.geminiWs.readyState === WebSocket.OPEN) {
      session.geminiWs.close();
    }
    if (session.twilioWs && session.twilioWs.readyState === WebSocket.OPEN) {
      session.twilioWs.close();
    }

    if (session.isPrewarmSession) {
      this.logSession('info', session, 'Prewarm session closed', {
        reason,
        geminiReady: session.geminiReady,
        bufferedFrames: session.outboundMulawQueue.length,
      });
      return;
    }

    const modelFarewellDetected = this.detectModelFarewell(session);
    if (modelFarewellDetected && session.metrics.toolCallsIn === 0) {
      this.logSession('warn', session, 'Farewell detected without any Gemini tool call', {
        suggestion:
          'Model likely ended verbally but did not invoke end_call. Tighten instructions or keep max-duration hard-stop as fallback.',
      });
    }

    const summary = {
      sessionId: session.id,
      callSid: session.callSid,
      callSessionId: session.callSessionId,
      streamSid: session.streamSid,
      model: session.model,
      reason,
      toolEndReason: session.toolEndReason || '',
      toolEndSummary: session.toolEndSummary || '',
      durationMs: this.elapsedMs(session),
      setupCompleteMs: session.metrics.setupCompleteMs,
      twilioEvents: session.metrics.twilioEvents,
      twilioMediaPacketsIn: session.metrics.twilioMediaPacketsIn,
      twilioMediaBytesIn: session.metrics.twilioMediaBytesIn,
      twilioFramesSent: session.metrics.twilioFramesSent,
      twilioFramesDropped: session.metrics.twilioFramesDropped,
      twilioClearEventsOut: session.metrics.twilioClearEventsOut,
      geminiMessagesIn: session.metrics.geminiMessagesIn,
      geminiAudioPartsIn: session.metrics.geminiAudioPartsIn,
      geminiAudioBytesIn: session.metrics.geminiAudioBytesIn,
      geminiAudioChunksOut: session.metrics.geminiAudioChunksOut,
      geminiAudioBytesOut: session.metrics.geminiAudioBytesOut,
      interruptions: session.metrics.interruptions,
      queueHighWaterMark: session.metrics.queueHighWaterMark,
      maxCallDurationSeconds: session.metrics.maxCallDurationSeconds,
      maxDurationWrapUpSent: session.metrics.maxDurationWrapUpSent,
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
      tokenUsage: session.metrics.tokenUsage,
      estimatedTokenCostUsd: session.metrics.estimatedTokenCostUsd,
      transcriptTurns: Array.isArray(session.transcript)
        ? session.transcript
            .map((entry) => ({
              speaker: entry?.speaker,
              text: this.sanitizePromptValue(entry?.text, 5000),
              timestamp: entry?.timestamp || new Date().toISOString(),
            }))
            .filter((entry) => entry.speaker && entry.text)
        : [],
      transcriptText: Array.isArray(session.transcript)
        ? session.transcript
            .map((entry) => {
              const speaker = this.sanitizePromptValue(entry?.speaker, 20) || 'unknown';
              const text = this.sanitizePromptValue(entry?.text, 5000);
              return text ? `${speaker}: ${text}` : '';
            })
            .filter(Boolean)
            .join('\n')
        : '',
      modelFarewellDetected,
      closeMeta: session.closeMeta,
      runtimeMetrics: this.runtimeMetrics,
      closedAt: new Date().toISOString(),
    };

    const agentName = this.sanitizePromptValue(session.aiCaller?.name, 200);
    this.log('info', 'Session metrics summary', agentName ? { agentName, ...summary } : summary);
    callSessionService.finalizeSessionFromBridge(summary).catch((error) => {
      this.log('error', 'Failed to persist call session summary', {
        callSessionId: summary.callSessionId,
        callSid: summary.callSid,
        message: error?.message,
      });
    });
    this.writeSessionReport(summary).catch((error) => {
      this.log('error', 'Failed to write session report', {
        sessionId: session.id,
        message: error?.message,
      });
    });
  }
}

const twilioGeminiBridge = new TwilioGeminiBridge();
export default twilioGeminiBridge;
