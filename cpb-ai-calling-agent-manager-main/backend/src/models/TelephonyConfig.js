import mongoose from 'mongoose';

const statusMappingSchema = new mongoose.Schema({
  providerStatus: {
    type: String,
    required: true
  },
  internalStatus: {
    type: String,
    enum: ['connected', 'no_answer', 'busy', 'voicemail', 'failed'],
    required: true
  }
}, { _id: false });

const telephonyConfigSchema = new mongoose.Schema({
  provider: {
    type: String,
    required: true,
    trim: true,
    enum: ['twilio', 'plivo', 'exotel', 'vobiz', 'custom']
  },
  isCustom: {
    type: Boolean,
    default: false
  },
  apiBaseUrl: {
    type: String,
    
  },
  apiKey: {
    type: String,
    
  },
  apiSecret: {
    type: String,
    
  },
  credentials: {
    accountSid: { type: String },
    authToken: { type: String },
    authId: { type: String },
    streamWsUrl: { type: String },
    apiBaseUrl: { type: String },
    apiKey: { type: String },
    apiToken: { type: String },
    sid: { type: String }
  },
  callerIds: {
    type: [String],
    default: []
  },
  callerId: {
    type: String,
    
  },
  webhookUrl: {
    type: String
  },
  statusMapping: {
    type: [statusMappingSchema],
    default: []
  },
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    recordCalls: {
      type: Boolean,
      default: true
    },
    recordingFormat: {
      type: String,
      enum: ['mp3', 'wav'],
      default: 'mp3'
    },
    maxCallDuration: {
      type: Number, // in seconds
      default: 600
    }
  }
}, {
  timestamps: true
});

// Only allow one active config
telephonyConfigSchema.index({ isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

const TelephonyConfig = mongoose.model('TelephonyConfig', telephonyConfigSchema);

export default TelephonyConfig;
