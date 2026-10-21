import Integration from '../models/Integration.js';
import CallSession from '../models/CallSession.js';
import Campaign from '../models/Campaign.js';
import callSessionService from './callSessionService.js';
import dialQueueService from './dialQueueService.js';
import DialQueueJob from '../models/DialQueueJob.js';
import { RETRY_MODES, FAILURE_CATEGORIES } from '../config/constants.js';

class VobizCdrPoller {
  constructor() {
    this.interval = null;
    this.running = false;
    this.pollIntervalMs = Number(process.env.VOBIZ_CDR_POLL_MS || '60000');
  }

  async pollOnce() {
    try {
      const integrations = await Integration.find({ type: 'telephony', 'metadata.provider': 'vobiz', isActive: true });
      if (!integrations || integrations.length === 0) return;

      for (const telephony of integrations) {
        try {
          const metadata = telephony.metadata instanceof Map ? Object.fromEntries(telephony.metadata) : (telephony.metadata || {});
          const authId = telephony.authConfig?.username;
          const authToken = telephony.authConfig?.password;
          if (!authId || !authToken) continue;

          let apiBase = metadata.apiBaseUrl || 'https://api.vobiz.ai';
          apiBase = apiBase.replace(/\/$/, '');
          if (apiBase && !apiBase.endsWith('/api/v1') && !apiBase.endsWith('/v1') && (apiBase.includes('api.vobiz.ai') || apiBase.includes('vobiz.ai'))) {
            apiBase = `${apiBase}/api/v1`;
          }
          const url = `${apiBase}/Account/${encodeURIComponent(authId)}/cdr/recent?limit=50`;

          const resp = await fetch(url, {
            method: 'GET',
            headers: {
              'X-Auth-ID': authId,
              'X-Auth-Token': authToken,
              Accept: 'application/json',
            },
          });

          if (!resp.ok) {
            console.warn(`[Vobiz CDR Poller] CDR fetch failed for integration "${telephony.name}"`, resp.status);
            continue;
          }

          const body = await resp.json().catch(() => null);
          if (!body?.data || !Array.isArray(body.data)) continue;

          for (const cdr of body.data) {
            const callId = cdr.call_id || cdr.callId || cdr.call_uuid || '';
        if (!callId) continue;

        // Find associated session by provider id
        const session = await CallSession.findOne({ $or: [{ providerCallId: callId }, { twilioCallSid: callId }] });
        if (!session) continue;

        // If session already terminal, skip
        if (callSessionService.isTerminalSessionStatus(session.status)) continue;

        const mappedStatus = (cdr.status || '').toLowerCase();

        await callSessionService.handleTwilioStatusUpdate({
          callSessionId: session._id.toString(),
          callSid: callId,
          callStatus: mappedStatus,
          payload: cdr,
        });

        // Synchronize job if applicable
        try {
          const job = await DialQueueJob.findOne({ sessionId: session._id });
          if (job) {
            if (mappedStatus === 'completed') {
              await dialQueueService.ackJobCompleted(job._id.toString());
            } else if (['no-answer', 'busy', 'failed', 'canceled'].includes(mappedStatus)) {
              const campaign = await Campaign.findById(job.campaignId);
              const retryMode = campaign?.settings?.retryMode || RETRY_MODES.QUEUE_TAIL;
              await dialQueueService.ackJobWithRetry(job._id.toString(), retryMode, FAILURE_CATEGORIES.RETRYABLE, mappedStatus.toUpperCase(), `CDR: ${mappedStatus}`);
            }
          }
        } catch (e) {
          // ignore per-job sync errors
        }
      }
        } catch (innerErr) {
          console.error(`[Vobiz CDR Poller] Error polling for integration "${telephony.name}":`, innerErr?.message || innerErr);
        }
      }
    } catch (err) {
      console.error('[Vobiz CDR Poller] error', err?.message || err);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.interval = setInterval(() => this.pollOnce().catch((e) => console.error(e)), this.pollIntervalMs);
    // Run immediately once
    this.pollOnce().catch(() => { });
    console.log('[Vobiz CDR Poller] started (interval ms:', this.pollIntervalMs, ')');
  }

  stop() {
    if (!this.running) return;
    clearInterval(this.interval);
    this.running = false;
    console.log('[Vobiz CDR Poller] stopped');
  }
}

export default new VobizCdrPoller();
