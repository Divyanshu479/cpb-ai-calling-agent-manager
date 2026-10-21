import Campaign from '../models/Campaign.js';
import Lead from '../models/Lead.js';
import { CAMPAIGN_STATUSES } from '../config/constants.js';
import s2sCallingService from './s2sCallingService.js';
import dialQueueService from './dialQueueService.js';
import dialQueueWorker from './dialQueueWorker.js';

const DEFAULT_LOOP_INTERVAL_MS = 5000;
const DEFAULT_MAX_BATCH_SIZE = 10;

class CampaignAutodialerService {
  constructor() {
    this.activeCampaigns = new Map();
    this.loopIntervalMs = Number.parseInt(
      process.env.CAMPAIGN_AUTODIALER_LOOP_MS || String(DEFAULT_LOOP_INTERVAL_MS),
      10
    );
    this.enabled = process.env.CAMPAIGN_AUTODIALER_ENABLED !== 'false';
  }

  getLoopIntervalMs() {
    if (Number.isFinite(this.loopIntervalMs) && this.loopIntervalMs >= 1000) {
      return this.loopIntervalMs;
    }
    return DEFAULT_LOOP_INTERVAL_MS;
  }

  getLeadRetryQuery(now) {
    return {
      status: 'no_answer',
      $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
    };
  }

  isCampaignWithinCallingWindow(campaign) {
    const window = campaign?.settings?.callingWindow;
    if (!window) return true;

    const timezone = window.timezone || 'Asia/Kolkata';
    const days = Array.isArray(window.daysOfWeek) ? window.daysOfWeek : [1, 2, 3, 4, 5];
    const startTime = typeof window.startTime === 'string' ? window.startTime : '09:00';
    const endTime = typeof window.endTime === 'string' ? window.endTime : '18:00';

    const parseTime = (hhmm) => {
      const [hh, mm] = String(hhmm).split(':').map((value) => Number.parseInt(value, 10));
      const hour = Number.isFinite(hh) ? hh : 0;
      const minute = Number.isFinite(mm) ? mm : 0;
      return hour * 60 + minute;
    };

    const now = new Date();
    const dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const weekdayToken = dateParts.find((part) => part.type === 'weekday')?.value || 'Mon';
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = weekdayMap[weekdayToken] ?? 1;

    if (!days.includes(dayOfWeek)) {
      return false;
    }

    const hour = Number.parseInt(dateParts.find((part) => part.type === 'hour')?.value || '0', 10);
    const minute = Number.parseInt(dateParts.find((part) => part.type === 'minute')?.value || '0', 10);
    const currentMinutes = hour * 60 + minute;
    const startMinutes = parseTime(startTime);
    const endMinutes = parseTime(endTime);

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  stopLoop(campaignId) {
    const existing = this.activeCampaigns.get(campaignId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    // Stop the queue worker
    dialQueueWorker.stopCampaignWorker(campaignId).catch((error) => {
      console.error(`[CampaignAutodialer] Error stopping queue worker for campaign ${campaignId}:`, error);
    });

    this.activeCampaigns.delete(campaignId);
  }

  scheduleNextLoop(campaignId) {
    const state = this.activeCampaigns.get(campaignId);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      this.runLoop(campaignId).catch((error) => {
        console.error('[CampaignAutodialer] Loop error', {
          campaignId,
          message: error?.message,
        });
      });
    }, this.getLoopIntervalMs());
  }

  async hasAnyLeads(campaignId) {
    const count = await Lead.countDocuments({ campaignId });
    return count > 0;
  }

  async hasEligibleLeads(campaignId) {
    const now = new Date();
    const count = await Lead.countDocuments({
      campaignId,
      $or: [{ status: 'pending' }, this.getLeadRetryQuery(now)],
    });
    return count > 0;
  }

  async start(campaignId, ownerUserId, requestBaseUrl = '') {
    if (!this.enabled) {
      return { started: false, reason: 'autodialer-disabled' };
    }

    const existing = this.activeCampaigns.get(campaignId);
    if (existing) {
      existing.ownerUserId = ownerUserId;
      existing.requestBaseUrl = requestBaseUrl || existing.requestBaseUrl || '';
      // Campaign worker already running, no need to restart
      return { started: true, resumed: true };
    }

    this.activeCampaigns.set(campaignId, {
      ownerUserId,
      requestBaseUrl,
      inProgress: false,
      timer: null,
    });

    // Initialize queue and start worker
    await this.initializeQueueAndWorker(campaignId, ownerUserId, requestBaseUrl);
    return { started: true, resumed: false };
  }

  async initializeQueueAndWorker(campaignId, ownerUserId, requestBaseUrl) {
    try {
      // Enqueue all pending leads into the queue
      const pendingLeads = await Lead.find({
        campaignId,
        status: 'pending',
      }).select('_id');

      console.log(`[CampaignAutodialer] Enqueueing ${pendingLeads.length} pending leads for campaign ${campaignId}`);

      const leadIds = pendingLeads.map(l => l._id);
      if (leadIds.length > 0) {
        await dialQueueService.enqueueJobsBatch({
          campaignId,
          leadIds
        });
      }

      // Start the queue worker for this campaign
      await dialQueueWorker.startCampaignWorker(campaignId, ownerUserId, requestBaseUrl);

      console.log(`[CampaignAutodialer] Queue worker started for campaign ${campaignId}`);
    } catch (error) {
      console.error(`[CampaignAutodialer] Failed to initialize queue for campaign ${campaignId}:`, error);
      throw error;
    }
  }

  pause(campaignId) {
    this.stopLoop(campaignId);
    return { paused: true };
  }

  async pickEligibleLeads(campaignId, limit) {
    const now = new Date();
    return Lead.find({
      campaignId,
      $or: [{ status: 'pending' }, this.getLeadRetryQuery(now)],
    })
      .sort({ nextRetryAt: 1, createdAt: 1 })
      .limit(limit);
  }

  async runLoop(campaignId) {
    // Legacy loop method - now delegated to queue worker
    // This method is kept for backward compatibility but most logic is now in dialQueueWorker
    const state = this.activeCampaigns.get(campaignId);
    if (!state) return;

    try {
      const campaign = await Campaign.findById(campaignId).select('_id createdBy status settings');
      if (!campaign || campaign.status !== CAMPAIGN_STATUSES.RUNNING) {
        this.stopLoop(campaignId);
        return;
      }

      if (!this.isCampaignWithinCallingWindow(campaign)) {
        this.scheduleNextLoop(campaignId);
        return;
      }

      // Queue-based enqueuing: pick up new pending leads and enqueue them
      const newPendingLeads = await Lead.find({
        campaignId,
        status: 'pending',
      }).select('_id');

      if (newPendingLeads.length > 0) {
        console.log(
          `[CampaignAutodialer] Enqueueing ${newPendingLeads.length} new pending leads for campaign ${campaignId}`
        );

        const leadIds = newPendingLeads.map(l => l._id);
        await dialQueueService.enqueueJobsBatch({
          campaignId,
          leadIds
        });
      }

      // Schedule next loop iteration
      this.scheduleNextLoop(campaignId);
    } catch (error) {
      console.error('[CampaignAutodialer] Loop error', {
        campaignId,
        message: error?.message,
      });
      this.scheduleNextLoop(campaignId);
    }
  }
}

export default new CampaignAutodialerService();