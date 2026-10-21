import mongoose from 'mongoose';
import { CALL_STATUSES, CALL_OUTCOMES } from '../config/constants.js';

const leadSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Lead name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  phoneNumber: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  customFields: {
    type: Map,
    of: String,
    default: {}
  },
  status: {
    type: String,
    enum: Object.values(CALL_STATUSES),
    default: CALL_STATUSES.PENDING,
    index: true
  },
  outcome: {
    type: String,
    default: null
  },
  retryCount: {
    type: Number,
    default: 0
  },
  nextRetryAt: {
    type: Date,
    index: true
  },
  lastCalledAt: {
    type: Date
  },
  notes: {
    type: String,
    trim: true
  },
  tags: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: true
});

// Compound indexes for efficient querying
leadSchema.index({ campaignId: 1, status: 1 });
leadSchema.index({ campaignId: 1, nextRetryAt: 1 });
leadSchema.index({ phone: 1, campaignId: 1 });

// Method to check if lead is ready for call
leadSchema.methods.isReadyForCall = function() {
  if (this.status === CALL_STATUSES.COMPLETED ||
      this.status === CALL_STATUSES.EXHAUSTED ||
      this.status === CALL_STATUSES.CALLING) {
    return false;
  }

  if (this.nextRetryAt && this.nextRetryAt > new Date()) {
    return false;
  }

  return true;
};

// Method to schedule retry
leadSchema.methods.scheduleRetry = async function(retryGapMinutes, maxRetries) {
  if (this.retryCount >= maxRetries) {
    this.status = CALL_STATUSES.EXHAUSTED;
    this.nextRetryAt = null;
  } else {
    this.status = CALL_STATUSES.NO_ANSWER;
    this.nextRetryAt = new Date(Date.now() + retryGapMinutes * 60 * 1000);
    this.retryCount += 1;
  }

  return await this.save();
};

// Method to mark as completed
leadSchema.methods.markCompleted = async function(outcome) {
  this.status = CALL_STATUSES.COMPLETED;
  this.outcome = outcome;
  this.nextRetryAt = null;

  return await this.save();
};

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;
