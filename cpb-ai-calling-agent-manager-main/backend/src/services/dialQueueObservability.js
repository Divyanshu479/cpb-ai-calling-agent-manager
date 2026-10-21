import DialQueueJob from '../models/DialQueueJob.js';
import CallSession from '../models/CallSession.js';
import dialQueueWorker from './dialQueueWorker.js';
import {
  DIAL_QUEUE_JOB_STATUSES,
} from '../config/constants.js';

/**
 * DialQueueObservability - Provides metrics and insights on queue system health
 */
class DialQueueObservability {
  /**
   * Get comprehensive queue metrics for a campaign
   */
  async getCampaignQueueMetrics(campaignId) {
    try {
      // Get job status breakdown
      const statusBreakdown = await this._getJobStatusBreakdown(campaignId);
      
      // Get retry distribution
      const retryDistribution = await this._getRetryDistribution(campaignId);
      
      // Get dead-letter count
      const deadLetterCount = statusBreakdown.deadLetterCount || 0;
      
      // Get worker stats
      const workerStats = dialQueueWorker.getWorkerStats();
      const campaignWorkerStats = workerStats.campaigns[campaignId.toString()] || {};
      
      // Get timing metrics
      const timingMetrics = await this._getTimingMetrics(campaignId);
      
      // Calculate health score
      const healthScore = this._calculateHealthScore(statusBreakdown, retryDistribution);

      return {
        campaignId: campaignId.toString(),
        timestamp: new Date(),
        queueDepth: statusBreakdown.totalJobs,
        statusBreakdown,
        retryDistribution,
        deadLetterCount,
        workerStats: campaignWorkerStats,
        timingMetrics,
        healthScore,
      };
    } catch (error) {
      console.error('Error getting campaign queue metrics:', error);
      throw error;
    }
  }

