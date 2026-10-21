import dialQueueService from './dialQueueService.js';
import s2sCallingService from './s2sCallingService.js';
import callSessionService from './callSessionService.js';
import campaignFailureGuard, { isProviderOutage } from './campaignFailureGuard.js';
import DialQueueJob from '../models/DialQueueJob.js';
import Campaign from '../models/Campaign.js';
import Lead from '../models/Lead.js';
import {
  DIAL_QUEUE_JOB_STATUSES,
  RETRY_MODES,
  FAILURE_CATEGORIES,
  DIAL_QUEUE_CLAIM_INTERVAL_MS,
  DIAL_QUEUE_LEASE_TIMEOUT_MS,
} from '../config/constants.js';

/**
 * DialQueueWorker - Manages the queue claiming loop and execution
 * Runs continuously on the campaign dialer, respecting concurrency limits
 */
class DialQueueWorker {
  constructor() {
    this.workerId = `${process.env.HOSTNAME || 'localhost'}-${process.pid}`;
    this.activeCampaigns = new Map(); // campaignId -> { interval, stats }
    this.globalConcurrencySemaphore = 0; // Track total concurrent calls
    this.maxGlobalConcurrency = parseInt(process.env.MAX_GLOBAL_CONCURRENCY || '50', 10);
    this.executePromises = new Map(); // jobId -> promise (for tracking execution)
  }

  /**
   * Start queue worker for a campaign
   * Begins claiming jobs and executing calls
   */
  async startCampaignWorker(campaignId, ownerUserId, requestBaseUrl) {
    const cId = String(campaignId);
    try {
      if (this.activeCampaigns.has(cId)) {
        console.log(`Campaign ${cId} worker already running`);
        return;
      }

      console.log(`Starting queue worker for campaign ${cId}`);

      // Fetch campaign settings
      const campaign = await Campaign.findById(cId);
      if (!campaign) {
        throw new Error(`Campaign not found: ${cId}`);
      }

      const concurrencyLimit = Math.min(
        campaign.settings?.concurrencyLimit || 6,
        this.maxGlobalConcurrency
      );

      // Start the claiming loop
      const interval = setInterval(
        () => this._claimAndExecuteLoop(cId, concurrencyLimit, ownerUserId, requestBaseUrl),
        DIAL_QUEUE_CLAIM_INTERVAL_MS
      );

      this.activeCampaigns.set(cId, {
        interval,
        isProcessing: false,
        stats: {
          claimed: 0,
          completed: 0,
          failed: 0,
          startedAt: new Date(),
        },
      });

      console.log(`Queue worker started for campaign ${cId} (max concurrency: ${concurrencyLimit})`);
    } catch (error) {
      console.error(`Error starting campaign worker for ${cId}:`, error);
      throw error;
    }
  }

  /**
   * Stop queue worker for a campaign
   */
  async stopCampaignWorker(campaignId) {
    const cId = String(campaignId);
    try {
      const campaign = this.activeCampaigns.get(cId);
      if (!campaign) {
        return;
      }

      clearInterval(campaign.interval);
      this.activeCampaigns.delete(cId);

      console.log(`[DialQueueWorker] Queue worker stopped for campaign ${cId}`);
    } catch (error) {
      console.error(`Error stopping campaign worker for ${cId}:`, error);
      throw error;
    }
  }

