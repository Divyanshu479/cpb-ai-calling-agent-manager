import mongoose from 'mongoose';

const integrationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Integration name is required'],
    trim: true
  },
  type: {
    type: String,
    enum: ['s2s', 'telephony', 'stt', 'llm', 'tts'],
    required: [true, 'Integration type is required']
  },
  description: {
    type: String,
    trim: true
  },

  // Connection
  baseUrl: {
    type: String,
    required: [true, 'Base URL is required'],
    trim: true
  },

  // Authentication
  authType: {
    type: String,
    enum: ['none', 'bearer_token', 'api_key_header', 'basic_auth', 'custom_header'],
    default: 'bearer_token'
  },
  authConfig: {
    token: { type: String },
    headerName: { type: String },
    headerValue: { type: String },
    username: { type: String },
    password: { type: String }
  },

  // Request Configuration
  requestMethod: {
    type: String,
    enum: ['GET', 'POST', 'PUT', 'PATCH'],
    default: 'POST'
  },
  requestHeaders: {
    type: Map,
    of: String
  },
  requestBodyTemplate: {
    type: String
  }, // Handlebars template for request body
  contentType: {
    type: String,
    enum: ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded'],
    default: 'application/json'
  },

  // Response Configuration
  responseType: {
    type: String,
    enum: ['json', 'binary', 'text', 'stream'],
    default: 'json'
  },
  responseMapping: {
    resultPath: { type: String },      // JSONPath to extract main result
    errorPath: { type: String },       // JSONPath to extract error message
    usagePath: { type: String }        // JSONPath for usage/token info
  },

  // Provider-specific options (shown in AI Caller builder)
  availableModels: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String }
  }],
  availableVoices: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    language: { type: String },
    gender: { type: String }
  }],
  availableLanguages: [{
    code: { type: String, required: true },
    name: { type: String, required: true }
  }],

  // Additional settings
  timeout: {
    type: Number,
    default: 30000,
    min: 1000,
    max: 300000
  },
  retryAttempts: {
    type: Number,
    default: 3,
    min: 0,
    max: 10
  },

  isActive: {
    type: Boolean,
    default: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  lastTested: Date,
  testStatus: {
    type: String,
    enum: ['pending', 'success', 'failed']
  },
  testMessage: String,

  // Flexible provider metadata (template id, model hints, etc.)
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  }

}, {
  timestamps: true,
  toJSON: { flattenMaps: true },
  toObject: { flattenMaps: true }
});

// Indexes
integrationSchema.index({ type: 1, isActive: 1 });
integrationSchema.index({ createdBy: 1 });

// Pre-save hook to ensure only one default per type
integrationSchema.pre('save', async function() {
  if (this.isDefault && this.isModified('isDefault')) {
    await this.constructor.updateMany(
      {
        _id: { $ne: this._id },
        type: this.type,
        isDefault: true
      },
      { isDefault: false }
    );
  }
});

// Method to hide sensitive auth data
integrationSchema.methods.toSafeObject = function() {
  const obj = this.toObject({ flattenMaps: true });
  
  // Extra safety fallback to convert Maps to plain objects
  if (obj.metadata instanceof Map) {
    obj.metadata = Object.fromEntries(obj.metadata);
  }
  if (obj.requestHeaders instanceof Map) {
    obj.requestHeaders = Object.fromEntries(obj.requestHeaders);
  }
  if (obj.metadata && typeof obj.metadata === 'object') {
    for (const key of Object.keys(obj.metadata)) {
      if (/key|token|secret|password|credential|authorization/i.test(key)) {
        obj.metadata[key] = '***';
      }
    }
  }
  
  if (obj.authConfig) {
    if (obj.authConfig.token) obj.authConfig.token = '***';
    if (obj.authConfig.password) obj.authConfig.password = '***';
    if (obj.authConfig.headerValue) obj.authConfig.headerValue = '***';
  }
  return obj;
};

const Integration = mongoose.model('Integration', integrationSchema);

export default Integration;
