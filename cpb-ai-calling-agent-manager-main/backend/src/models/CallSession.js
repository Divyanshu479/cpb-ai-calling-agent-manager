import mongoose from 'mongoose';

const transcriptTurnSchema = new mongoose.Schema(
  {
    speaker: {
      type: String,
      enum: ['user', 'ai', 'system', 'tool'],
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const extractedSchema = new mongoose.Schema(
  {
    intent: { type: String, default: '' },
    interest_level: { type: String, default: '' },
    callback_requested: { type: Boolean, default: false },
    callback_time: { type: String, default: '' },
    availability: {
      phrase: { type: String, default: '' },
      precision: {
        type: String,
        enum: ['', 'exact', 'date_only', 'window', 'time_only', 'unparsed'],
        default: '',
      },
      startAt: { type: Date, default: null },
      endAt: { type: Date, default: null },
      timezone: { type: String, default: 'Asia/Kolkata' },
    },
    objections: { type: [String], default: [] },
    next_step: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const extractorMetadataSchema = new mongoose.Schema(
  {
    ran: { type: Boolean, default: false },
    model: { type: String, default: '' },
    success: { type: Boolean, default: false },
    error: { type: String, default: '' },
    ranAt: { type: Date },
    claimedAt: { type: Date, default: null },
    claimId: { type: String, default: '' },
  },
  { _id: false }
);

const humanHandoffSchema = new mongoose.Schema(
  {
    callbackRequested: { type: Boolean, default: false },
    callbackTime: { type: String, default: '' },
    nextStep: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const callSessionSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
      index: true,
    },
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AICaller',
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    integrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Integration',
      default: null,
    },
    provider: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    providerCallId: {
      type: String,
      trim: true,
      index: true,
    },
    providerStreamId: {
      type: String,
      trim: true,
      default: '',
    },
    providerEvents: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Legacy fields retained for backward compatibility with older Twilio flows.
    twilioCallSid: {
      type: String,
      trim: true,
      index: true,
    },
    twilioStreamSid: {
      type: String,
      trim: true,
      default: '',
    },
    attemptIndex: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    parentSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CallSession',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: [
        'initiated',
        'queued',
        'ringing',
        'in_progress',
        'connected',
        'completed',
        'no_answer',
        'busy',
        'voicemail',
        'failed',
        'canceled',
        'scheduled',
        'exhausted',
      ],
      default: 'initiated',
      index: true,
    },
    // callOutcome tracks the actual result of the call (separate from system lifecycle status).
    // Set by finalizeSessionFromBridge and the Twilio AMD webhook.
    callOutcome: {
      type: String,
      enum: [
        '',              // not yet determined
        'answered',      // human answered and had a real conversation
        'voicemail',     // went to voicemail (AMD or AI-detected)
        'call_screening',// Apple/Google call screener intercepted
        'ivr',           // hit an IVR / phone menu system
        'no_answer',     // rang but nobody picked up
        'busy',          // line was busy
        'failed',        // call failed to connect
        'canceled',      // call was canceled before connecting
        'silence_timeout', // connected but no audio — likely unanswered or dropped
        'max_duration',  // hit max call duration limit
        'agent_ended',   // AI agent naturally ended a real conversation
        'system_error',  // bridge/system error during call
      ],
      default: '',
      index: true,
    },
    initiatedAt: { type: Date, default: Date.now },
    ringingAt: { type: Date, default: null },
    answeredAt: { type: Date, default: null },
    connectedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0, min: 0 },
    scheduledFor: { type: Date, default: null, index: true },
    retryReason: {
      type: String,
      enum: ['', 'no_answer', 'busy', 'failed', 'canceled', 'abrupt_end'],
      default: '',
    },
    retryStep: { type: Number, default: 0, min: 0 },
    retryDecisionApplied: { type: Boolean, default: false },
    summary: { type: String, default: '' },
    endReason: { type: String, default: '' },
    toolEndReason: { type: String, default: '' },
    toolEndSummary: { type: String, default: '' },
    model: { type: String, default: '' },
    transcriptTurns: {
      type: [transcriptTurnSchema],
      default: [],
    },
    transcriptText: { type: String, default: '' },
    extracted: {
      type: extractedSchema,
      default: () => ({}),
    },
    extractor: {
      type: extractorMetadataSchema,
      default: () => ({}),
    },
    humanHandoff: {
      type: humanHandoffSchema,
      default: () => ({}),
    },
    tokenUsage: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    estimatedTokenCostUsd: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    estimatedTokenCostInr: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    estimatedTokenCost: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    bridgeMetrics: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    twilioEvents: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

callSessionSchema.index({ createdBy: 1, campaignId: 1, createdAt: -1 });
callSessionSchema.index({ campaignId: 1, status: 1, createdAt: -1 });
callSessionSchema.index({ campaignId: 1, callOutcome: 1, createdAt: -1 });
callSessionSchema.index({ leadId: 1, createdAt: -1 });
callSessionSchema.index({ 'extracted.availability.startAt': 1, 'extracted.availability.endAt': 1 });

const CallSession = mongoose.model('CallSession', callSessionSchema);

export default CallSession;