  /**
   * Main claim and execute loop
   * Runs every DIAL_QUEUE_CLAIM_INTERVAL_MS (1 second by default)
   */
  async _claimAndExecuteLoop(campaignId, concurrencyLimit, ownerUserId, requestBaseUrl) {
    const cId = String(campaignId);
    const campaignState = this.activeCampaigns.get(cId);
    if (!campaignState || campaignState.isProcessing) {
      return; // Skip tick if the previous tick is still processing (prevents overlapping DB race conditions)
    }
    
    campaignState.isProcessing = true;
    try {
      // Check if campaign is active and within calling window
      const campaign = await Campaign.findById(cId).select('status settings');
      if (!campaign || !campaign.canAcceptCalls()) {
        // If the campaign is paused, stopped, or completed, shut down this worker loop!
        if (!campaign || ['paused', 'stopped', 'completed'].includes(campaign.status)) {
          console.log(`[DialQueueWorker] Campaign ${cId} status is ${campaign?.status || 'deleted'}. Stopping queue worker.`);
          await this.stopCampaignWorker(cId);
          return;
        }

        // If it's running but outside the calling window, throttle the log to once every 60s
        const now = Date.now();
        if (!campaignState.lastWindowLog || now - campaignState.lastWindowLog > 60000) {
          campaignState.lastWindowLog = now;
          console.log(`[DialQueueWorker] Campaign ${cId} cannot accept calls. (Status: ${campaign.status}, Within Window: ${campaign.isWithinCallingWindow()})`);
        }
        return;
      }

      // Attempt to claim next job
      const concurrencyLimitToUse = campaign?.settings?.concurrencyLimit || 6;
      const job = await dialQueueService.claimNextJob(
        this.workerId,
        cId,
        concurrencyLimitToUse
      );

      if (!job) {
        // No job available to claim (all busy or no waiting jobs)
        // Check if all leads are processed (throttle to every 10s)
        const campaignState = this.activeCampaigns.get(cId);
        const now = Date.now();
        if (campaignState && (!campaignState.lastCompletionCheck || now - campaignState.lastCompletionCheck > 10000)) {
          campaignState.lastCompletionCheck = now;
          await this._checkCampaignCompletion(cId);
        }
        return;
      }

      // Execute job asynchronously (don't block the loop)
      this._executeJob(job, ownerUserId, requestBaseUrl).catch((error) => {
        console.error(`Unhandled error executing job ${job._id}:`, error);
      });
    } catch (error) {
      console.error(`Error in claim and execute loop for campaign ${cId}:`, error);
    } finally {
      if (campaignState) {
        campaignState.isProcessing = false;
      }
    }
  }

  /**
   * Check if a campaign has finished all leads, and mark it as completed
   */
  async _checkCampaignCompletion(campaignId) {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign || campaign.status !== 'running') return;

      const activeLeadsCount = await Lead.countDocuments({
        campaignId,
        status: { $nin: ['completed', 'exhausted', 'failed', 'canceled'] }
      });

