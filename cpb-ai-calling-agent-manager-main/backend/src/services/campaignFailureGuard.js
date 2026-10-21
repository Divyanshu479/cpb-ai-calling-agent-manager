import Campaign from '../models/Campaign.js';
import { CAMPAIGN_STATUSES, PROVIDER_FAILURE_PAUSE_THRESHOLD } from '../config/constants.js';

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNABORTED',
]);

const extractProviderMessage = (data) => {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 300);
  const message = data.error || data.message || data.detail || data.error_message || '';
  return String(message).slice(0, 300);
};

export const isProviderOutage = (error) => {
  if (error?.response) return true;
  return NETWORK_CODES.has(String(error?.code || ''));
};

export const describeProviderFailure = (error) => {
  const status = error?.response?.status;
  const providerMessage = extractProviderMessage(error?.response?.data);
  const blob = `${status || ''} ${providerMessage} ${error?.message || ''}`.toLowerCase();

  if (
    status === 402
    || blob.includes('balance')
    || blob.includes('insufficient')
    || blob.includes('credit')
    || blob.includes('fund')
    || blob.includes('recharge')
  ) {
    return {
      code: 'vobiz_low_balance',
      title: 'Vobiz balance is low',
      message: 'Calls are failing because the Vobiz balance is too low. Add balance, then restart this campaign.',
    };
  }

  if (status === 401 || (status === 403 && (blob.includes('auth') || blob.includes('token') || blob.includes('credential')))) {
    return {
      code: 'vobiz_auth',
      title: 'Vobiz rejected the account',
      message: 'Calls are failing because Vobiz did not accept the telephony credentials. Update the integration, then restart this campaign.',
    };
  }

  const detail = providerMessage || error?.message || 'The provider returned an error.';
  return {
    code: 'provider_call_failed',
    title: 'Calls are failing',
    message: `Call attempts are failing before they can be placed. ${detail} Fix the cause, then restart this campaign.`,
  };
};

class CampaignFailureGuard {
  async recordDialPlaced(campaignId) {
    await Campaign.updateOne(
      { _id: campaignId, 'runtimeAlert.consecutiveFailures': { $gt: 0 } },
      { $set: { 'runtimeAlert.consecutiveFailures': 0 } }
    );
  }

  async recordProviderFailure(campaignId, error) {
    const described = describeProviderFailure(error);
    const updated = await Campaign.findOneAndUpdate(
      { _id: campaignId, status: CAMPAIGN_STATUSES.RUNNING },
      {
        $inc: { 'runtimeAlert.consecutiveFailures': 1 },
        $set: {
          'runtimeAlert.lastErrorAt': new Date(),
          'runtimeAlert.code': described.code,
          'runtimeAlert.title': described.title,
          'runtimeAlert.message': described.message,
        },
      },
      { new: true }
    );

    const count = updated?.runtimeAlert?.consecutiveFailures || 0;
    if (!updated || count < PROVIDER_FAILURE_PAUSE_THRESHOLD) {
      return { paused: false, count };
    }

    const paused = await Campaign.findOneAndUpdate(
      { _id: campaignId, status: CAMPAIGN_STATUSES.RUNNING },
      {
        $set: {
          status: CAMPAIGN_STATUSES.PAUSED,
          'runtimeAlert.active': true,
          'runtimeAlert.failedCount': count,
          'runtimeAlert.pausedAt': new Date(),
          'runtimeAlert.code': described.code,
          'runtimeAlert.title': described.title,
          'runtimeAlert.message': described.message,
        },
      },
      { new: true }
    );

    if (!paused) return { paused: false, count };

    const { default: campaignAutodialerService } = await import('./campaignAutodialerService.js');
    campaignAutodialerService.pause(String(campaignId));
    console.warn(`[CampaignFailureGuard] Paused campaign ${campaignId} after ${count} provider failures: ${described.title}`);
    return { paused: true, count, alert: paused.runtimeAlert };
  }
}

export default new CampaignFailureGuard();
