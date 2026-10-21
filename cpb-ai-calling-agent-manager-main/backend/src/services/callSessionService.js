import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import CallSession from '../models/CallSession.js';
import Campaign from '../models/Campaign.js';
import Lead from '../models/Lead.js';
import AICaller from '../models/AICaller.js';
import Integration from '../models/Integration.js';
import { detectAutomatedParty as detectAutomatedPartyFromTranscript } from './machineTranscript.js';
import { emptyAvailability, formatAvailabilityLabel, normalizeAvailability } from './availability.js';

const DEFAULT_RETRY_GAP_MINUTES = 120;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_EXTRACTION_MODEL = 'gemini-2.5-flash';
const GEMINI_REST_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_ABRUPT_DURATION_SECONDS = 20;
const DEFAULT_ABRUPT_TRANSCRIPT_CHARS = 60;
const BACKFILL_GAP_MS = 5000;
const BACKFILL_BATCH_CAP = 10000;
const BACKFILL_SAMPLE_LIMIT = 12;
const BACKFILL_TERMINAL_STATUSES = ['completed', 'connected', 'no_answer', 'busy', 'voicemail', 'failed', 'canceled', 'exhausted'];
const EXTRACTION_CLAIM_MS = 3 * 60 * 1000;
const INTERRUPTED_EXTRACTION_LOOKBACK_MS = 15 * 60 * 1000;
const MAX_EXTRACTION_ATTEMPTS = 3;
const PREMATURE_NO_TRANSCRIPT_ERROR = 'No transcript available for extraction';
const NORMAL_SOCKET_CLOSE_CODES = new Set([1000, 1001, 1005]);
const WARNING_SOCKET_CLOSE_CODES = new Set([1012, 1013, 1014]);

const socketCloseSeverity = (entry) => {
  const code = Number(entry?.code);
  if (!Number.isFinite(code) || code <= 0 || NORMAL_SOCKET_CLOSE_CODES.has(code)) return null;
  if (WARNING_SOCKET_CLOSE_CODES.has(code)) return 'warning';
  if (code >= 1002 && code <= 1015) return 'error';
  return null;
};

// Gemini 1008 (policy / free-tier quota) and provider socket failures.
// A normal hangup closes with 1000 or 1005 and is not a system fault.
const providerSystemFault = (summary = {}) => {
  const reason = String(summary.reason || '').toLowerCase();
  if (/gemini-(start-failed|error|payload-error)|vobiz-error|twilio-error|system-error|no-integration/.test(reason)) {
    return 'error';
  }

  const closeMeta = summary.closeMeta || {};
  const geminiFault = socketCloseSeverity(closeMeta.gemini);
  if (geminiFault && /gemini/.test(reason) && !/tool-end/.test(reason)) {
    return geminiFault;
  }

  const providerEntry = closeMeta.vobiz || closeMeta.twilio;
  const providerCode = Number(providerEntry?.code);
  if (/vobiz-error|twilio-error/.test(reason)) return 'error';
  if (/vobiz-close|twilio-close/.test(reason) && [1008, 1002, 1003, 1011].includes(providerCode)) {
    return 'error';
  }
  if (/vobiz-close|twilio-close/.test(reason) && WARNING_SOCKET_CLOSE_CODES.has(providerCode)) {
    return 'warning';
  }
  return null;
};

const describeSystemFault = (summary = {}) => {
  const closeMeta = summary.closeMeta || {};
  const gemini = closeMeta.gemini || {};
  const provider = closeMeta.vobiz || closeMeta.twilio || {};
  const parts = [summary.reason || 'system-error'];
  if (gemini.code) parts.push(`gemini ${gemini.code}`);
  if (gemini.reason) parts.push(gemini.reason);
  else if (provider.code) parts.push(`provider ${provider.code}`);
  if (!gemini.reason && provider.reason) parts.push(provider.reason);
  return parts.filter(Boolean).join(' · ');
};

const RETRYABLE_SESSION_STATUSES = new Set(['no_answer', 'busy', 'failed', 'canceled']);

