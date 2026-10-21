import mongoose from 'mongoose';
import { NODE_TYPES } from '../config/constants.js';
import { DEFAULT_VOICE_PIPELINE, VOICE_PIPELINES } from '../config/voicePipelines.js';

const qaEntrySchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true
  },
  answer: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const scriptNodeSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: Object.values(NODE_TYPES),
    required: true
  },
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 }
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { _id: false });

const scriptEdgeSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  source: {
    type: String,
    required: true
  },
  target: {
    type: String,
    required: true
  },
  sourceHandle: String,
  targetHandle: String,
  label: String
}, { _id: false });

const aiCallerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'AI Caller name is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  callingMechanism: {
    type: String,
    enum: ['s2s'],
    default: 's2s'
  },
  s2sConfig: {
    pipeline: {
      type: String,
      enum: Object.values(VOICE_PIPELINES),
      default: DEFAULT_VOICE_PIPELINE,
    },
    provider: {
      type: String,
      default: 'gemini_live'
    },
    integrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Integration',
      required: false
    },
    model: {
      type: String,
      default: 'gemini-3.1-flash-live-preview'
    },
    voice: {
      type: String,
      default: 'Kore'
    },
    language: {
      type: String,
      default: 'en-US'
    },
    promptRegion: {
      type: String,
      enum: ['north', 'south'],
      default: 'north'
    },
    systemPrompt: {
      type: String,
      default: 'You are a helpful AI assistant making phone calls.'
    },
    temperature: {
      type: Number,
      default: 0.8,
      min: 0,
      max: 2
    },
    thinkingLevel: {
      type: String,
      enum: ['minimal', 'low', 'medium', 'high'],
      default: 'minimal'
    },
    sttIntegrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Integration',
      default: null,
    },
    llmIntegrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Integration',
      default: null,
    },
    ttsIntegrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Integration',
      default: null,
    },
    sttModel: { type: String, default: 'nova-3' },
    sttLanguage: { type: String, default: 'en-US' },
    sttEncoding: { type: String, default: 'linear16' },
    sttSampleRate: { type: Number, default: 16000 },
    sttChannels: { type: Number, default: 1 },
    sttEndpointingMs: { type: Number, default: 800, min: 0 },
    sttUtteranceEndMs: { type: Number, default: 1000, min: 0 },
    llmModel: { type: String, default: '' },
    ttsModel: { type: String, default: '' },
    ttsVoice: { type: String, default: '' },
    ttsOutputFormat: { type: String, default: 'pcm_16000' },
    ttsTelephonyFormat: { type: String, default: 'mulaw_8000' }
  },
  telephonyConfig: {
    integrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Integration',
      required: false
    },
    callerId: {
      type: String,
      default: ''
    }
  },
  guardrails: {
    maxCallDuration: {
      type: Number,
      default: 600
    },
    silenceTimeout: {
      type: Number,
      default: 10
    },
    profanityFilter: {
      type: Boolean,
      default: true
    }
  },
  knowledgeBaseIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgeBase'
  }],
  qaEntries: [qaEntrySchema],
  scriptFlow: {
    nodes: {
      type: [scriptNodeSchema],
      default: []
    },
    edges: {
      type: [scriptEdgeSchema],
      default: []
    }
  },
  settings: {
    restrictToKnowledge: {
      type: Boolean,
      default: false
    },
    guardrails: {
      avoidTopics: {
        type: [String],
        default: []
      },
      maxResponseLength: {
        type: Number,
        default: 200
      }
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
aiCallerSchema.index({ createdBy: 1, createdAt: -1 });
aiCallerSchema.index({ isActive: 1 });

const AICaller = mongoose.model('AICaller', aiCallerSchema);

export default AICaller;