  /**
   * Get global queue metrics across all campaigns
   */
  async getGlobalQueueMetrics() {
    try {
      const allJobs = await DialQueueJob.aggregate([
        {
          $group: {
            _id: null,
            totalJobs: { $sum: 1 },
            totalCampaigns: { $addToSet: '$campaignId' },
            waitingCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.WAITING] }, 1, 0] },
            },
            claimedCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.CLAIMED] }, 1, 0] },
            },
            completedCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.COMPLETED] }, 1, 0] },
            },
            deadLetterCount: {
              $sum: { $cond: [{ $eq: ['$status', DIAL_QUEUE_JOB_STATUSES.DEAD_LETTER] }, 1, 0] },
            },
            avgAttempts: { $avg: '$attemptCount' },
            maxAttempts: { $max: '$attemptCount' },
          },
        },
      ]);

      const result = allJobs.length > 0 ? allJobs[0] : {
        totalJobs: 0,
        totalCampaigns: [],
        waitingCount: 0,
        claimedCount: 0,
        completedCount: 0,
        deadLetterCount: 0,
        avgAttempts: 0,
        maxAttempts: 0,
      };

      const workerStats = dialQueueWorker.getWorkerStats();

      return {
        timestamp: new Date(),
        queueStats: result,
        workerStats,
        successRate: result.totalJobs > 0 
          ? ((result.completedCount / result.totalJobs) * 100).toFixed(2) + '%'
          : 'N/A',
      };
    } catch (error) {
      console.error('Error getting global queue metrics:', error);
      throw error;
    }
  }

  /**
   * Get dead-letter jobs for a campaign (for manual inspection/replay)
   */
  async getDeadLetterJobs(campaignId, limit = 50, skip = 0) {
    try {
      const jobs = await DialQueueJob.find({
        campaignId,
        status: DIAL_QUEUE_JOB_STATUSES.DEAD_LETTER,
      })
        .populate('leadId', 'phoneNumber name email')
        .populate('sessionId', 'status duration estimatedTokenCostInr')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .skip(skip);

      const total = await DialQueueJob.countDocuments({
        campaignId,
        status: DIAL_QUEUE_JOB_STATUSES.DEAD_LETTER,
      });

      return {
        deadLetterJobs: jobs,
        total,
        page: Math.floor(skip / limit) + 1,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      console.error('Error fetching dead-letter jobs:', error);
      throw error;
    }
  }

  /**
   * Batch replay dead-letter jobs
   */
  async replayDeadLetterJobs(campaignId, jobIds = []) {
    try {
      let query = { campaignId, status: DIAL_QUEUE_JOB_STATUSES.DEAD_LETTER };
      
      // If specific jobIds provided, only replay those
      if (jobIds.length > 0) {
        query._id = { $in: jobIds };
      }

      const result = await DialQueueJob.updateMany(
        query,
        {
          $set: {
            status: DIAL_QUEUE_JOB_STATUSES.WAITING,
            nextEligibleAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            attemptCount: 1,
            lastError: null,
          },
        }
      );

      console.log(`Replayed ${result.modifiedCount} dead-letter jobs for campaign ${campaignId}`);
      return result;
    } catch (error) {
      console.error('Error replaying dead-letter jobs:', error);
      throw error;
    }
  }

  /**
   * Get job status breakdown
   */
  async _getJobStatusBreakdown(campaignId) {
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
          },
        },
      ]);

      return stats.length > 0 ? stats[0] : {
        totalJobs: 0,
        waitingCount: 0,
        claimedCount: 0,
        completedCount: 0,
        backoffCount: 0,
        queueTailCount: 0,
        deadLetterCount: 0,
        terminalCount: 0,
      };
    } catch (error) {
      console.error('Error getting job status breakdown:', error);
      throw error;
    }
  }

  /**
   * Get retry attempt distribution
   */
  async _getRetryDistribution(campaignId) {
    try {
      const distribution = await DialQueueJob.aggregate([
        { $match: { campaignId } },
        {
          $group: {
            _id: '$attemptCount',
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      const result = {};
      for (const item of distribution) {
        result[`attempt_${item._id}`] = item.count;
      }

      return result;
    } catch (error) {
      console.error('Error getting retry distribution:', error);
      throw error;
    }
  }

  /**
   * Get timing metrics (claim latency, duration)
   */
  async _getTimingMetrics(campaignId) {
    try {
      // Calculate claim latency (time from creation to claim)
      const claimLatencies = await DialQueueJob.aggregate([
        {
          $match: {
            campaignId,
            claimedAt: { $exists: true },
            createdAt: { $exists: true },
          },
        },
        {
          $project: {
            latencyMs: {
              $subtract: ['$claimedAt', '$createdAt'],
            },
          },
        },
        {
          $group: {
            _id: null,
            avgLatency: { $avg: '$latencyMs' },
            minLatency: { $min: '$latencyMs' },
            maxLatency: { $max: '$latencyMs' },
            p95Latency: {
              $percentile: {
                input: '$latencyMs',
                p: [0.95],
                method: 'approximate'
              },
            },
          },
        },
      ]);

      const latency = claimLatencies.length > 0 ? claimLatencies[0] : {
        avgLatency: 0,
        minLatency: 0,
        maxLatency: 0,
        p95Latency: 0,
      };

      // Calculate call duration from sessions
      const callDurations = await CallSession.aggregate([
        {
          $match: {
            campaignId,
            status: DIAL_QUEUE_JOB_STATUSES.COMPLETED,
          },
        },
        {
          $group: {
            _id: null,
            avgDuration: { $avg: '$duration' },
            minDuration: { $min: '$duration' },
            maxDuration: { $max: '$duration' },
          },
        },
      ]);

      const duration = callDurations.length > 0 ? callDurations[0] : {
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
      };

      return {
        claimLatencyMs: latency,
        callDurationSec: duration,
      };
    } catch (error) {
      console.error('Error getting timing metrics:', error);
      return {
        claimLatencyMs: {},
        callDurationSec: {},
      };
    }
  }

  /**
   * Calculate health score (0-100) based on queue metrics
   */
  _calculateHealthScore(statusBreakdown, retryDistribution) {
    if (!statusBreakdown.totalJobs) {
      return 100; // Empty queue is healthy
    }

    const completionRate = statusBreakdown.completedCount / statusBreakdown.totalJobs;
    const failureRate = (statusBreakdown.deadLetterCount + statusBreakdown.terminalCount) / statusBreakdown.totalJobs;
    const pendingRate = statusBreakdown.waitingCount / statusBreakdown.totalJobs;

    // Health score factors:
    // - Completion rate: 50 points (target: 100% complete)
    // - Failure rate: 30 points (target: 0% failure)
    // - Pending backlog: 20 points (target: 0% pending)

    let score = 100;
    score -= (1 - completionRate) * 50; // Penalize incomplete
    score -= failureRate * 30; // Penalize failures
    score -= pendingRate * 20; // Penalize backlog

    return Math.max(0, Math.round(score));
  }
}

export default new DialQueueObservability();