      if (activeLeadsCount === 0) {
        console.log(`[DialQueueWorker] Campaign ${campaignId} has processed all leads. Marking as COMPLETED.`);
        campaign.status = 'completed';
        campaign.completedAt = new Date();
        await campaign.save();
        await this.stopCampaignWorker(campaignId);
      }
    } catch (error) {
      console.error(`Error checking completion for campaign ${campaignId}:`, error);
    }
  }

  /**
   * Execute a single claimed job
   * Handles call initiation, success/failure transitions, and lease management
   */
  async _executeJob(job, ownerUserId, requestBaseUrl) {
    const jobId = job._id.toString();
    const campaignId = job.campaignId.toString();

    try {
      // Ensure the lead is actually ready for a call before executing
      const lead = await Lead.findById(job.leadId);
      if (!lead || !lead.isReadyForCall()) {
        console.log(`[DialQueueWorker] Skipping job ${jobId} because lead ${job.leadId} is not ready for call (status: ${lead?.status})`);
        await dialQueueService.ackJobCompleted(jobId);
        return;
      }

      // Mark execution start
      this.globalConcurrencySemaphore += 1;
      const executePromise = this._performCall(job, ownerUserId, requestBaseUrl);
      this.executePromises.set(jobId, executePromise);

      // Await execution (with timeout safety)
      const result = await Promise.race([
        executePromise,
        this._setTimeout(DIAL_QUEUE_LEASE_TIMEOUT_MS, 'Lease timeout'),
      ]);

      // Success path - call completed
      await dialQueueService.ackJobCompleted(jobId);
      await campaignFailureGuard.recordDialPlaced(campaignId);
      const campaign = this.activeCampaigns.get(campaignId);
      if (campaign) {
        campaign.stats.completed += 1;
      }

      console.log(`Job ${jobId} completed successfully`);
    } catch (error) {
      // Determine failure category and retry mode
      const failureCategory = this._categorizeError(error);
      const campaign = await Campaign.findById(campaignId);
      const retryMode = campaign?.settings?.retryMode || RETRY_MODES.QUEUE_TAIL;
      const maxRetries = campaign?.settings?.maxRetries ?? 3;
      const retryGapMinutes = campaign?.settings?.retryGap ?? 120;

      // Transition job based on failure
      const errorCode = error.code || 'UNKNOWN_ERROR';
      const errorMessage = error.message;

      if (isProviderOutage(error)) {
        await dialQueueService.releaseJobWithoutPenalty(jobId, errorCode, errorMessage);
        await campaignFailureGuard.recordProviderFailure(campaignId, error);
      } else {
        await campaignFailureGuard.recordDialPlaced(campaignId);
        await dialQueueService.ackJobWithRetry(
          jobId,
          retryMode,
          failureCategory,
          errorCode,
          errorMessage,
          maxRetries,
          retryGapMinutes
        );
      }

      const campaign_stats = this.activeCampaigns.get(campaignId);
      if (campaign_stats) {
        campaign_stats.stats.failed += 1;
      }

      console.log(
        `Job ${jobId} failed with ${failureCategory}: ${errorCode}. Transitioned to retry state.`
      );
    } finally {
      // Cleanup
      this.globalConcurrencySemaphore -= 1;
      this.executePromises.delete(jobId);
    }
  }

  /**
   * Perform the actual call via s2sCallingService
   */
  async _performCall(job, ownerUserId, requestBaseUrl) {
    try {
      const result = await s2sCallingService.initiateLeadCall({
        leadId: job.leadId.toString(),
        ownerUserId,
        requestBaseUrl,
        source: 'queue_worker',
      });

      // Wait for the call session to reach a terminal state (hangup) before resolving.
      // This ensures job completion reflects the actual provider outcome (answered/busy/no-answer/etc).
      const callSessionId = result?.callSessionId;
      const leaseTimeout = DIAL_QUEUE_LEASE_TIMEOUT_MS || 30000;
      if (callSessionId) {
        const finalSession = await callSessionService.waitForSessionTerminal(callSessionId, leaseTimeout);
        if (finalSession) {
          const outcome = finalSession.callOutcome || finalSession.status;
          if (['no_answer', 'busy', 'failed', 'canceled', 'voicemail', 'system_error'].includes(outcome)) {
            const err = new Error(`Call did not connect (Outcome: ${outcome})`);
            err.code = outcome.toUpperCase();
            throw err;
          }
          return {
            ...result,
            session: finalSession,
          };
        }
        // If we timed out waiting, throw to trigger retry handling.
        const err = new Error('Session terminal wait timed out');
        err.code = 'TIMEOUT';
        throw err;
      }

      return result;
    } catch (error) {
      // Enrich error with code for categorization
      if (!error.code) {
        error.code = 'CALL_INITIATION_ERROR';
      }
      throw error;
    }
  }

  /**
   * Categorize error into failure category
   */
  _categorizeError(error) {
    const errorCode = error.code || error.message || '';

    // Retryable failures (user-side issues)
    if (['NO_ANSWER', 'BUSY', 'VOICEMAIL', 'SILENT', 'BRIEF_SILENCE'].includes(errorCode)) {
      return FAILURE_CATEGORIES.RETRYABLE;
    }

    // Transient failures (infrastructure)
    if (['NETWORK_ERROR', 'TIMEOUT', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED'].includes(errorCode)) {
      return FAILURE_CATEGORIES.TRANSIENT;
    }

    // Terminal failures (unrecoverable)
    if (['INVALID_LEAD', 'INVALID_PHONE', 'PERMISSION_DENIED', 'INVALID_PROVIDER'].includes(errorCode)) {
      return FAILURE_CATEGORIES.TERMINAL;
    }

    // Default: treat as retryable (safer default)
    return FAILURE_CATEGORIES.RETRYABLE;
  }

  /**
   * Helper to create a promise that resolves after specified ms
   */
  _setTimeout(ms, message) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new Error(message));
      }, ms);
    });
  }

  /**
   * Get worker stats
   */
  getWorkerStats() {
    const campaigns = {};
    for (const [campaignId, data] of this.activeCampaigns) {
      campaigns[campaignId] = {
        ...data.stats,
        uptime: new Date() - data.stats.startedAt,
      };
    }

    return {
      workerId: this.workerId,
      activeCampaigns: this.activeCampaigns.size,
      globalConcurrency: this.globalConcurrencySemaphore,
      maxGlobalConcurrency: this.maxGlobalConcurrency,
      campaigns,
    };
  }

  /**
   * Graceful shutdown - stop all campaign workers
   */
  async shutdown() {
    try {
      console.log('DialQueueWorker shutting down gracefully...');
      const campaigns = Array.from(this.activeCampaigns.keys());
      for (const campaignId of campaigns) {
        await this.stopCampaignWorker(campaignId);
      }
      console.log('DialQueueWorker shutdown complete');
    } catch (error) {
      console.error('Error during DialQueueWorker shutdown:', error);
      throw error;
    }
  }
}

export default new DialQueueWorker();