class CallSessionService {
  constructor() {
    // Live calls from running campaigns use the priority lane and can run in
    // parallel. Historical backfill is a separate lane: it starts only when
    // the priority lane is idle, and waits 5s between calls so it does not
    // take Gemini capacity from calls that are happening now.
    this.priorityQueue = [];
    this.backfillQueue = [];
    this.inProgressExtractions = new Set();
    this.activeExtractionWorkers = 0;
    this.backfillInFlight = false;
    this.backfillTimer = null;
    this.extractionAttempts = new Map();
    this.maxConcurrentExtractions = Math.max(
      1,
      Number.parseInt(process.env.EXTRACTION_CONCURRENCY, 10) || 6
    );

    // Only calls from the last few minutes that never finished extraction.
    // This is not a historical sweep.
    setTimeout(() => {
      this.recoverInterruptedExtractions().catch((error) => {
        console.error('[ExtractionQueue] Failed to recover interrupted extractions:', error?.message);
      });
    }, 10000);
  }
  sanitizeText(value, maxLength = 2000) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim().slice(0, maxLength);
  }

  parsePositiveInt(value, fallback = null) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return fallback;
  }

  parseNonNegativeInt(value, fallback = null) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return fallback;
  }

  getSteppedRetryMultiplier(retryStep) {
    if (retryStep <= 1) return 1;
    if (retryStep === 2) return 2;
    return 3;
  }

  isRetryableSessionStatus(status) {
    return RETRYABLE_SESSION_STATUSES.has(status);
  }

  buildRetrySchedule({ now, retryGapMinutes, retryStep }) {
    const multiplier = this.getSteppedRetryMultiplier(retryStep);
    const gapMinutes = retryGapMinutes * multiplier;
    return {
      scheduledFor: new Date(now.getTime() + gapMinutes * 60 * 1000),
      multiplier,
      gapMinutes,
    };
  }

  getRetryChildStatusForReason(retryReason) {
    if (retryReason === 'abrupt_end') {
      return 'scheduled';
    }
    return 'scheduled';
  }

  async scheduleRetrySession({
    session,
    lead,
    campaign,
    retryReason,
    now,
    metadata = {},
  }) {
    const maxRetries = this.parseNonNegativeInt(campaign?.settings?.maxRetries, DEFAULT_MAX_RETRIES);
    const retryGapMinutes = this.parseNonNegativeInt(
      campaign?.settings?.retryGap,
      DEFAULT_RETRY_GAP_MINUTES
    );
    const currentRetryCount = this.parsePositiveInt(lead.retryCount, 0) || 0;
    const nextRetryStep = currentRetryCount + 1;
    const shouldScheduleRetry = currentRetryCount < maxRetries;

    lead.lastCalledAt = now;

    if (!shouldScheduleRetry) {
      lead.status = 'exhausted';
      lead.nextRetryAt = null;
      session.retryDecisionApplied = true;
      session.metadata = {
        ...(session.metadata || {}),
        retryDecision: {
          reason: retryReason,
          action: 'exhausted',
          retriesUsed: currentRetryCount,
          maxRetries,
        },
      };
      await Promise.all([lead.save(), session.save()]);
      return null;
    }

    const schedule = this.buildRetrySchedule({
      now,
      retryGapMinutes,
      retryStep: nextRetryStep,
    });

    lead.retryCount = nextRetryStep;
    lead.status = 'no_answer';
    lead.nextRetryAt = schedule.scheduledFor;

    let existingChild = await CallSession.findOne({
      parentSessionId: session._id,
      retryReason,
      retryStep: nextRetryStep,
    });

    if (!existingChild) {
      existingChild = await CallSession.create({
        campaignId: session.campaignId,
        leadId: session.leadId,
        callerId: session.callerId,
        createdBy: session.createdBy,
        integrationId: session.integrationId || null,
        parentSessionId: session._id,
        attemptIndex: session.attemptIndex + 1,
        status: this.getRetryChildStatusForReason(retryReason),
        scheduledFor: schedule.scheduledFor,
        retryReason,
        retryStep: nextRetryStep,
        metadata: {
          parentProviderCallId: session.providerCallId || session.twilioCallSid || '',
          retryMultiplier: schedule.multiplier,
          retryGapMinutes: schedule.gapMinutes,
          ...metadata,
        },
      });
    }

    session.retryDecisionApplied = true;
    session.metadata = {
      ...(session.metadata || {}),
      childSessionId: existingChild._id.toString(),
      retryScheduledFor: schedule.scheduledFor.toISOString(),
      retryDecision: {
        reason: retryReason,
        action: 'scheduled',
        retryStep: nextRetryStep,
        maxRetries,
        multiplier: schedule.multiplier,
      },
    };

    await Promise.all([lead.save(), session.save()]);
    return existingChild;
  }

  shouldClassifyAsAbrupt({ session, summary = '' }) {
    if (!session || session.status !== 'completed') {
      return false;
    }

    const durationThreshold = this.parsePositiveInt(
      process.env.CALL_ABRUPT_DURATION_SECONDS,
      DEFAULT_ABRUPT_DURATION_SECONDS
    );
    const transcriptThreshold = this.parsePositiveInt(
      process.env.CALL_ABRUPT_MIN_TRANSCRIPT_CHARS,
      DEFAULT_ABRUPT_TRANSCRIPT_CHARS
    );

    const durationSeconds = this.parsePositiveInt(session.durationSeconds, 0) || 0;
    const transcriptChars = this.sanitizeText(session.transcriptText, 100000).length;
    const summaryText = this.sanitizeText(summary || session.summary || session.toolEndSummary, 1200).toLowerCase();
    const abruptHint = /(no\s*(conversation|response|interaction)|abrupt|call\s*dropped|hung\s*up\s*early|disconnected\s*early)/i;

    const shortDuration = durationSeconds > 0 && durationSeconds <= durationThreshold;
    const thinTranscript = transcriptChars <= transcriptThreshold;
    const summarySuggestsAbrupt = abruptHint.test(summaryText);

    return (shortDuration && thinTranscript) || summarySuggestsAbrupt;
  }

  normalizeTwilioStatus(callStatus) {
    return this.sanitizeText(callStatus, 50).toLowerCase();
  }

  mapTwilioStatusToSessionStatus(callStatus) {
    switch (this.normalizeTwilioStatus(callStatus)) {
      case 'initiated':
        return 'initiated';
      case 'queued':
        return 'queued';
      case 'ringing':
        return 'ringing';
      case 'in-progress':
        return 'connected';
      case 'answered':
        return 'connected';
      case 'completed':
        return 'completed';
      case 'busy':
        return 'busy';
      case 'no-answer':
        return 'no_answer';
      case 'failed':
        return 'failed';
      case 'canceled':
      case 'cancelled':
        return 'canceled';
      default:
        return null;
    }
  }

  isTerminalSessionStatus(status) {
    return [
      'completed',
      'no_answer',
      'busy',
      'voicemail',
      'failed',
      'canceled',
      'exhausted',
    ].includes(status);
  }

  async createPrimarySession({
    campaignId,
    leadId,
    callerId,
    createdBy,
    integrationId = null,
  }) {
    const scheduledSession = await CallSession.findOne({
      campaignId,
      leadId,
      status: 'scheduled',
      $or: [{ twilioCallSid: { $exists: false } }, { twilioCallSid: '' }, { twilioCallSid: null }],
    }).sort({ scheduledFor: 1, createdAt: 1 });

    if (scheduledSession) {
      scheduledSession.status = 'initiated';
      scheduledSession.initiatedAt = new Date();
      scheduledSession.integrationId = integrationId || scheduledSession.integrationId;
      await scheduledSession.save();
      return scheduledSession;
    }

    const previousAttempts = await CallSession.countDocuments({
      campaignId,
      leadId,
    });

    const session = await CallSession.create({
      campaignId,
      leadId,
      callerId,
      createdBy,
      integrationId,
      attemptIndex: previousAttempts + 1,
      status: 'initiated',
      initiatedAt: new Date(),
    });

    return session;
  }

  async attachTwilioCallSid({ callSessionId, callSid, initialStatus = 'queued', provider = '' }) {
    if (!callSessionId) {
      return null;
    }

    const session = await CallSession.findById(callSessionId);
    if (!session) {
      return null;
    }

    if (callSid) {
      const sanitizedSid = this.sanitizeText(callSid, 120);
      session.providerCallId = sanitizedSid;
      // Keep legacy field in sync for historical lookups.
      session.twilioCallSid = sanitizedSid;
    }
    session.provider = this.sanitizeText(provider, 30) || session.provider || '';

    const mappedStatus = this.mapTwilioStatusToSessionStatus(initialStatus);
    if (mappedStatus && !this.isTerminalSessionStatus(session.status)) {
      session.status = mappedStatus;
    }

    await session.save();
    return session;
  }

  async markSessionFailed({ callSessionId, reason = 'initiate-failed' }) {
    if (!callSessionId) {
      return null;
    }

    const session = await CallSession.findById(callSessionId);
    if (!session) {
      return null;
    }

    if (!this.isTerminalSessionStatus(session.status)) {
      session.status = 'failed';
    }
    session.endReason = this.sanitizeText(reason, 200);
    session.endedAt = session.endedAt || new Date();
    session.completedAt = session.completedAt || new Date();
    await session.save();
    return session;
  }

  async resolveSession({ callSessionId, callSid }) {
    if (callSessionId) {
      const byId = await CallSession.findById(callSessionId);
      if (byId) {
        return byId;
      }
    }

    const sanitizedSid = this.sanitizeText(callSid, 120);
    if (!sanitizedSid) {
      return null;
    }

    return CallSession.findOne({
      $or: [{ providerCallId: sanitizedSid }, { twilioCallSid: sanitizedSid }],
    }).sort({ createdAt: -1 });
  }

  async handleTwilioStatusUpdate({ callSessionId, callSid, callStatus, payload = {} }) {
    const session = await this.resolveSession({ callSessionId, callSid });
    if (!session) {
      return { sessionUpdated: false, session: null, childSession: null };
    }

    const normalizedStatus = this.normalizeTwilioStatus(callStatus);
    const mappedStatus = this.mapTwilioStatusToSessionStatus(normalizedStatus);
    const now = new Date();

    if (callSid && !session.providerCallId) {
      const sanitizedSid = this.sanitizeText(callSid, 120);
      session.providerCallId = sanitizedSid;
      session.twilioCallSid = session.twilioCallSid || sanitizedSid;
    }
    if (callSid && !session.twilioCallSid) {
      session.twilioCallSid = this.sanitizeText(callSid, 120);
    }

    if (normalizedStatus === 'initiated' && !session.initiatedAt) {
      session.initiatedAt = now;
    }
    if (normalizedStatus === 'ringing' && !session.ringingAt) {
      session.ringingAt = now;
    }
    if ((normalizedStatus === 'answered' || normalizedStatus === 'in-progress') && !session.answeredAt) {
      session.answeredAt = now;
    }
    if (
      (normalizedStatus === 'answered' || normalizedStatus === 'in-progress') &&
      !session.connectedAt
    ) {
      session.connectedAt = now;
    }

    const durationSeconds = this.parsePositiveInt(payload?.CallDuration, null);
    if (durationSeconds !== null) {
      session.durationSeconds = durationSeconds;
    }

    const payloadReason = this.sanitizeText(
      payload?.Reason || payload?.reason || payload?.hangup_cause || payload?.HangupCause || '',
      200
    );
    if (payloadReason) {
      session.endReason = payloadReason;
    }

    if (mappedStatus) {
      if (!this.isTerminalSessionStatus(session.status) || this.isTerminalSessionStatus(mappedStatus)) {
        session.status = mappedStatus;
      }
    }

    // Set callOutcome for pre-connect terminal statuses (these won't go through finalizeSessionFromBridge)
    if (this.isTerminalSessionStatus(session.status) && !session.callOutcome) {
      const outcomeMap = {
        no_answer: 'no_answer',
        busy: 'busy',
        failed: 'failed',
        canceled: 'canceled',
        voicemail: 'voicemail',
      };
      if (outcomeMap[session.status]) {
        session.callOutcome = outcomeMap[session.status];
      }
    }

    if (this.isTerminalSessionStatus(session.status)) {
      session.endedAt = session.endedAt || now;
      session.completedAt = session.completedAt || now;
    }

    // A status callback often arrives before the transcript exists. It must not
    // enqueue extraction or write extractor fields, or it closes the call early.
    session.unmarkModified('extractor');
    session.unmarkModified('extracted');
    session.unmarkModified('humanHandoff');
    await session.save();

    const childSession = await this.syncLeadAndRetryState(session, normalizedStatus, now);
    return { sessionUpdated: true, session, childSession };
  }

  async syncLeadAndRetryState(session, normalizedTwilioStatus, now) {
    if (!session?.leadId) {
      return null;
    }

    const lead = await Lead.findById(session.leadId);
    if (!lead) {
      return null;
    }

    const campaign = await Campaign.findById(session.campaignId).select('settings');
    let childSession = null;

    if (['queued', 'initiated', 'ringing', 'in-progress'].includes(normalizedTwilioStatus)) {
      lead.status = 'calling';
      lead.lastCalledAt = now;
      await lead.save();
      return null;
    }

    if (normalizedTwilioStatus === 'answered') {
      lead.status = 'connected';
      lead.lastCalledAt = now;
      await lead.save();
      return null;
    }

    if (normalizedTwilioStatus === 'completed') {
      if (lead.status !== 'completed') {
        lead.status = 'completed';
      }
      lead.lastCalledAt = now;
      lead.nextRetryAt = null;
      await lead.save();
      return null;
    }

    if (!['no-answer', 'busy', 'failed', 'canceled'].includes(normalizedTwilioStatus)) {
      return null;
    }

    if (session.retryDecisionApplied) {
      return null;
    }

    const retryReason =
      normalizedTwilioStatus === 'no-answer' ? 'no_answer' : normalizedTwilioStatus;
    childSession = await this.scheduleRetrySession({
      session,
      lead,
      campaign,
      retryReason,
      now,
      metadata: {
        retrySourceStatus: normalizedTwilioStatus,
      },
    });

    return childSession;
  }

  normalizeTranscriptTurns(turns = []) {
    if (!Array.isArray(turns)) {
      return [];
    }

    return turns
      .map((turn) => {
        const speaker = this.sanitizeText(turn?.speaker, 20).toLowerCase();
        const text = this.sanitizeText(turn?.text, 5000);
        if (!speaker || !text) {
          return null;
        }

        const mappedSpeaker = ['user', 'ai', 'system', 'tool'].includes(speaker) ? speaker : 'system';
        const timestamp = turn?.timestamp ? new Date(turn.timestamp) : new Date();

        return {
          speaker: mappedSpeaker,
          text,
          timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
        };
      })
      .filter(Boolean);
  }

  buildTranscriptText(turns = []) {
    return turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n').trim();
  }

  shouldRunExtraction(session) {
    const hasConnectedState = Boolean(
      session.connectedAt ||
      session.answeredAt ||
      ['connected', 'completed'].includes(session.status)
    );
    const transcriptText = this.sanitizeText(session.transcriptText, 200000);
    return hasConnectedState && transcriptText.length > 0;
  }

  async resolveGeminiApiKeyAndModel(session) {
    const envApiKey = this.sanitizeText(process.env.GEMINI_EXTRACTION_API_KEY || process.env.GEMINI_API_KEY, 500);

    const integrationId = session.integrationId || null;
    let integration = null;

    if (integrationId) {
      integration = await Integration.findOne({
        _id: integrationId,
        type: 's2s',
        isActive: true,
      }).select('authConfig metadata');
    }

    if (!integration && session.callerId) {
      const caller = await AICaller.findById(session.callerId).select('s2sConfig');
      const callerIntegrationId = caller?.s2sConfig?.integrationId;
      if (callerIntegrationId) {
        integration = await Integration.findOne({
          _id: callerIntegrationId,
          type: 's2s',
          isActive: true,
        }).select('authConfig metadata');
      }
    }

    if (!integration && !envApiKey) {
      integration = await Integration.findOne({
        type: 's2s',
        isActive: true,
        $or: [{ isDefault: true }, { name: /gemini/i }, { 'metadata.templateId': 'gemini_live' }],
      })
        .sort({ isDefault: -1, updatedAt: -1 })
        .select('authConfig metadata');
    }

    const apiKey = envApiKey || this.sanitizeText(integration?.authConfig?.token, 500);
    const modelFromMetadata =
      this.sanitizeText(integration?.metadata?.get?.('extractionModel'), 120) ||
      this.sanitizeText(integration?.metadata?.extractionModel, 120);
    const model = modelFromMetadata || process.env.GEMINI_EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL;

    return { apiKey, model };
  }

  parseExtractionResponseText(rawText) {
    const text = this.sanitizeText(rawText, 20000);
    if (!text) {
      return null;
    }

    const withoutFence = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      return JSON.parse(withoutFence);
    } catch {
      return null;
    }
  }

  normalizeExtractionPayload(payload) {
    const intent = this.sanitizeText(payload?.intent, 200);
    const interestLevel = this.sanitizeText(payload?.interest_level, 80).toLowerCase();
    const callbackValue = payload?.callback_requested;
    const callbackRequested = callbackValue === true
      || (typeof callbackValue === 'string' && ['true', 'yes'].includes(callbackValue.trim().toLowerCase()));
    const callbackTime = this.sanitizeText(payload?.callback_time, 200);
    const availability = normalizeAvailability(payload, callbackTime);

    const objections = Array.isArray(payload?.objections)
      ? payload.objections.map((item) => this.sanitizeText(item, 200)).filter(Boolean).slice(0, 10)
      : [];

    return {
      intent,
      interest_level: interestLevel,
      callback_requested: callbackRequested,
      callback_time: callbackTime,
      availability,
      objections,
      next_step: this.sanitizeText(payload?.next_step, 400),
      notes: this.sanitizeText(payload?.notes, 1000),
    };
  }

  buildExtractionPrompt(session) {
    const transcriptText = this.sanitizeText(session.transcriptText, 120000);
    const callAt = session.createdAt ? new Date(session.createdAt) : new Date();
    const callStamp = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(callAt);
    return [
      'You are an expert admissions-lead qualification analyst.',
      'Analyze the following call transcript and extract structured fields.',
      '',
      '## Your Goal',
      'Identify whether the contact is POSITIVE or CAN BE CONVINCED for guidance in any type of admissions (college, university, course, school, coaching, etc.).',
      'Be generous — even if they are merely exploring or casually asking about admissions, mark them as having some interest.',
      '',
      '## Handling Unclear User Speech',
      'Sometimes the user\'s transcript is garbled, empty, or unclear due to speech-to-text issues.',
      'When this happens, INFER the user\'s likely responses and intent from what the AI caller says.',
      'The AI caller\'s replies often reflect or paraphrase what the user just said, so use those as strong context clues.',
      '',
      '## Automated systems are never leads',
      'Voicemail, an answering machine, Apple Call Assistant, Google Call Screen, and IVR menus are not a person and not a doorkeeper.',
      'If the other side says any of these, interest_level MUST be "0" and callback_requested MUST be false:',
      '"record your name and reason for calling", "see if this person is available", "please stay on the line",',
      '"this person is not available", "leave a message", "leave an additional message", "after the tone",',
      '"your call has been forwarded to voicemail", "mailbox is full", "press 1", "screening this call".',
      'Do not treat those lines as engagement, curiosity, or a request for details.',
      'Only score interest above 0 if a real person speaks after the machine, in their own words, about the topic.',
      '',
      '## Output Format',
      'Return ONLY valid JSON with these exact keys (no extra keys, no markdown fencing):',
      '{ "intent", "interest_level", "callback_requested", "callback_time", "availability_precision", "availability_start", "availability_end", "objections", "next_step", "notes" }',
      '',
      '## Field Rules',
      '',
      '### intent (string)',
      'A concise summary of what the user wants. Focus on admissions-related intent.',
      'Examples: "Looking for MBA admissions guidance", "Interested in engineering college counseling", "Not interested at this time".',
      'If unclear but the AI caller was discussing admissions topics, note that (e.g., "Possibly interested — user speech unclear but AI discussed B.Tech admissions").',
      '',
      '### interest_level (string, "0" to "10")',
      'Rate on a 0-10 scale with these anchors:',
      '- 0: Unknown / no usable signal at all',
      '- 1-2: Clearly not interested, refused, or hostile',
      '- 3-4: Mildly dismissive but did not outright refuse; could potentially be re-engaged',
      '- 5-6: Neutral or ambiguous; showed some engagement, asked a question, or did not refuse',
      '- 7-8: Positive signals — asked for details, pricing, timing, or showed openness to admissions help',
      '- 9-10: Very interested — explicitly requested a callback, asked to enroll, or expressed urgency',
      'When user speech is unclear but they stayed on the call and the AI caller continued discussing admissions, lean toward 5-6 rather than 0.',
      '',
      '### callback_requested (boolean)',
      'true if the user explicitly or implicitly agreed to a follow-up call or asked to be called back.',
      '',
      '### callback_time (string)',
      'The words the person used for when they are free or want a callback. Empty string if they named no time.',
      'Examples: "2pm today", "15th", "next week", "after 6". Do not invent a clock time here.',
      '',
      '### availability_precision (string)',
      'How specific that phrase is. One of: "exact", "date_only", "window", "time_only", "unparsed".',
      '- exact: a real day and a clock time, such as 2pm on 15 Oct',
      '- date_only: a day or date with no hour',
      '- window: a span such as next week, next month, this evening, or Tuesday or Thursday',
      '- time_only: an hour with no day, such as "after 6"',
      '- unparsed: "later", "sometime", or nothing you can place on a calendar',
      'Do not pick the first hour of a week or the middle of a month and call it exact.',
      '',
      '### availability_start and availability_end (ISO 8601 strings, or empty)',
      `Resolve relative words from this call, which happened at ${callStamp}, timezone Asia/Kolkata.`,
      '- exact: start and end are that same moment',
      '- date_only: start is 00:00 and end is 23:59 on that day',
      '- window: start is the beginning of the span and end is the end. Next week is Monday 00:00 through Sunday 23:59. Next month is the 1st through the last day.',
      '- time_only: start is that hour on the call date, end is the same moment',
      '- unparsed: both empty',
      '',
      '### objections (array of strings)',
      'List each distinct objection or concern raised (e.g., "too expensive", "already enrolled elsewhere", "not the right time").',
      'Max 10 items. Empty array if none.',
      '',
      '### next_step (string)',
      'The recommended next action based on the conversation outcome.',
      'Examples: "Schedule follow-up call", "Send course brochure via WhatsApp", "No further action — not interested", "Re-engage in 2 weeks".',
      '',
      '### notes (string)',
      'Any additional context that would help a human counselor understand this lead.',
      'Include: specific courses/colleges mentioned, the user\'s current education level, location hints, and whether the call was mostly one-sided (AI talking, user silent/unclear).',
      'Flag if the user seems convinceable even if not explicitly interested.',
      '',
      '## Transcript',
      transcriptText,
    ].join('\n');
  }

  async runStructuredExtraction(session) {
    const { apiKey, model } = await this.resolveGeminiApiKeyAndModel(session);
    if (!apiKey) {
      return {
        ok: false,
        model,
        error: 'Missing Gemini API key for extraction',
      };
    }

    const endpoint = `${GEMINI_REST_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const prompt = this.buildExtractionPrompt(session);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        model,
        error: this.sanitizeText(
          responseBody?.error?.message || `Gemini extraction failed with status ${response.status}`,
          500
        ),
      };
    }

    const text = (responseBody?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text)
      .filter(Boolean)
      .join('\n')
      .trim();
    const parsed = this.parseExtractionResponseText(text);
    if (!parsed) {
      return {
        ok: false,
        model,
        error: 'Unable to parse Gemini extraction response as JSON',
      };
    }

    return {
      ok: true,
      model,
      data: this.normalizeExtractionPayload(parsed),
    };
  }

  async finalizeSessionFromBridge(summary = {}) {
    const callSessionId = this.sanitizeText(summary.callSessionId, 120);
    const callSid = this.sanitizeText(summary.callSid, 120);
    const session = await this.resolveSession({ callSessionId, callSid });
    if (!session) {
      return null;
    }

    // A prewarm socket can close while the phone is still ringing. That lifetime
    // is not talk time, and the greeting it produced is not an answer.
    if (this.sanitizeText(summary.reason, 200).toLowerCase().startsWith('prewarm')) {
      return session;
    }

    const now = new Date();
    const transcriptTurns = this.normalizeTranscriptTurns(summary.transcriptTurns);
    const transcriptText = this.buildTranscriptText(transcriptTurns);
    const durationMs = Number(summary.durationMs) || 0;
    const calculatedDurationSeconds = durationMs > 0 ? Math.round(durationMs / 1000) : 0;

    if (transcriptTurns.length > 0) {
      session.transcriptTurns = transcriptTurns;
      session.transcriptText = transcriptText;
    }

    if (summary.streamSid) {
      const sanitizedStreamId = this.sanitizeText(summary.streamSid, 120);
      session.providerStreamId = sanitizedStreamId;
      session.twilioStreamSid = sanitizedStreamId;
    }
    if (summary.providerCallId || callSid) {
      const sanitizedProviderCallId = this.sanitizeText(summary.providerCallId || callSid, 120);
      session.providerCallId = sanitizedProviderCallId;
      session.twilioCallSid = session.twilioCallSid || sanitizedProviderCallId;
    }
    if (summary.provider) {
      session.provider = this.sanitizeText(summary.provider, 30);
    }
    if (summary.model) {
      session.model = this.sanitizeText(summary.model, 120);
    }
    if (summary.reason) {
      session.endReason = this.sanitizeText(summary.reason, 200);
    }
    if (summary.toolEndReason) {
      session.toolEndReason = this.sanitizeText(summary.toolEndReason, 200);
    }
    if (summary.toolEndSummary) {
      session.toolEndSummary = this.sanitizeText(summary.toolEndSummary, 1000);
    }
    if (!session.summary && session.toolEndSummary) {
      session.summary = session.toolEndSummary;
    }

    if (summary.providerEvents && typeof summary.providerEvents === 'object') {
      session.providerEvents = summary.providerEvents;
      session.twilioEvents = summary.providerEvents;
    } else if (summary.twilioEvents && typeof summary.twilioEvents === 'object') {
      session.providerEvents = summary.twilioEvents;
      session.twilioEvents = summary.twilioEvents;
    }
    if (summary.tokenUsage && typeof summary.tokenUsage === 'object') {
      session.tokenUsage = summary.tokenUsage;
    }

    // Persist cost info. The system historically used USD fields; convert to INR and store INR-first.
    const usdToInrRate = Number.parseFloat(process.env.USD_TO_INR_RATE) ||
      (1 / Number.parseFloat(process.env.INR_TO_USD_RATE || '0.012'));

    if (summary.estimatedTokenCostUsd && typeof summary.estimatedTokenCostUsd === 'object') {
      session.estimatedTokenCostUsd = summary.estimatedTokenCostUsd; // keep legacy
      try {
        const usdObj = summary.estimatedTokenCostUsd;
        const tokenUsd = Number(usdObj.totalUsd || usdObj.totalUsdWithPlatform || 0) || 0;
        const inputUsd = Number(usdObj.inputUsd || 0) || 0;
        const outputUsd = Number(usdObj.outputUsd || 0) || 0;
        const platformUsd = Number(usdObj.vobizPlatformCostUsd || 0) || 0;

        const tokenCostInr = Number((tokenUsd * usdToInrRate).toFixed(6));
        const inputCostInr = Number((inputUsd * usdToInrRate).toFixed(6));
        const outputCostInr = Number((outputUsd * usdToInrRate).toFixed(6));
        const platformCostInr = Number((platformUsd * usdToInrRate).toFixed(6));
        const totalInr = Number((tokenCostInr + platformCostInr).toFixed(6));

        session.estimatedTokenCostInr = {
          inputInr: inputCostInr,
          outputInr: outputCostInr,
          tokenTotalInr: tokenCostInr,
          vobizPlatformCostInr: platformCostInr,
          totalInrWithPlatform: totalInr,
          minutesCharged: Number(usdObj.minutesCharged || 0) || 0,
          usdToInrRate,
        };

        // Backwards-compatible alias used across code: set `estimatedTokenCost` to INR object
        session.estimatedTokenCost = session.estimatedTokenCostInr;
      } catch (e) {
        // ignore conversion errors and keep USD object
      }
    }
    if (summary.bridgeMetrics && typeof summary.bridgeMetrics === 'object') {
      session.bridgeMetrics = {
        ...(session.bridgeMetrics || {}),
        ...summary.bridgeMetrics,
      };
    }

    // If bridge provided INR breakdown, persist it as primary bridge metrics cost fields
    if (summary.estimatedTokenCostInr && typeof summary.estimatedTokenCostInr === 'object') {
      session.bridgeMetrics = {
        ...(session.bridgeMetrics || {}),
        estimatedTokenCostInr: summary.estimatedTokenCostInr,
      };
    }
    session.bridgeMetrics = {
      ...(session.bridgeMetrics || {}),
      reason: this.sanitizeText(summary.reason, 200),
      durationMs,
      setupCompleteMs: Number(summary.setupCompleteMs) || 0,
      interruptions: Number(summary.interruptions) || 0,
      playbackQueueHighWaterMark:
        Number(summary.playbackQueueHighWaterMark ?? summary.queueHighWaterMark) || 0,
      playbackFramesDropped:
        Number(summary.playbackFramesDropped ?? summary.twilioFramesDropped) || 0,
      playbackFramesSent:
        Number(summary.playbackFramesSent ?? summary.twilioFramesSent) || 0,
      mediaPacketsIn:
        Number(summary.mediaPacketsIn ?? summary.twilioMediaPacketsIn) || 0,
      mediaBytesIn:
        Number(summary.mediaBytesIn ?? summary.twilioMediaBytesIn) || 0,
      modelMessagesIn:
        Number(summary.modelMessagesIn ?? summary.geminiMessagesIn) || 0,
      modelAudioPartsIn:
        Number(summary.modelAudioPartsIn ?? summary.geminiAudioPartsIn) || 0,
      modelAudioBytesIn:
        Number(summary.modelAudioBytesIn ?? summary.geminiAudioBytesIn) || 0,
      userAudioChunksSentToModel:
        Number(summary.userAudioChunksSentToModel ?? summary.geminiAudioChunksOut) || 0,
      userAudioBytesSentToModel:
        Number(summary.userAudioBytesSentToModel ?? summary.geminiAudioBytesOut) || 0,
      playbackEventsSent:
        Number(summary.playbackEventsSent ?? summary.playAudioSent) || 0,
      usageMetadataEvents: Number(summary.usageMetadataEvents) || 0,
      proactiveGreetingPrompts: Number(summary.proactiveGreetingPrompts) || 0,
      proactiveGreetingRetries: Number(summary.proactiveGreetingRetries) || 0,
      modelFarewellDetected: Boolean(summary.modelFarewellDetected),
      closedAt: summary.closedAt || new Date().toISOString(),
      closeMeta: summary.closeMeta || null,
    };

    session.endedAt = session.endedAt || now;
    session.completedAt = session.completedAt || now;

    if (!session.durationSeconds && calculatedDurationSeconds > 0) {
      session.durationSeconds = calculatedDurationSeconds;
    }

    // ─── Derive callOutcome (the accurate human-facing result) ───────────────
    // This runs regardless of whether status is already terminal so we always
    // fill callOutcome, even for AMD-detected voicemails set before this point.
    const toolReason = (session.toolEndReason || '').toLowerCase();
    const bridgeReason = (summary.reason || '').toLowerCase();

    let derivedOutcome = '';

    // 1. AI-detected automated systems (highest specificity)
    if (toolReason.includes('call_screening_detected')) {
      derivedOutcome = 'call_screening';
    } else if (toolReason.includes('ivr_detected')) {
      derivedOutcome = 'ivr';
    } else if (toolReason.includes('voicemail_detected') || toolReason.includes('automated_system_detected')) {
      derivedOutcome = 'voicemail';
    }
    // 2. AMD / hardware-level voicemail (set by Twilio AMD webhook before bridge closes)
    else if (session.status === 'voicemail' || bridgeReason.includes('answering_machine')) {
      derivedOutcome = 'voicemail';
    }
    // 3. Bridge-level silence / no-response watchdog fired
    else if (bridgeReason.includes('silence-timeout') || bridgeReason.includes('no-activity') || bridgeReason.includes('no-response')) {
      derivedOutcome = 'silence_timeout';
    }
    // 4. Hard-stop / max duration
    else if (bridgeReason.includes('max-duration') || bridgeReason.includes('hard-stop') || toolReason.includes('max_duration')) {
      derivedOutcome = 'max_duration';
    }
    // 5. Pre-connect outcomes from provider status
    else if (session.status === 'no_answer') {
      derivedOutcome = 'no_answer';
    } else if (session.status === 'busy') {
      derivedOutcome = 'busy';
    } else if (session.status === 'failed') {
      derivedOutcome = 'failed';
    } else if (session.status === 'canceled') {
      derivedOutcome = 'canceled';
    }
    // 7. Connected calls — was there meaningful interaction?
    else {
      const hasMedia =
        Number(summary.mediaPacketsIn ?? summary.twilioMediaPacketsIn ?? 0) > 0;
      const hasTranscript = transcriptTurns.length > 0;
      const hasModelAudio = Number(summary.modelAudioPartsIn ?? summary.geminiAudioPartsIn ?? 0) > 0;
      const hadRealInteraction = hasTranscript || hasModelAudio;
      const wasConnected = Boolean(session.connectedAt || session.answeredAt || hasMedia || durationMs > 0);

      if (!wasConnected) {
        derivedOutcome = 'failed';
      } else if (!hadRealInteraction) {
        // Connected (media packets flowed) but no transcript and no AI audio
        // This is the "silent drop" / unanswered-after-connect case
        derivedOutcome = 'silence_timeout';
      } else {
        // Real conversation happened — check if AI used the end_call tool (graceful)
        const agentCalledEndTool = Number(summary.endCallRequests ?? 0) > 0 || toolReason.length > 0;
        derivedOutcome = agentCalledEndTool ? 'agent_ended' : 'answered';
      }
    }

    // A Gemini 1008 or provider socket failure can happen after audio has already
    // flowed. That must not stay "answered". Voicemail, no-answer, and busy stay as they are.
    const humanResult = ['voicemail', 'call_screening', 'ivr', 'no_answer', 'busy', 'canceled', 'max_duration'];
    if (providerSystemFault(summary) && !humanResult.includes(derivedOutcome)) {
      derivedOutcome = 'system_error';
      session.endReason = this.sanitizeText(describeSystemFault(summary), 200);
    }

    // Always set callOutcome. A system fault replaces a green "answered" result.
    // Voicemail, no-answer, and busy already stored by the provider stay as they are.
    if (derivedOutcome === 'system_error' && !humanResult.includes(session.callOutcome || '')) {
      session.callOutcome = 'system_error';
    } else if (!session.callOutcome || session.callOutcome === '') {
      session.callOutcome = derivedOutcome;
    }

    // ─── Update legacy `status` for backwards compatibility ──────────────────
    // Stamp connectedAt if bridge signals the call was connected (preserve timestamp for analytics)
    const connectedBySummary =
      Number(summary.mediaPacketsIn ?? summary.twilioMediaPacketsIn ?? 0) > 0 ||
      transcriptTurns.length > 0 ||
      durationMs > 0;
    if (connectedBySummary && !session.connectedAt) {
      session.connectedAt = now;
    }

    if (!this.isTerminalSessionStatus(session.status)) {
      if (derivedOutcome === 'voicemail' || derivedOutcome === 'call_screening' || derivedOutcome === 'ivr') {
        session.status = 'voicemail';
        session.endReason = session.endReason || toolReason || bridgeReason;
      } else if (derivedOutcome === 'no_answer') {
        session.status = 'no_answer';
      } else if (derivedOutcome === 'busy') {
        session.status = 'busy';
      } else if (derivedOutcome === 'failed' || derivedOutcome === 'system_error') {
        session.status = 'failed';
      } else if (derivedOutcome === 'canceled') {
        session.status = 'canceled';
      } else {
        // answered / agent_ended / silence_timeout / max_duration all count as "completed" in status
        const wasConnectedAny = Boolean(session.connectedAt || session.answeredAt || connectedBySummary);
        session.status = wasConnectedAny ? 'completed' : 'failed';
      }
    } else if (!session.callOutcome) {
      // Status already terminal but callOutcome wasn't set (e.g., AMD webhook set status = 'voicemail')
      session.callOutcome = session.status === 'voicemail' ? 'voicemail'
        : session.status === 'no_answer' ? 'no_answer'
        : session.status === 'busy' ? 'busy'
        : session.status === 'failed' ? 'failed'
        : session.status === 'canceled' ? 'canceled'
        : '';
    }

    // A provider callback can mark the call completed as soon as audio flows.
    // A later Gemini/Vobiz failure should not stay green.
    if (
      derivedOutcome === 'system_error' &&
      !['voicemail', 'no_answer', 'busy', 'canceled'].includes(session.status)
    ) {
      session.status = 'failed';
    }

    session.unmarkModified('extractor');
    session.unmarkModified('extracted');
    session.unmarkModified('humanHandoff');
    await session.save();

    // Sync the final call outcome back to the Lead for UI display
    try {
      const lead = await Lead.findById(session.leadId);
      if (lead) {
        lead.outcome = session.callOutcome;
        
        // If the session was completed, ensure lead status is also completed
        if (session.status === 'completed' && lead.status !== 'completed') {
          lead.status = 'completed';
          lead.nextRetryAt = null;
        }
        
        await lead.save();
      }
    } catch (err) {
      console.error(`Failed to sync outcome to lead ${session.leadId}:`, err);
    }

    await this.pushToExtractionQueue(session, { priority: true });

    if (this.shouldClassifyAsAbrupt({ session, summary: session.summary || summary.toolEndSummary })) {
      const lead = await Lead.findById(session.leadId);
      const campaign = await Campaign.findById(session.campaignId).select('settings');
      if (lead && campaign && !session.retryDecisionApplied) {
        await this.scheduleRetrySession({
          session,
          lead,
          campaign,
          retryReason: 'abrupt_end',
          now,
          metadata: {
            classifier: 'abrupt-v1',
            durationSeconds: session.durationSeconds || 0,
            transcriptChars: this.sanitizeText(session.transcriptText, 100000).length,
          },
        });
      }
    }

    return session;
  }

  _sessionId(session) {
    return session?._id?.toString?.() || '';
  }

  _isQueued(sessionId) {
    const inLane = (queue) => queue.some((session) => this._sessionId(session) === sessionId);
    return inLane(this.priorityQueue) || inLane(this.backfillQueue);
  }

  _liveExtractionIdle() {
    return this.priorityQueue.length === 0 && this.activeExtractionWorkers === 0;
  }

  _removeFromBackfillQueue(sessionId) {
    this.backfillQueue = this.backfillQueue.filter((session) => this._sessionId(session) !== sessionId);
  }

  /**
   * Queue a session for extraction.
   *
   * Priority is the live path: a call that just finished in a running campaign.
   * Backfill is the historical path and is not started while priority work exists.
   * A session with no transcript is left untouched. Status callbacks arrive before
   * the transcript is saved, and marking those as already extracted skips the real run.
   */
  async pushToExtractionQueue(session, { priority = false } = {}) {
    if (!session || !session._id) return false;

    let transcriptText = this.sanitizeText(session.transcriptText, 100000).trim();
    if (!transcriptText && Array.isArray(session.transcriptTurns) && session.transcriptTurns.length > 0) {
      transcriptText = this.buildTranscriptText(session.transcriptTurns);
      session.transcriptText = transcriptText;
    }
    if (!transcriptText) {
      return false;
    }

    const sessionIdStr = this._sessionId(session);

    if (this.inProgressExtractions.has(sessionIdStr)) {
      console.log(`[ExtractionQueue] Session ${sessionIdStr} is already in-flight, skipping re-queue.`);
      return false;
    }

    if (priority) {
      if (this.priorityQueue.some((queued) => this._sessionId(queued) === sessionIdStr)) {
        console.log(`[ExtractionQueue] Session ${sessionIdStr} is already in the priority queue.`);
        return false;
      }
      this._removeFromBackfillQueue(sessionIdStr);
      this.priorityQueue.push(session);
      console.log(`[ExtractionQueue] Queued live session ${sessionIdStr}. Priority pending: ${this.priorityQueue.length}, Active: ${this.activeExtractionWorkers}/${this.maxConcurrentExtractions}`);
      this._spawnPriorityWorkers();
      return true;
    }

    if (this._isQueued(sessionIdStr)) {
      console.log(`[ExtractionQueue] Session ${sessionIdStr} is already queued, skipping duplicate.`);
      return false;
    }

    this.backfillQueue.push(session);
    console.log(`[ExtractionQueue] Queued backfill session ${sessionIdStr}. Backfill pending: ${this.backfillQueue.length}. Live idle: ${this._liveExtractionIdle()}`);
    this._scheduleBackfill({ delayMs: 0 });
    return true;
  }

  _spawnPriorityWorkers() {
    if (this.backfillTimer) {
      clearTimeout(this.backfillTimer);
      this.backfillTimer = null;
    }

    while (
      this.activeExtractionWorkers < this.maxConcurrentExtractions &&
      this.priorityQueue.length > 0
    ) {
      this.activeExtractionWorkers += 1;
      this._runPriorityWorker().catch((err) => {
        console.error('[ExtractionQueue] Unhandled priority worker crash:', err);
      }).finally(() => {
        this.activeExtractionWorkers -= 1;
        if (this.priorityQueue.length > 0) {
          this._spawnPriorityWorkers();
          return;
        }
        if (this._liveExtractionIdle()) {
          this._scheduleBackfill({ delayMs: 0 });
        }
      });
    }
  }

  async _runPriorityWorker() {
    while (this.priorityQueue.length > 0) {
      const session = this.priorityQueue.shift();
      if (!session || !session._id) continue;
      await this._extractQueuedSession(session, 'priority');
    }
  }

  _scheduleBackfill({ delayMs = 0 } = {}) {
    if (this.backfillTimer || this.backfillInFlight) return;
    if (!this._liveExtractionIdle()) return;
    if (this.backfillQueue.length === 0) return;

    this.backfillTimer = setTimeout(() => {
      this.backfillTimer = null;
      this._runBackfillOnce().catch((err) => {
        console.error('[ExtractionBackfill] Unhandled backfill error:', err);
      });
    }, delayMs);
  }

  async _runBackfillOnce() {
    if (this.backfillInFlight || !this._liveExtractionIdle()) return;
    const session = this.backfillQueue.shift();
    if (!session || !session._id) {
      this._scheduleBackfill({ delayMs: 0 });
      return;
    }

    this.backfillInFlight = true;
    try {
      await this._extractQueuedSession(session, 'backfill');
    } finally {
      this.backfillInFlight = false;
      if (this._liveExtractionIdle() && this.backfillQueue.length > 0) {
        console.log(`[ExtractionBackfill] Waiting ${BACKFILL_GAP_MS}ms before the next historical call. Pending: ${this.backfillQueue.length}`);
        this._scheduleBackfill({ delayMs: BACKFILL_GAP_MS });
      }
    }
  }

  async _extractQueuedSession(session, lane) {
    const sessionIdStr = this._sessionId(session);
    if (!sessionIdStr || this.inProgressExtractions.has(sessionIdStr)) {
      console.log(`[ExtractionQueue] Skipping ${sessionIdStr || 'unknown'} – already in-flight.`);
      return;
    }

    this.inProgressExtractions.add(sessionIdStr);
    try {
      console.log(`[ExtractionQueue] Processing ${lane} session ${sessionIdStr}. Priority pending: ${this.priorityQueue.length}, Backfill pending: ${this.backfillQueue.length}`);
      const result = await this.runExtractionIfEligible(session, { lane });
      if (result?.ok) {
        this.extractionAttempts.delete(sessionIdStr);
        console.log(`[ExtractionQueue] Extracted ${lane} session ${sessionIdStr}.`);
      } else if (result?.skipped) {
        console.log(`[ExtractionQueue] Skipped ${lane} session ${sessionIdStr}: ${result.reason}`);
      } else if (result?.retryable) {
        const attempts = (this.extractionAttempts.get(sessionIdStr) || 0) + 1;
        this.extractionAttempts.set(sessionIdStr, attempts);
        if (attempts < MAX_EXTRACTION_ATTEMPTS) {
          console.warn(`[ExtractionQueue] Retryable failure for ${sessionIdStr} (${attempts}/${MAX_EXTRACTION_ATTEMPTS}): ${result.error}`);
          setTimeout(() => {
            this.pushToExtractionQueue(session, { priority: lane === 'priority' }).catch((error) => {
              console.error(`[ExtractionQueue] Failed to requeue ${sessionIdStr}:`, error?.message);
            });
          }, BACKFILL_GAP_MS);
        } else {
          console.warn(`[ExtractionQueue] Giving up on ${sessionIdStr} after ${attempts} attempts: ${result.error}`);
          await CallSession.updateOne(
            { _id: session._id, 'extractor.ran': { $ne: true } },
            {
              $set: {
                'extractor.ran': true,
                'extractor.success': false,
                'extractor.error': this.sanitizeText(result.error, 500),
                'extractor.ranAt': new Date(),
                'extractor.claimedAt': null,
                'extractor.claimId': '',
              },
            }
          );
        }
      } else {
        console.warn(`[ExtractionQueue] Extraction failed for ${lane} session ${sessionIdStr}: ${result?.error || 'unknown'}`);
      }
    } catch (error) {
      console.error(`[ExtractionQueue] Worker error for session ${sessionIdStr}:`, error?.message);
    } finally {
      this.inProgressExtractions.delete(sessionIdStr);
    }
  }

  getExtractionQueueStatus() {
    return {
      backfillPending: this.backfillQueue.length,
      backfillRunning: this.backfillInFlight,
      priorityPending: this.priorityQueue.length,
      activeWorkers: this.activeExtractionWorkers,
      maxWorkers: this.maxConcurrentExtractions,
      liveIdle: this._liveExtractionIdle(),
    };
  }

  _queuedExtractionIds() {
    const ids = [];
    for (const session of this.priorityQueue) ids.push(this._sessionId(session));
    for (const session of this.backfillQueue) ids.push(this._sessionId(session));
    for (const id of this.inProgressExtractions) ids.push(String(id));
    return [...new Set(ids.filter(Boolean))];
  }

  _requireBackfillDate(value, endOfDay, label) {
    const parsed = this.parseFilterDate(value, endOfDay);
    if (!parsed) {
      throw new Error(`${label} must be a date like 2026-10-09`);
    }
    return parsed;
  }

  _backfillScope({ since, until, campaignId }) {
    if (!since) {
      throw new Error('A start date is required so older test calls are not processed');
    }
    const sinceDate = this._requireBackfillDate(since, false, 'Start date');
    const untilDate = until ? this._requireBackfillDate(until, true, 'End date') : null;
    if (untilDate && untilDate < sinceDate) {
      throw new Error('The end date is before the start date');
    }
    const createdAt = { $gte: sinceDate };
    if (untilDate) createdAt.$lte = untilDate;
    const query = {
      status: { $in: BACKFILL_TERMINAL_STATUSES },
      createdAt,
      'extractor.success': { $ne: true },
    };
    if (campaignId) {
      if (!mongoose.Types.ObjectId.isValid(String(campaignId))) {
        throw new Error('Campaign filter is not a valid id');
      }
      query.campaignId = new mongoose.Types.ObjectId(String(campaignId));
    }
    return { sinceDate, untilDate, query };
  }

  _eligibleBackfillQuery(scopeQuery) {
    return {
      ...scopeQuery,
      $and: [
        {
          $or: [
            { transcriptText: { $nin: [null, ''] } },
            { 'transcriptTurns.0': { $exists: true } },
          ],
        },
        {
          $or: [
            { status: { $in: ['completed', 'connected'] } },
            { connectedAt: { $type: 'date' } },
            { answeredAt: { $type: 'date' } },
          ],
        },
      ],
    };
  }

  _backfillBatchSize(limit) {
    if (limit === undefined || limit === null || limit === '' || String(limit).toLowerCase() === 'all') {
      return BACKFILL_BATCH_CAP;
    }
    const parsed = Number.parseInt(String(limit), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error('Batch size must be a positive number or "all"');
    }
    return Math.min(parsed, BACKFILL_BATCH_CAP);
  }

  /**
   * Real counts for manual post-call processing. This does not enqueue anything.
   * Eligible calls are finished calls in the date window that have a transcript
   * and have not been successfully extracted.
   */
  async previewExtractionBackfill({ since, until, campaignId } = {}) {
    const scope = this._backfillScope({ since, until, campaignId });
    const eligibleQuery = this._eligibleBackfillQuery(scope.query);
    const withTranscriptQuery = {
      ...scope.query,
      $or: [
        { transcriptText: { $nin: [null, ''] } },
        { 'transcriptTurns.0': { $exists: true } },
      ],
    };

    const [notProcessed, withTranscript, eligible, failedEarlier] = await Promise.all([
      CallSession.countDocuments(scope.query),
      CallSession.countDocuments(withTranscriptQuery),
      CallSession.countDocuments(eligibleQuery),
      CallSession.countDocuments({ ...eligibleQuery, 'extractor.ran': true }),
    ]);
    const noTranscript = Math.max(0, notProcessed - withTranscript);
    const notConnected = Math.max(0, withTranscript - eligible);

    const queuedIds = this._queuedExtractionIds();
    let alreadyQueued = 0;
    let alreadyInFlight = 0;
    if (queuedIds.length > 0 && eligible > 0) {
      const inFlightIds = [...this.inProgressExtractions];
      const waitingIds = queuedIds.filter((id) => !this.inProgressExtractions.has(id));
      const [inFlightCount, waitingCount] = await Promise.all([
        inFlightIds.length
          ? CallSession.countDocuments({ ...eligibleQuery, _id: { $in: inFlightIds } })
          : 0,
        waitingIds.length
          ? CallSession.countDocuments({ ...eligibleQuery, _id: { $in: waitingIds } })
          : 0,
      ]);
      alreadyInFlight = inFlightCount;
      alreadyQueued = waitingCount;
    }

    const sampleDocs = eligible === 0
      ? []
      : await CallSession.find(eligibleQuery)
        .select('createdAt durationSeconds status callOutcome campaignId leadId extractor.ran extractor.error')
        .populate('leadId', 'name phoneNumber phone')
        .populate('campaignId', 'name')
        .sort({ createdAt: -1 })
        .limit(BACKFILL_SAMPLE_LIMIT)
        .lean();

    const sample = sampleDocs.map((session) => ({
      id: String(session._id),
      leadName: session.leadId?.name || 'Unknown',
      phone: session.leadId?.phoneNumber || session.leadId?.phone || '',
      campaignName: session.campaignId?.name || 'Unknown campaign',
      createdAt: session.createdAt,
      durationSeconds: session.durationSeconds || 0,
      status: session.status || '',
      callOutcome: session.callOutcome || '',
      failedEarlier: session.extractor?.ran === true,
    }));

    const ready = Math.max(0, eligible - alreadyQueued - alreadyInFlight);
    return {
      since: scope.sinceDate.toISOString(),
      until: scope.untilDate ? scope.untilDate.toISOString() : null,
      notProcessed,
      eligible,
      noTranscript,
      notConnected,
      failedEarlier,
      alreadyQueued,
      alreadyInFlight,
      ready,
      batchCap: BACKFILL_BATCH_CAP,
      sample,
      sampleLimit: BACKFILL_SAMPLE_LIMIT,
      queue: this.getExtractionQueueStatus(),
    };
  }

  /**
   * Enqueue eligible historical calls on the backfill lane. Live extractions
   * keep the priority lane and are not delayed by this batch.
   */
  async backfillExtractions({ since, until, campaignId, limit = 500, dryRun = false } = {}) {
    const preview = await this.previewExtractionBackfill({ since, until, campaignId });
    const batchSize = this._backfillBatchSize(limit);
    const willEnqueue = Math.min(preview.ready, batchSize);

    if (dryRun) {
      return {
        ...preview,
        found: preview.notProcessed,
        unprocessedWithTranscript: preview.eligible,
        skippedNoTranscript: preview.noTranscript,
        enqueued: willEnqueue,
        remaining: Math.max(0, preview.ready - willEnqueue),
        batchSize,
        dryRun: true,
      };
    }

    if (willEnqueue === 0) {
      return {
        ...preview,
        found: preview.notProcessed,
        unprocessedWithTranscript: preview.eligible,
        skippedNoTranscript: preview.noTranscript,
        enqueued: 0,
        remaining: preview.ready,
        batchSize,
        dryRun: false,
      };
    }

    const eligibleQuery = this._eligibleBackfillQuery(
      this._backfillScope({ since, until, campaignId }).query
    );
    const skip = new Set(this._queuedExtractionIds());
    const cursor = CallSession.find(eligibleQuery)
      .select('_id')
      .sort({ createdAt: 1 })
      .lean()
      .cursor();

    let enqueued = 0;
    let scanned = 0;
    const scanCap = willEnqueue + skip.size + 50;
    try {
      for await (const row of cursor) {
        if (enqueued >= willEnqueue || scanned >= scanCap) break;
        scanned += 1;
        const id = String(row._id);
        if (skip.has(id)) continue;
        const pushed = await this.pushToExtractionQueue(
          { _id: row._id, transcriptText: '[backfill]' },
          { priority: false }
        );
        if (pushed) {
          skip.add(id);
          enqueued += 1;
        }
      }
    } finally {
      await cursor.close().catch(() => {});
    }

    console.log(`[ExtractionBackfill] Enqueued ${enqueued} historical session(s). They wait while live extractions are running, then run one at a time with a ${BACKFILL_GAP_MS}ms gap. Pending backfill: ${this.backfillQueue.length}.`);

    const queue = this.getExtractionQueueStatus();
    return {
      ...preview,
      found: preview.notProcessed,
      unprocessedWithTranscript: preview.eligible,
      skippedNoTranscript: preview.noTranscript,
      enqueued,
      remaining: Math.max(0, preview.ready - enqueued),
      batchSize,
      dryRun: false,
      queue,
    };
  }

  /**
   * Wait for a call session to reach a terminal status within a timeout.
   * Polls the session document until `isTerminalSessionStatus` returns true or timeout.
   */
  async waitForSessionTerminal(callSessionId, timeoutMs = 30000, pollIntervalMs = 1000) {
    if (!callSessionId) return null;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const session = await CallSession.findById(callSessionId);
      if (!session) return null;
      if (this.isTerminalSessionStatus(session.status)) {
        return session;
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    // Re-fetch one last time on timeout
    const finalSession = await CallSession.findById(callSessionId);
    if (finalSession && this.isTerminalSessionStatus(finalSession.status)) return finalSession;
    return null;
  }

  async recoverInterruptedExtractions() {
    const since = new Date(Date.now() - INTERRUPTED_EXTRACTION_LOOKBACK_MS);
    const staleBefore = new Date(Date.now() - EXTRACTION_CLAIM_MS);
    const sessions = await CallSession.find({
      status: 'completed',
      updatedAt: { $gte: since },
      $and: [
        {
          $or: [
            { transcriptText: { $regex: /\S/ } },
            { 'transcriptTurns.0': { $exists: true } },
          ],
        },
        {
          $or: [
            { 'extractor.ran': { $ne: true } },
            { 'extractor.error': PREMATURE_NO_TRANSCRIPT_ERROR },
            { 'extractor.claimedAt': { $lt: staleBefore } },
          ],
        },
      ],
    })
      .select('_id transcriptText transcriptTurns')
      .sort({ updatedAt: -1 })
      .limit(50);

    if (sessions.length === 0) {
      console.log('[ExtractionQueue] No interrupted live extractions in the last 15 minutes.');
      return;
    }

    console.log(`[ExtractionQueue] Requeueing ${sessions.length} interrupted live extraction(s).`);
    for (const session of sessions) {
      await this.pushToExtractionQueue(session, { priority: true });
    }
  }

  _isRetryableExtractionError(error) {
    const message = String(error || '').toLowerCase();
    return (
      message.includes('429') ||
      message.includes('rate') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('500') ||
      message.includes('504') ||
      message.includes('timeout') ||
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('econnreset') ||
      message.includes('socket')
    );
  }

  async _claimExtraction(sessionId) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - EXTRACTION_CLAIM_MS);
    const claimId = randomUUID();
    const claimed = await CallSession.findOneAndUpdate(
      {
        _id: sessionId,
        $and: [
          {
            // A finished extraction has success true. Everything else, including
            // an earlier failed attempt, can be claimed again by a manual batch.
            $or: [
              { 'extractor.success': { $ne: true } },
              { 'extractor.ran': { $ne: true } },
              { 'extractor.error': PREMATURE_NO_TRANSCRIPT_ERROR },
            ],
          },
          {
            $or: [
              { 'extractor.claimedAt': { $exists: false } },
              { 'extractor.claimedAt': null },
              { 'extractor.claimedAt': { $lt: staleBefore } },
            ],
          },
        ],
      },
      {
        $set: {
          'extractor.claimedAt': now,
          'extractor.claimId': claimId,
        },
      },
      { new: true }
    );

    if (!claimed) return null;
    return { session: claimed, claimId };
  }

  async _releaseExtractionClaim(sessionId, claimId, error = '') {
    await CallSession.updateOne(
      { _id: sessionId, 'extractor.claimId': claimId },
      {
        $set: {
          'extractor.ran': false,
          'extractor.success': false,
          'extractor.error': this.sanitizeText(error, 500),
          'extractor.claimedAt': null,
          'extractor.claimId': '',
        },
      }
    );
  }

  async _persistClaimedExtraction(sessionId, claimId, updateData) {
    const result = await CallSession.updateOne(
      { _id: sessionId, 'extractor.claimId': claimId },
      { $set: updateData }
    );
    return result.modifiedCount === 1;
  }
  detectAutomatedParty(session) {
    return detectAutomatedPartyFromTranscript({
      transcriptText: session?.transcriptText,
      callOutcome: session?.callOutcome,
      toolEndReason: session?.toolEndReason,
    });
  }

  machineExtractionPayload(kind) {
    const labels = {
      voicemail: 'Voicemail or answering machine. Not a person.',
      call_screening: 'Call screening or Apple/Google assistant. Not a person.',
      ivr: 'IVR or phone menu. Not a person.',
    };
    return {
      intent: labels[kind] || labels.voicemail,
      interest_level: '0',
      callback_requested: false,
      callback_time: '',
      availability: emptyAvailability(''),
      objections: [],
      next_step: 'No further action — automated system',
      notes: labels[kind] || labels.voicemail,
    };
  }

  async runExtractionIfEligible(session) {
    if (!session?._id) {
      return { ok: false, skipped: true, reason: 'missing-session' };
    }

    const claim = await this._claimExtraction(session._id);
    if (!claim) {
      return { ok: false, skipped: true, reason: 'already-claimed-or-done' };
    }

    const fresh = claim.session;
    const claimId = claim.claimId;

    if (!this.sanitizeText(fresh.transcriptText, 100000).trim() && Array.isArray(fresh.transcriptTurns) && fresh.transcriptTurns.length > 0) {
      fresh.transcriptText = this.buildTranscriptText(fresh.transcriptTurns);
    }

    if (!this.shouldRunExtraction(fresh)) {
      await this._releaseExtractionClaim(fresh._id, claimId);
      return { ok: false, skipped: true, reason: 'not-eligible' };
    }

    const machine = this.detectAutomatedParty(fresh);
    if (machine) {
      const extracted = this.machineExtractionPayload(machine);
      const updateData = {
        extractor: {
          ran: true,
          model: 'rules',
          success: true,
          error: '',
          ranAt: new Date(),
          claimedAt: null,
          claimId: '',
        },
        transcriptText: fresh.transcriptText || '',
        extracted,
        humanHandoff: {
          callbackRequested: false,
          callbackTime: '',
          nextStep: extracted.next_step,
          notes: extracted.notes,
        },
      };
      if (!['voicemail', 'call_screening', 'ivr'].includes(String(fresh.callOutcome || ''))) {
        updateData.callOutcome = machine;
        updateData.status = 'voicemail';
      }
      if (!fresh.toolEndReason) {
        updateData.toolEndReason = machine === 'call_screening'
          ? 'call_screening_detected'
          : machine === 'ivr'
            ? 'ivr_detected'
            : 'voicemail_detected';
      }
      const saved = await this._persistClaimedExtraction(fresh._id, claimId, updateData);
      if (!saved) return { ok: false, skipped: true, reason: 'claim-lost' };
      return { ok: true, skipped: false };
    }

    try {
      const extraction = await this.runStructuredExtraction(fresh);
      if (!extraction.ok && this._isRetryableExtractionError(extraction.error)) {
        await this._releaseExtractionClaim(fresh._id, claimId, extraction.error);
        return { ok: false, retryable: true, error: extraction.error };
      }

      const extractor = {
        ran: true,
        model: extraction.model || '',
        success: Boolean(extraction.ok),
        error: extraction.ok ? '' : this.sanitizeText(extraction.error, 500),
        ranAt: new Date(),
        claimedAt: null,
        claimId: '',
      };

      const updateData = {
        extractor,
        transcriptText: fresh.transcriptText || '',
      };

      if (extraction.ok && extraction.data) {
        updateData.extracted = extraction.data;
        updateData.humanHandoff = {
          callbackRequested: Boolean(extraction.data.callback_requested),
          callbackTime: extraction.data.callback_time || '',
          nextStep: extraction.data.next_step || '',
          notes: extraction.data.notes || '',
        };
        if (!fresh.summary && extraction.data.notes) {
          updateData.summary = this.sanitizeText(extraction.data.notes, 1000);
        }
      }

      const saved = await this._persistClaimedExtraction(fresh._id, claimId, updateData);
      if (!saved) {
        return { ok: false, skipped: true, reason: 'claim-lost' };
      }

      if (!extraction.ok) {
        console.warn(`[Extraction] Gemini extraction failed for session ${fresh._id}: ${extraction.error}`);
        return { ok: false, skipped: false, error: extractor.error };
      }
      return { ok: true, skipped: false };
    } catch (error) {
      const errorMsg = error?.message || 'Structured extraction failed';
      console.error(`[Extraction] Unexpected error for session ${fresh._id}:`, errorMsg);
      if (this._isRetryableExtractionError(errorMsg)) {
        await this._releaseExtractionClaim(fresh._id, claimId, errorMsg);
        return { ok: false, retryable: true, error: errorMsg };
      }

      const saved = await this._persistClaimedExtraction(fresh._id, claimId, {
        extractor: {
          ran: true,
          model: process.env.GEMINI_EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL,
          success: false,
          error: this.sanitizeText(errorMsg, 500),
          ranAt: new Date(),
          claimedAt: null,
          claimId: '',
        },
      });
      if (!saved) {
        return { ok: false, skipped: true, reason: 'claim-lost' };
      }
      return { ok: false, skipped: false, error: errorMsg };
    }
  }

  escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  parseFilterDate(value, endOfDay = false) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    const raw = this.sanitizeText(value, 40);
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  normalizeSessionSort(sortBy, sortDir) {
    const by = this.sanitizeText(sortBy, 40) || 'createdAt';
    const dir = String(sortDir || '').toLowerCase() === 'asc' ? 1 : -1;
    if (by === 'duration') {
      return { field: 'duration', spec: { durationSeconds: dir, createdAt: -1 } };
    }
    if (by === 'interest') {
      return { field: 'interest', spec: { interestScore: dir, createdAt: -1 }, dir };
    }
    if (by === 'availability') {
      return { field: 'availability', spec: { availabilityStart: dir, createdAt: -1 }, dir };
    }
    return { field: 'createdAt', spec: { createdAt: dir === 1 ? 1 : -1 } };
  }

  async buildSessionMatch({
    campaignId,
    campaignIds,
    createdBy,
    status,
    callOutcome,
    interestLevel,
    extraction,
    callbackRequested,
    availabilityOn,
    hasAvailability,
    dateFrom,
    dateTo,
    search,
    durationOp,
    durationSeconds,
    durationSecondsTo,
  } = {}) {
    const query = {};
    if (campaignId) {
      query.campaignId = campaignId;
    } else if (Array.isArray(campaignIds)) {
      query.campaignId = { $in: campaignIds };
    }
    if (createdBy) {
      query.createdBy = createdBy;
    }

    const normalizedStatus = this.sanitizeText(status, 80);
    const resultAliases = new Set(['no_answer', 'busy', 'voicemail', 'failed', 'canceled']);
    if (normalizedStatus === 'in_progress') {
      query.status = { $in: ['initiated', 'queued', 'ringing', 'connected', 'scheduled', 'in_progress'] };
    } else if (normalizedStatus === 'finished') {
      query.status = { $in: ['completed', 'no_answer', 'busy', 'voicemail', 'failed', 'canceled', 'exhausted'] };
    } else if (resultAliases.has(normalizedStatus)) {
      query.$and = [...(query.$and || []), this.effectiveOutcomeClause(normalizedStatus)];
    } else if (normalizedStatus) {
      query.status = normalizedStatus;
    }

    const outcomes = this.parseTokenList(callOutcome, 40);
    if (outcomes.length === 1) {
      query.$and = [...(query.$and || []), this.effectiveOutcomeClause(outcomes[0])];
    } else if (outcomes.length > 1) {
      query.$and = [...(query.$and || []), { $or: outcomes.map((outcome) => this.effectiveOutcomeClause(outcome)) }];
    }

    const extractionFilter = this.sanitizeText(extraction, 40).toLowerCase();
    if (extractionFilter === 'processed') {
      query['extractor.success'] = true;
    } else if (extractionFilter === 'unprocessed') {
      query['extractor.success'] = { $ne: true };
    }

    const levels = this.parseTokenList(interestLevel, 8);
    const interestValues = [];
    for (const level of levels) {
      interestValues.push(level);
      const asNumber = Number(level);
      if (Number.isFinite(asNumber) && String(asNumber) === level) interestValues.push(asNumber);
    }
    if (interestValues.length === 1) {
      query['extracted.interest_level'] = interestValues[0];
    } else if (interestValues.length > 1) {
      query['extracted.interest_level'] = { $in: interestValues };
    }

    const callbackFilter = this.sanitizeText(callbackRequested, 20).toLowerCase();
    if (callbackFilter === 'yes' || callbackFilter === 'true') {
      query['extracted.callback_requested'] = true;
    } else if (callbackFilter === 'no' || callbackFilter === 'false') {
      // Gemini has read the transcript and did not ask for a callback.
      // Unprocessed calls are excluded; they have no answer yet.
      query.$and = [
        ...(query.$and || []),
        { 'extractor.success': true, 'extracted.callback_requested': { $ne: true } },
      ];
    }

    const from = this.parseFilterDate(dateFrom, false);
    const to = this.parseFilterDate(dateTo, true);
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = from;
      if (to) query.createdAt.$lte = to;
    }

    const freeOn = this.parseFilterDate(availabilityOn, false);
    const freeOnEnd = this.parseFilterDate(availabilityOn, true);
    if (freeOn && freeOnEnd) {
      query.$and = [
        ...(query.$and || []),
        {
          'extracted.availability.startAt': { $ne: null, $lte: freeOnEnd },
          'extracted.availability.endAt': { $ne: null, $gte: freeOn },
        },
      ];
    }

    if (this.sanitizeText(hasAvailability, 20).toLowerCase() === 'yes') {
      query['extracted.availability.startAt'] = {
        ...(query['extracted.availability.startAt'] || {}),
        $exists: true,
        $ne: null,
      };
    }

    const durationBound = this.parseDurationBound(durationOp, durationSeconds, durationSecondsTo);
    if (durationBound?.op === 'between') {
      query.durationSeconds = { $gte: durationBound.min, $lte: durationBound.max };
    } else if (durationBound?.op === 'below') {
      query.durationSeconds = { $lte: durationBound.seconds };
    } else if (durationBound) {
      query.durationSeconds = { $gte: durationBound.seconds };
    }

    const searchTerm = this.sanitizeText(search, 120);
    if (searchTerm) {
      const safe = this.escapeRegex(searchTerm);
      const leadQuery = {
        $or: [
          { name: { $regex: safe, $options: 'i' } },
          { phoneNumber: { $regex: safe, $options: 'i' } },
          { phone: { $regex: safe, $options: 'i' } },
        ],
      };
      if (query.campaignId) leadQuery.campaignId = query.campaignId;
      const leadMatches = await Lead.find(leadQuery).select('_id').limit(2000);
      const leadIds = leadMatches.map((lead) => lead._id);
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            { leadId: { $in: leadIds } },
            { providerCallId: { $regex: safe, $options: 'i' } },
            { twilioCallSid: { $regex: safe, $options: 'i' } },
            { summary: { $regex: safe, $options: 'i' } },
            { 'extracted.intent': { $regex: safe, $options: 'i' } },
          ],
        },
      ];
    }

    return query;
  }

  parseTokenList(value, maxLength = 40) {
    const raw = Array.isArray(value) ? value : String(value || '').split(',');
    const seen = new Set();
    const tokens = [];
    for (const item of raw) {
      const token = this.sanitizeText(item, maxLength);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
    return tokens;
  }

  parseDurationBound(durationOp, durationSeconds, durationSecondsTo) {
    const parseSeconds = (value) => {
      if (value === '' || value === undefined || value === null) return null;
      const seconds = Number.parseInt(String(value), 10);
      if (!Number.isFinite(seconds) || seconds < 0) return null;
      return seconds;
    };
    const op = String(durationOp || 'above').toLowerCase();
    if (op === 'between') {
      const start = parseSeconds(durationSeconds);
      const end = parseSeconds(durationSecondsTo);
      if (start === null || end === null) return null;
      return { op: 'between', min: Math.min(start, end), max: Math.max(start, end) };
    }
    const seconds = parseSeconds(durationSeconds);
    if (seconds === null) return null;
    return { op: op === 'below' ? 'below' : 'above', seconds };
  }

  unresolvedOutcomeClause() {
    return {
      $or: [
        { callOutcome: { $exists: false } },
        { callOutcome: null },
        { callOutcome: '' },
      ],
    };
  }

  // Matches the badge on screen, including older calls whose result lives on
  // status or is implied by a completed call with no duration.
  effectiveOutcomeClause(outcome) {
    const unresolved = this.unresolvedOutcomeClause();
    const withUnresolved = (extra) => ({ $and: [unresolved, extra] });
    const zeroDuration = {
      $or: [
        { durationSeconds: { $lte: 0 } },
        { durationSeconds: null },
        { durationSeconds: { $exists: false } },
      ],
    };

    if (outcome === 'no_answer') {
      return {
        $or: [
          { callOutcome: 'no_answer' },
          withUnresolved({ status: 'no_answer' }),
          withUnresolved({ status: { $in: ['completed', 'connected'] }, ...zeroDuration }),
        ],
      };
    }
    if (outcome === 'answered') {
      return {
        $or: [
          { callOutcome: 'answered' },
          withUnresolved({ status: { $in: ['completed', 'connected'] }, durationSeconds: { $gt: 0 } }),
        ],
      };
    }
    if (outcome === 'voicemail') {
      return {
        $or: [
          { callOutcome: 'voicemail' },
          withUnresolved({ status: 'voicemail' }),
          withUnresolved({ toolEndReason: { $regex: 'voicemail_detected|automated_system_detected', $options: 'i' } }),
        ],
      };
    }
    if (outcome === 'busy') {
      return { $or: [{ callOutcome: 'busy' }, withUnresolved({ status: 'busy' })] };
    }
    if (outcome === 'failed') {
      return { $or: [{ callOutcome: 'failed' }, withUnresolved({ status: 'failed' })] };
    }
    if (outcome === 'canceled') {
      return { $or: [{ callOutcome: 'canceled' }, withUnresolved({ status: 'canceled' })] };
    }
    if (outcome === 'call_screening') {
      return {
        $or: [
          { callOutcome: 'call_screening' },
          withUnresolved({ toolEndReason: { $regex: 'call_screening_detected', $options: 'i' } }),
        ],
      };
    }
    if (outcome === 'ivr') {
      return {
        $or: [
          { callOutcome: 'ivr' },
          withUnresolved({ toolEndReason: { $regex: 'ivr_detected', $options: 'i' } }),
        ],
      };
    }
    return { callOutcome: outcome };
  }

  async pageSessions(query, { sortBy, sortDir, skip = 0, limit = 25, populateLead = true } = {}) {
    const sort = this.normalizeSessionSort(sortBy, sortDir);
    const populate = (finder) => {
      if (!populateLead) return finder;
      return finder
        .populate('leadId', 'name phoneNumber phone email')
        .populate('callerId', 'name')
        .populate('campaignId', 'name');
    };

    if (sort.field !== 'interest' && sort.field !== 'availability') {
      return populate(
        CallSession.find(query).sort(sort.spec).skip(skip).limit(limit)
      );
    }

    const missingAvailability = sort.dir === 1 ? new Date('9999-12-31T00:00:00.000Z') : new Date(0);
    const now = new Date();
    const rows = await CallSession.aggregate([
      { $match: query },
      {
        $addFields: {
          interestScore: {
            $convert: { input: '$extracted.interest_level', to: 'int', onError: -1, onNull: -1 },
          },
          availabilityStart: {
            $cond: [
              {
                $and: [
                  { $ne: ['$extracted.availability.startAt', null] },
                  { $gte: [{ $ifNull: ['$extracted.availability.endAt', '$extracted.availability.startAt'] }, now] },
                ],
              },
              '$extracted.availability.startAt',
              missingAvailability,
            ],
          },
        },
      },
      { $sort: sort.spec },
      { $skip: skip },
      { $limit: limit },
      { $project: { _id: 1 } },
    ]);
    const ids = rows.map((row) => row._id);
    if (ids.length === 0) return [];
    const docs = await populate(CallSession.find({ _id: { $in: ids } }));
    const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
    return ids.map((id) => byId.get(String(id))).filter(Boolean);
  }

  escapeCsvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  async writeSessionsCsv(res, { query, sortBy, sortDir }) {
    const sort = this.normalizeSessionSort(sortBy, sortDir);
    const header = [
      'Lead Name',
      'Phone Number',
      'Campaign',
      'Call Date',
      'Status',
      'Call Outcome',
      'Duration (sec)',
      'Interest',
      'Post-call processed',
      'Intent',
      'Callback requested',
      'Availability',
      'Availability start',
      'Availability end',
      'Objections',
      'Notes',
      'Summary',
      'Transcript',
    ];
    res.write(`${header.map((cell) => this.escapeCsvCell(cell)).join(',')}\n`);

    // Sort only the fields needed to order the file. Loading every transcript
    // into one sort is what made a few-thousand-row export fail after the header.
    const idCursor = CallSession.aggregate([
      { $match: query },
      {
        $project: {
          createdAt: 1,
          durationSeconds: 1,
          interestScore: {
            $convert: { input: '$extracted.interest_level', to: 'int', onError: -1, onNull: -1 },
          },
          availabilityStart: {
            $cond: [
              {
                $and: [
                  { $ne: ['$extracted.availability.startAt', null] },
                  {
                    $gte: [
                      { $ifNull: ['$extracted.availability.endAt', '$extracted.availability.startAt'] },
                      new Date(),
                    ],
                  },
                ],
              },
              '$extracted.availability.startAt',
              sort.dir === 1 ? new Date('9999-12-31T00:00:00.000Z') : new Date(0),
            ],
          },
        },
      },
      { $sort: sort.spec },
      { $project: { _id: 1 } },
    ]).allowDiskUse(true).cursor({ batchSize: 200 });

    const writeBatch = async (ids) => {
      if (ids.length === 0) return;
      const docs = await CallSession.find({ _id: { $in: ids } })
        .select('leadId campaignId createdAt status callOutcome durationSeconds extracted extractor summary transcriptText')
        .populate('leadId', 'name phoneNumber phone')
        .populate('campaignId', 'name')
        .lean();
      const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
      for (const id of ids) {
        const session = byId.get(String(id));
        if (!session) continue;
        const lead = session.leadId || {};
        const campaign = session.campaignId || {};
        const objections = Array.isArray(session.extracted?.objections)
          ? session.extracted.objections.join('; ')
          : '';
        const processed = session.extractor?.success === true ? 'yes' : 'no';
        const row = [
          lead.name || '',
          lead.phoneNumber || lead.phone || '',
          campaign.name || '',
          session.createdAt ? new Date(session.createdAt).toISOString() : '',
          session.status || '',
          session.callOutcome || '',
          session.durationSeconds ?? 0,
          session.extracted?.interest_level ?? '',
          processed,
          session.extracted?.intent || '',
          session.extracted?.callback_requested === true ? 'yes' : 'no',
          formatAvailabilityLabel(session.extracted?.availability) || session.extracted?.callback_time || '',
          session.extracted?.availability?.startAt ? new Date(session.extracted.availability.startAt).toISOString() : '',
          session.extracted?.availability?.endAt ? new Date(session.extracted.availability.endAt).toISOString() : '',
          objections,
          session.extracted?.notes || '',
          session.summary || '',
          session.transcriptText || '',
        ];
        res.write(`${row.map((cell) => this.escapeCsvCell(cell)).join(',')}\n`);
      }
    };

    let batch = [];
    for await (const row of idCursor) {
      batch.push(row._id);
      if (batch.length >= 100) {
        const ids = batch;
        batch = [];
        await writeBatch(ids);
      }
    }
    await writeBatch(batch);
  }
  async listCampaignSessions({
    campaignId,
    ownerUserId,
    status = '',
    callOutcome = '',
    interestLevel = '',
    extraction = '',
    callbackRequested = '',
    availabilityOn = '',
    hasAvailability = '',
    search = '',
    sortBy = 'createdAt',
    sortDir = 'desc',
    dateFrom = '',
    dateTo = '',
    durationOp = 'above',
    durationSeconds = '',
    durationSecondsTo = '',
    limit = 25,
    offset = 0,
  }) {
    const resolvedLimit = Math.min(this.parsePositiveInt(limit, 25), 100);
    const resolvedOffset = Math.max(this.parsePositiveInt(offset, 0) || 0, 0);
    const query = await this.buildSessionMatch({
      campaignId,
      createdBy: ownerUserId,
      status,
      callOutcome,
      interestLevel,
      extraction,
      callbackRequested,
      availabilityOn,
      hasAvailability,
      search,
      dateFrom,
      dateTo,
      durationOp,
      durationSeconds,
      durationSecondsTo,
    });

    const [sessions, total] = await Promise.all([
      this.pageSessions(query, {
        sortBy,
        sortDir,
        skip: resolvedOffset,
        limit: resolvedLimit,
      }),
      CallSession.countDocuments(query),
    ]);

    return {
      sessions,
      pagination: {
        total,
        limit: resolvedLimit,
        offset: resolvedOffset,
        hasMore: total > resolvedOffset + resolvedLimit,
      },
    };
  }

  async getCampaignSessionDetail({ campaignId, ownerUserId, sessionId }) {
    const session = await CallSession.findOne({
      _id: sessionId,
      campaignId,
      createdBy: ownerUserId,
    })
      .populate('campaignId', 'name')
      .populate('leadId', 'name phoneNumber phone email customFields')
      .populate('callerId', 'name description')
      .populate('parentSessionId', 'status callOutcome attemptIndex scheduledFor providerCallId twilioCallSid createdAt');

    if (!session) {
      return null;
    }

    const childSessions = await CallSession.find({
      parentSessionId: session._id,
      createdBy: ownerUserId,
    })
      .select('status callOutcome attemptIndex scheduledFor retryReason retryStep providerCallId twilioCallSid createdAt')
      .sort({ createdAt: 1 });

    return {
      ...session.toObject(),
      childSessions,
    };
  }
}

const callSessionService = new CallSessionService();
export default callSessionService;
