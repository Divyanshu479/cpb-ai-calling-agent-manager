import mongoose from 'mongoose';
import {
  DIAL_QUEUE_JOB_STATUSES,
  FAILURE_CATEGORIES,
  DIAL_QUEUE_LEASE_TIMEOUT_MS,
} from '../config/constants.js';

const dialQueueJobSchema = new mongoose.Schema(
  {
    // Primary identifiers
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
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CallSession',
      default: null, // Set when job starts execution
    },
    
    // Job state
    status: {
      type: String,
      enum: Object.values(DIAL_QUEUE_JOB_STATUSES),
      default: DIAL_QUEUE_JOB_STATUSES.WAITING,
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    
    // Scheduling
    nextEligibleAt: {
      type: Date,
      default: Date.now,
      index: true, // Critical for finding next jobs to claim
    },
    
    // Lease tracking (for atomicity)
    leaseOwner: {
      type: String, // Worker ID / server hostname + process id
      default: null,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
    },
    
    // Deduplication / Idempotency
    dedupeKey: {
      type: String, // Format: "campaign:{campaignId}:lead:{leadId}:attempt:{attemptCount}"
      unique: true,
      sparse: true, // Only enforce uniqueness if key is present
    },
    
    // Error tracking
    lastError: {
      failureCategory: {
        type: String,
        enum: Object.values(FAILURE_CATEGORIES),
        default: null,
      },
      errorCode: String, // e.g., "NO_ANSWER", "BUSY", "NETWORK_ERROR"
      errorMessage: String,
      retryable: { type: Boolean, default: true },
      timestamp: Date,
    },
    
    // Retry metadata
    retryReason: {
      type: String,
      default: null, // e.g., "no_answer", "busy", "timeout"
    },
    retryStep: {
      type: Number,
      default: 1, // Affects backoff calculation if using exponential strategy
    },
    
    // Audit trail
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    claimedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

// ========== INDEXES ==========
// Composite index for finding next jobs to claim (critical path)
dialQueueJobSchema.index({
  campaignId: 1,
  status: 1,
  nextEligibleAt: 1,
  createdAt: 1,
});

// Index for checking lease expiry (cleanup)
dialQueueJobSchema.index({
  status: 1,
  leaseExpiresAt: 1,
});

// Index for dead-letter queries
dialQueueJobSchema.index({
  campaignId: 1,
  status: 1,
});

// Index for analytics (attempt distribution)
dialQueueJobSchema.index({
  campaignId: 1,
  attemptCount: 1,
  status: 1,
});

// ========== METHODS ==========

/**
 * Claim this job atomically (used as part of findOneAndUpdate)
 * Sets lease ownership to prevent duplicate processing
 */
dialQueueJobSchema.methods.claim = function (workerId) {
  this.leaseOwner = workerId;
  this.leaseExpiresAt = new Date(Date.now() + DIAL_QUEUE_LEASE_TIMEOUT_MS);
  this.status = DIAL_QUEUE_JOB_STATUSES.CLAIMED;
  this.claimedAt = new Date();
  return this.save();
};

/**
 * Mark job as completed (call succeeded)
 */
dialQueueJobSchema.methods.markCompleted = function () {
  this.status = DIAL_QUEUE_JOB_STATUSES.COMPLETED;
  this.completedAt = new Date();
  this.leaseOwner = null;
  this.leaseExpiresAt = null;
  return this.save();
};

/**
 * Transition to retry with backoff state
 * Used for transient failures (network, timeout)
 */
dialQueueJobSchema.methods.markBackoffRetry = function (errorCode, errorMessage, nextRetryDelayMs) {
  this.status = DIAL_QUEUE_JOB_STATUSES.BACKOFF;
  this.nextEligibleAt = new Date(Date.now() + nextRetryDelayMs);
  this.lastError = {
    failureCategory: FAILURE_CATEGORIES.TRANSIENT,
    errorCode,
    errorMessage,
    retryable: true,
    timestamp: new Date(),
  };
  this.leaseOwner = null;
  this.leaseExpiresAt = null;
  this.attemptCount += 1;
  return this.save();
};

/**
 * Transition to queue tail (re-enqueue for retryable failures with retry gap)
 * Used for failures like no_answer, busy
 */
dialQueueJobSchema.methods.markQueueTailRetry = function (retryReason, retryGapMinutes = 120) {
  this.status = DIAL_QUEUE_JOB_STATUSES.QUEUE_TAIL;
  this.nextEligibleAt = new Date(Date.now() + (retryGapMinutes * 60 * 1000));
  this.lastError = {
    failureCategory: FAILURE_CATEGORIES.RETRYABLE,
    errorCode: retryReason,
    errorMessage: `Retryable failure: ${retryReason}`,
    retryable: true,
    timestamp: new Date(),
  };
  this.leaseOwner = null;
  this.leaseExpiresAt = null;
  this.attemptCount += 1;
  return this.save();
};

/**
 * Transition to dead letter (max retries exceeded)
 */
dialQueueJobSchema.methods.markDeadLetter = function (reason) {
  this.status = DIAL_QUEUE_JOB_STATUSES.DEAD_LETTER;
  this.lastError = {
    failureCategory: FAILURE_CATEGORIES.TERMINAL,
    errorCode: 'MAX_RETRIES_EXCEEDED',
    errorMessage: reason || 'Maximum retry attempts exceeded',
    retryable: false,
    timestamp: new Date(),
  };
  this.leaseOwner = null;
  this.leaseExpiresAt = null;
  return this.save();
};

/**
 * Transition to terminal (unretryable failure like invalid lead)
 */
dialQueueJobSchema.methods.markTerminal = function (errorCode, errorMessage) {
  this.status = DIAL_QUEUE_JOB_STATUSES.TERMINAL;
  this.lastError = {
    failureCategory: FAILURE_CATEGORIES.TERMINAL,
    errorCode,
    errorMessage,
    retryable: false,
    timestamp: new Date(),
  };
  this.leaseOwner = null;
  this.leaseExpiresAt = null;
  return this.save();
};

/**
 * Release lease (unblock if claimed but not progressing)
 */
dialQueueJobSchema.methods.releaseLease = function () {
  this.leaseOwner = null;
  this.leaseExpiresAt = null;
  // Reset status back to WAITING if still in CLAIMED state
  if (this.status === DIAL_QUEUE_JOB_STATUSES.CLAIMED) {
    this.status = DIAL_QUEUE_JOB_STATUSES.WAITING;
  }
  return this.save();
};

/**
 * Get backoff delay in milliseconds (exponential with attempt count)
 * Formula: base * (2 ^ (attemptCount - 1)) + jitter
 */
dialQueueJobSchema.methods.getExponentialBackoffMs = function (baseDelayMs = 1000) {
  const exponentialDelay = baseDelayMs * Math.pow(2, Math.max(0, this.attemptCount - 1));
  const cappedDelay = Math.min(exponentialDelay, 10 * 60 * 1000); // Cap at 10 minutes
  const jitter = Math.random() * 0.2 * cappedDelay; // ±10% jitter
  return cappedDelay + jitter;
};

export default mongoose.model('DialQueueJob', dialQueueJobSchema);
