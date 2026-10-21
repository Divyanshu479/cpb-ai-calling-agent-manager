import DialQueueJob from '../models/DialQueueJob.js';
import Lead from '../models/Lead.js';
import {
  DIAL_QUEUE_JOB_STATUSES,
  RETRY_MODES,
  FAILURE_CATEGORIES,
  DIAL_QUEUE_LEASE_TIMEOUT_MS,
} from '../config/constants.js';

class DialQueueService {
  /**
   * Enqueue a new job for a lead within a campaign
   * Creates initial WAITING job or transitions existing failed job back to WAITING
   */
  async enqueueJob({ campaignId, leadId, retryMode = RETRY_MODES.QUEUE_TAIL }) {
    try {
      const dedupeKey = this._buildDedupeKey(campaignId, leadId, 1);
      
      // Check if job already exists
      let job = await DialQueueJob.findOne({ campaignId, leadId });
      
      if (job) {
        // Job exists, transition back to WAITING if in terminal state or re-enqueue
        job.status = DIAL_QUEUE_JOB_STATUSES.WAITING;
        job.nextEligibleAt = new Date();
        job.leaseOwner = null;
        job.leaseExpiresAt = null;
        job.dedupeKey = dedupeKey;
      } else {
        // Create new job
        job = new DialQueueJob({
          campaignId,
          leadId,
          status: DIAL_QUEUE_JOB_STATUSES.WAITING,
          nextEligibleAt: new Date(),
          dedupeKey,
          attemptCount: 1,
        });
      }
      
      await job.save();
      return job;
    } catch (error) {
      console.error('Error enqueueing job:', error);
      throw error;
    }
  }

  /**
   * Enqueue a massive batch of jobs efficiently using bulkWrite
   */
  async enqueueJobsBatch({ campaignId, leadIds }) {
    try {
      const existingJobs = await DialQueueJob.find({ campaignId, leadId: { $in: leadIds } }).select('leadId');
      const existingLeadIds = new Set(existingJobs.map(job => job.leadId.toString()));

      const bulkOps = [];
      const now = new Date();

      for (const leadId of leadIds) {
        const idStr = leadId.toString();
        const dedupeKey = this._buildDedupeKey(campaignId, leadId, 1);
        
        if (existingLeadIds.has(idStr)) {
          bulkOps.push({
            updateOne: {
              filter: { campaignId, leadId },
              update: {
                $set: {
                  status: DIAL_QUEUE_JOB_STATUSES.WAITING,
                  nextEligibleAt: now,
                  leaseOwner: null,
                  leaseExpiresAt: null,
                  dedupeKey
                }
              }
            }
          });
        } else {
          bulkOps.push({
            insertOne: {
              document: {
                campaignId,
                leadId,
                status: DIAL_QUEUE_JOB_STATUSES.WAITING,
                nextEligibleAt: now,
                dedupeKey,
                attemptCount: 1,
              }
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        const batchSize = 2500;
        for (let i = 0; i < bulkOps.length; i += batchSize) {
          await DialQueueJob.bulkWrite(bulkOps.slice(i, i + batchSize), { ordered: false });
        }
      }
    } catch (error) {
      console.error('Error enqueueing batch of jobs:', error);
      throw error;
    }
  }

  /**
   * Atomically claim the next available job for a worker
   * Uses findOneAndUpdate for atomicity (no race conditions)
   * Returns null if no jobs ready
   */
  async claimNextJob(workerId, campaignId, maxConcurrentCalls) {
    try {
      // First, clean up expired leases
      await this._releaseExpiredLeases();
      
      // Count current active calls for this campaign accurately without double-counting.
      // An ongoing call has BOTH lead.status = 'calling' AND job.status = 'claimed' (until hangup).
      // Deduplicate the lead IDs across both states to prevent each single call from counting as 2 slots.
      const mongoose = (await import('mongoose')).default;
      const callingLeadIds = await mongoose.model('Lead').find({
        campaignId,
        status: 'calling',
      }).distinct('_id');

      const claimedJobLeadIds = await DialQueueJob.find({
        campaignId,
        status: DIAL_QUEUE_JOB_STATUSES.CLAIMED,
      }).distinct('leadId');

      const uniqueActiveLeadIds = new Set([
        ...callingLeadIds.map(id => id.toString()),
        ...claimedJobLeadIds.map(id => id.toString()),
      ]);

      const totalActiveConcurrency = uniqueActiveLeadIds.size;
      
      // Don't claim if already at max concurrency
      if (totalActiveConcurrency >= maxConcurrentCalls) {
        return null;
      }
      
      // Find and claim next job atomically
      const job = await DialQueueJob.findOneAndUpdate(
        {
          campaignId,
          status: { 
            $in: [
              DIAL_QUEUE_JOB_STATUSES.WAITING, 
              DIAL_QUEUE_JOB_STATUSES.QUEUE_TAIL, 
              DIAL_QUEUE_JOB_STATUSES.BACKOFF
            ] 
          },
          nextEligibleAt: { $lte: new Date() },
        },
        {
          $set: {
            status: DIAL_QUEUE_JOB_STATUSES.CLAIMED,
            leaseOwner: workerId,
            leaseExpiresAt: new Date(Date.now() + DIAL_QUEUE_LEASE_TIMEOUT_MS),
            claimedAt: new Date(),
          },
        },
        {
          sort: { nextEligibleAt: 1, createdAt: 1 }, // FIFO by eligibility then creation
          new: true,
        }
      );
      
      return job;
    } catch (error) {
      console.error('Error claiming next job:', error);
      throw error;
    }
  }

  /**
   * Acknowledge successful completion of a job
   */
  async ackJobCompleted(jobId) {
    try {
      const job = await DialQueueJob.findByIdAndUpdate(
        jobId,
        {
          $set: {
            status: DIAL_QUEUE_JOB_STATUSES.COMPLETED,
            completedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        },
        { new: true }
      );
      return job;
    } catch (error) {
      console.error('Error acknowledging job completion:', error);
      throw error;
    }
  }

  /**
   * Put a job back in line without using one of the lead's retries.
   * Used when the telephony provider rejects the call before it is placed.
   */
  async releaseJobWithoutPenalty(jobId, errorCode, errorMessage) {
    const job = await DialQueueJob.findById(jobId);
    if (!job) return null;

    job.status = DIAL_QUEUE_JOB_STATUSES.WAITING;
    job.nextEligibleAt = new Date(Date.now() + 2000);
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
    job.lastError = {
      failureCategory: FAILURE_CATEGORIES.TRANSIENT,
      errorCode: errorCode || 'PROVIDER_FAILURE',
      errorMessage: errorMessage || 'Provider rejected the call before it was placed',
      retryable: true,
      timestamp: new Date(),
    };
    await job.save();

    await Lead.findByIdAndUpdate(job.leadId, {
      $set: { status: 'pending', nextRetryAt: null },
    });
    return job;
  }

  /**
   * Requeue a job based on retry mode and error category
   * - QUEUE_TAIL: Immediate re-enqueue to waiting state
   * - BACKOFF: Exponential backoff with jitter
   */
  async ackJobWithRetry(jobId, retryMode, failureCategory, errorCode, errorMessage, maxRetries = 3, retryGapMinutes = 120) {
    try {
      const job = await DialQueueJob.findById(jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      // Check max retries first
      if (job.attemptCount > maxRetries) {
        await job.markDeadLetter(`${errorCode}: ${errorMessage} (Max retries ${maxRetries} exceeded)`);
        await Lead.findByIdAndUpdate(job.leadId, { 
          $set: { status: 'exhausted', nextRetryAt: null } 
        });
        return job;
      }

      // Determine next action based on failure category and retry mode
      if (failureCategory === FAILURE_CATEGORIES.TERMINAL) {
        // Unretryable - go to dead letter
        await job.markDeadLetter(
          `${errorCode}: ${errorMessage}`
        );
        await Lead.findByIdAndUpdate(job.leadId, { 
          $set: { status: 'failed', nextRetryAt: null } 
        });
        return job;
      }

      if (failureCategory === FAILURE_CATEGORIES.RETRYABLE) {
        if (retryMode === RETRY_MODES.QUEUE_TAIL) {
          // Re-enqueue to queue tail with retry gap
          await job.markQueueTailRetry(errorCode, retryGapMinutes);
        } else {
          // Default to backoff for unknown retry modes
          const backoffMs = job.getExponentialBackoffMs();
          await job.markBackoffRetry(errorCode, errorMessage, backoffMs);
        }
        return job;
      }

      if (failureCategory === FAILURE_CATEGORIES.TRANSIENT) {
        // Transient error - always use backoff
        const backoffMs = job.getExponentialBackoffMs();
        await job.markBackoffRetry(errorCode, errorMessage, backoffMs);
        return job;
      }

      // Default: treat as retryable
      if (retryMode === RETRY_MODES.QUEUE_TAIL) {
        await job.markQueueTailRetry(errorCode, retryGapMinutes);
      } else {
        const backoffMs = job.getExponentialBackoffMs();
        await job.markBackoffRetry(errorCode, errorMessage, backoffMs);
      }
      
      // Sync Lead status to reflect it's waiting for retry
      let leadStatus = 'no_answer';
      if (errorCode && String(errorCode).toLowerCase().includes('busy')) {
        leadStatus = 'busy';
      } else if (errorCode && String(errorCode).toLowerCase().includes('failed')) {
        leadStatus = 'failed';
      } else if (errorCode && String(errorCode).toLowerCase().includes('voicemail')) {
        leadStatus = 'voicemail';
      }

      await Lead.findByIdAndUpdate(job.leadId, {
        $set: { 
          status: leadStatus, 
          nextRetryAt: job.nextEligibleAt 
        }
      });
      
      return job;
    } catch (error) {
      console.error('Error requeuing job:', error);
      throw error;
    }
  }

  /**
   * Release expired leases (for safety: if worker crashes, lease expires and job becomes claimable)
   */
  async _releaseExpiredLeases() {
    try {
      const result = await DialQueueJob.updateMany(
        {
          status: DIAL_QUEUE_JOB_STATUSES.CLAIMED,
          $or: [
            { leaseExpiresAt: { $lte: new Date() } },
            { leaseOwner: null },
            { leaseExpiresAt: null }
          ],
        },
        {
          $set: {
            status: DIAL_QUEUE_JOB_STATUSES.WAITING,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        }
      );
      
      if (result.modifiedCount > 0) {
        console.log(`Released ${result.modifiedCount} expired leases`);
      }
      
      return result;
    } catch (error) {
      console.error('Error releasing expired leases:', error);
      // Minor operation, log but don't throw
      return { modifiedCount: 0 };
    }
  }

  /**
   * Get queue statistics for observability
   */
  async getQueueStats(campaignId) {
    try {
      const stats = await DialQueueJob.aggregate([
        { $match: { campaignId } },
        {
          $group: {
            _id: null,
            totalJobs: { $sum: 1 },
            waitingCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.WAITING] }, 1, 0] },
            },
            claimedCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.CLAIMED] }, 1, 0] },
            },
            completedCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.COMPLETED] }, 1, 0] },
            },
            backoffCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.BACKOFF] }, 1, 0] },
            },
            queueTailCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.QUEUE_TAIL] }, 1, 0] },
            },
            deadLetterCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.DEAD_LETTER] }, 1, 0] },
            },
            terminalCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.TERMINAL] }, 1, 0] },
            },
            avgAttempts: { $avg: '$attemptCount' },
            maxAttempts: { $max: '$attemptCount' },
          },
        },
      ]);

      const result = stats.length > 0 ? stats[0] : {
        totalJobs: 0,
        waitingCount: 0,
        claimedCount: 0,
        completedCount: 0,
        backoffCount: 0,
        queueTailCount: 0,
        deadLetterCount: 0,
        terminalCount: 0,
        avgAttempts: 0,
        maxAttempts: 0,
      };

      return result;
    } catch (error) {
      console.error('Error getting queue stats:', error);
      throw error;
    }
  }

  /**
   * Get dead-letter jobs for manual inspection
   */
  async getDeadLetterJobs(campaignId, limit = 50, skip = 0) {
    try {
      const jobs = await DialQueueJob.find({
        campaignId,
        status: DIAL_QUEUE_JOB_STATUSES.DEAD_LETTER,
      })
        .populate('leadId', 'phoneNumber name')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .skip(skip);

      const total = await DialQueueJob.countDocuments({
        campaignId,
        status: DIAL_QUEUE_JOB_STATUSES.DEAD_LETTER,
      });

      return { jobs, total };
    } catch (error) {
      console.error('Error fetching dead-letter jobs:', error);
      throw error;
    }
  }

  /**
   * Manually replay a dead-letter job (admin operation)
   */
  async replayDeadLetterJob(jobId) {
    try {
      const job = await DialQueueJob.findByIdAndUpdate(
        jobId,
        {
          $set: {
            status: DIAL_QUEUE_JOB_STATUSES.WAITING,
            nextEligibleAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            attemptCount: 1, // Reset counter for replay
            lastError: null,
          },
        },
        { new: true }
      );
      return job;
    } catch (error) {
      console.error('Error replaying dead-letter job:', error);
      throw error;
    }
  }

  /**
   * Helper to build deduplication key
   */
  _buildDedupeKey(campaignId, leadId, attemptCount) {
    return `campaign:${campaignId}:lead:${leadId}:attempt:${attemptCount}`;
  }

  /**
   * Check if a call attempt is idempotent (already processed)
   */
  async checkIdempotency(dedupeKey) {
    try {
      const job = await DialQueueJob.findOne({ dedupeKey });
      return job ? job.status : null;
    } catch (error) {
      console.error('Error checking idempotency:', error);
      throw error;
    }
  }
}

export default new DialQueueService();
