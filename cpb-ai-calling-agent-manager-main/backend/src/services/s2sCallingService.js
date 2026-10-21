import Lead from '../models/Lead.js';
import Campaign from '../models/Campaign.js';
import AICaller from '../models/AICaller.js';
import Integration from '../models/Integration.js';
import TelephonyConfig from '../models/TelephonyConfig.js';
import CallSession from '../models/CallSession.js';
import twilioService from './twilioService.js';
import vobizService from './vobizService.js';
import twilioGeminiBridge from './twilioGeminiBridge.js';
import vobizGeminiBridge from './vobizGeminiBridge.js';
import callSessionService from './callSessionService.js';
import dialQueueService from './dialQueueService.js';
import DialQueueJob from '../models/DialQueueJob.js';
import voicePipelineService from './voicePipelineService.js';
import { DEFAULT_VOICE_PIPELINE } from '../config/voicePipelines.js';

class S2SCallingService {
  getBackendBaseUrl(requestBaseUrl = '') {
    // Prefer explicit public URL from env for Twilio webhooks; request host is only a fallback.
    const rawBaseUrl = (
      process.env.BACKEND_PUBLIC_URL ||
      process.env.BACKEND_URL ||
      requestBaseUrl ||
      ''
    ).trim();

    if (!rawBaseUrl) {
      const error = new Error('Backend public URL is not configured (BACKEND_PUBLIC_URL/BACKEND_URL)');
      error.statusCode = 500;
      throw error;
    }

    return rawBaseUrl.replace(/\/+$/, '').replace(/\/api$/i, '');
  }

  async resolveGeminiIntegration(caller) {
    let integration = null;
    if (caller.s2sConfig?.integrationId) {
      integration = await Integration.findOne({
        _id: caller.s2sConfig.integrationId,
        type: 's2s',
        isActive: true,
      });
    }

    if (!integration) {
      integration = await Integration.findOne({
        type: 's2s',
        isActive: true,
        $or: [{ isDefault: true }, { name: /gemini/i }, { 'metadata.templateId': 'gemini_live' }],
      }).sort({ isDefault: -1, updatedAt: -1 });
    }

    return integration;
  }

  async initiateLeadCall({ leadId, ownerUserId, requestBaseUrl = '', source = 'manual' }) {
    let callSession = null;
  let dedupeKey = null;

    try {
      const lead = await Lead.findById(leadId);
      if (!lead) {
        const error = new Error('Lead not found');
        error.statusCode = 404;
        throw error;
      }

      const campaign = await Campaign.findOne({ _id: lead.campaignId, createdBy: ownerUserId });
      if (!campaign) {
        const error = new Error('Access denied');
        error.statusCode = 403;
        throw error;
      }

      // ========== IDEMPOTENCY CHECK ==========
      // Check if this call attempt was already initiated (prevent duplicate calls)
      // Query CallSession to check if call was already attempted for this lead+attempt
      const attemptNumber = (lead.retryCount || 0) + 1;
      const existingSession = await CallSession.findOne({
        leadId: lead._id,
        campaignId: campaign._id,
        attemptIndex: attemptNumber,
        status: { $nin: ['failed', 'canceled', 'scheduled'] },
      });
      
      if (existingSession) {
        console.log(`[Idempotency] Returning cached call session for lead ${leadId}`);
        return {
          leadId: lead._id,
          campaignId: campaign._id,
          callSessionId: existingSession._id,
          provider: existingSession.provider,
          callSid: existingSession.providerCallId,
          status: existingSession.status,
          cached: true,
        };
      }

      dedupeKey = `campaign:${campaign._id}:lead:${lead._id}:attempt:${attemptNumber}`;

      const caller = await AICaller.findById(campaign.aiCallerId);
      if (!caller) {
        const error = new Error('AI caller not found for campaign');
        error.statusCode = 404;
        throw error;
      }

      if (caller.callingMechanism !== 's2s') {
        const error = new Error('Selected AI caller is not configured for Speech-to-Speech (S2S)');
        error.statusCode = 400;
        throw error;
      }

      const pipelineConfig = {
        ...(caller.s2sConfig?.toObject?.() || caller.s2sConfig || {}),
        pipeline: caller.s2sConfig?.pipeline || DEFAULT_VOICE_PIPELINE,
      };
      const pipeline = await voicePipelineService.validateForCall(pipelineConfig);
      const isSttLlmTts = pipeline.pipeline !== DEFAULT_VOICE_PIPELINE;
      const integration = isSttLlmTts
        ? pipeline.integrations.llm
        : await this.resolveGeminiIntegration(caller);
      if (!integration) {
        const error = new Error(
          isSttLlmTts
            ? 'No active LLM integration found for STT_LLM_TTS'
            : 'No active Gemini S2S integration found. Configure one in Admin > Integrations.'
        );
        error.statusCode = 400;
        throw error;
      }

      let telephony = null;
      if (caller.telephonyConfig?.integrationId) {
        telephony = await Integration.findOne({ _id: caller.telephonyConfig.integrationId, type: 'telephony', isActive: true });
      }
      if (!telephony) {
        telephony = await Integration.findOne({ type: 'telephony', isDefault: true, isActive: true });
      }

      if (!telephony) {
        const error = new Error('No active telephony integration found');
        error.statusCode = 400;
        throw error;
      }

      const metadata = telephony.metadata instanceof Map ? Object.fromEntries(telephony.metadata) : (telephony.metadata || {});
      const provider = String(metadata.provider || '').toLowerCase();
      if (!['twilio', 'vobiz'].includes(provider)) {
        const error = new Error(`Unsupported active telephony provider: ${metadata.provider || 'unknown'}`);
        error.statusCode = 400;
        throw error;
      }

      const fromNumber = caller.telephonyConfig?.callerId || (metadata.callerIds && metadata.callerIds[0]) || '';
      const toNumber = lead.phoneNumber || lead.phone;

      if (!toNumber) {
        const error = new Error('Lead is missing a phone number');
        error.statusCode = 400;
        throw error;
      }

      if (!fromNumber) {
        const error = new Error('Telephony configuration is incomplete (callerId required)');
        error.statusCode = 400;
        throw error;
      }

      const baseUrl = this.getBackendBaseUrl(requestBaseUrl);
      const voiceParams = new URLSearchParams({
        leadId: lead._id.toString(),
        campaignId: campaign._id.toString(),
        aiCallerId: caller._id.toString(),
        agentName: caller.name || '',
        integrationId: integration._id.toString(),
        pipeline: pipeline.pipeline,
        sttIntegrationId: caller.s2sConfig?.sttIntegrationId?.toString?.() || '',
        llmIntegrationId: caller.s2sConfig?.llmIntegrationId?.toString?.() || '',
        ttsIntegrationId: caller.s2sConfig?.ttsIntegrationId?.toString?.() || '',
        sttModel: caller.s2sConfig?.sttModel || '',
        sttLanguage: caller.s2sConfig?.sttLanguage || '',
        sttEncoding: caller.s2sConfig?.sttEncoding || '',
        sttSampleRate: String(caller.s2sConfig?.sttSampleRate || ''),
        sttChannels: String(caller.s2sConfig?.sttChannels || ''),
        sttEndpointingMs: String(caller.s2sConfig?.sttEndpointingMs || ''),
        sttUtteranceEndMs: String(caller.s2sConfig?.sttUtteranceEndMs || ''),
        llmModel: caller.s2sConfig?.llmModel || '',
        ttsModel: caller.s2sConfig?.ttsModel || '',
        ttsVoice: caller.s2sConfig?.ttsVoice || '',
        ttsOutputFormat: caller.s2sConfig?.ttsOutputFormat || '',
        ttsTelephonyFormat: caller.s2sConfig?.ttsTelephonyFormat || '',
        telephonyIntegrationId: telephony._id.toString(),
        model: caller.s2sConfig?.model || 'gemini-3.1-flash-live-preview',
        temperature: String(caller.s2sConfig?.temperature ?? 0.8),
        voice: caller.s2sConfig?.voice || '',
        language: caller.s2sConfig?.language || '',
        thinkingLevel: caller.s2sConfig?.thinkingLevel || '',
        maxCallDuration: String(campaign.settings?.maxCallDuration || caller.guardrails?.maxCallDuration || ''),
      });

      callSession = await callSessionService.createPrimarySession({
        campaignId: campaign._id,
        leadId: lead._id,
        callerId: caller._id,
        createdBy: ownerUserId,
        integrationId: integration._id,
      });

      // Attach telephony integration and provider details
      callSession.provider = provider;
      if (!callSession.metadata) callSession.metadata = {};
      callSession.metadata.telephonyIntegrationId = telephony._id.toString();
      await callSession.save();

      // ========== ATTACH SESSION TO QUEUE JOB ==========
      // Link the newly created session to the queue job for idempotency tracking
      await DialQueueJob.findOneAndUpdate(
        { campaignId: campaign._id, leadId: lead._id },
        {
          $set: {
            sessionId: callSession._id,
            dedupeKey,
            status: 'claimed', // Mark as in-progress
          },
        },
        { upsert: true, new: true }
      );

      voiceParams.set('callSessionId', callSession._id.toString());
      const statusCallbackParams = new URLSearchParams({
        leadId: lead._id.toString(),
        callSessionId: callSession._id.toString(),
        campaignId: campaign._id.toString(),
      });
      let providerCall = null;

      if (provider === 'twilio') {
        const accountSid = telephony.authConfig?.username;
        const authToken = telephony.authConfig?.password;
        if (!accountSid || !authToken) {
          const error = new Error('Twilio configuration is incomplete (accountSid/authToken required)');
          error.statusCode = 400;
          throw error;
        }

        const voiceWebhookUrl = `${baseUrl}/api/telephony/twilio/voice?${voiceParams.toString()}`;
        const statusCallbackUrl = `${baseUrl}/api/telephony/twilio/status?${statusCallbackParams.toString()}`;
        const amdStatusCallbackUrl = `${baseUrl}/api/telephony/twilio/amd?${statusCallbackParams.toString()}`;

        providerCall = await twilioService.initiateCall({
          accountSid,
          authToken,
          to: toNumber,
          from: fromNumber,
          voiceWebhookUrl,
          statusCallbackUrl,
          machineDetection: 'Enable',
          asyncAmd: 'true',
          asyncAmdStatusCallback: amdStatusCallbackUrl,
          asyncAmdStatusCallbackMethod: 'POST',
        });

        if (!isSttLlmTts) {
          twilioGeminiBridge.prewarmCallSession({
            callSid: providerCall.sid,
            params: {
              callSessionId: callSession._id.toString(),
              telephonyIntegrationId: telephony._id.toString(),
              leadId: lead._id.toString(),
              campaignId: campaign._id.toString(),
              aiCallerId: caller._id.toString(),
              agentName: caller.name || '',
              integrationId: integration._id.toString(),
              model: caller.s2sConfig?.model || 'gemini-3.1-flash-live-preview',
              temperature: String(caller.s2sConfig?.temperature ?? 0.8),
              voice: caller.s2sConfig?.voice || '',
              language: caller.s2sConfig?.language || '',
              thinkingLevel: caller.s2sConfig?.thinkingLevel || '',
              maxCallDuration: String(campaign.settings?.maxCallDuration || caller.guardrails?.maxCallDuration || ''),
            },
          }).catch((prewarmError) => {
            console.warn('[S2SCallingService] Gemini prewarm failed', {
              agentName: caller?.name || undefined,
              leadId: lead._id.toString(),
              callSid: providerCall.sid,
              source,
              message: prewarmError?.message,
            });
          });
        }
      } else if (provider === 'vobiz') {
        const authId = telephony.authConfig?.username;
        const authToken = telephony.authConfig?.password;
        if (!authId || !authToken) {
          const error = new Error('Vobiz configuration is incomplete (authId/authToken required)');
          error.statusCode = 400;
          throw error;
        }

        const answerParams = new URLSearchParams(voiceParams);
        const answerUrl = `${baseUrl}/api/telephony/vobiz/answer?${answerParams.toString()}`;
        const hangupUrl = `${baseUrl}/api/telephony/vobiz/hangup?${statusCallbackParams.toString()}`;

        console.log('[DEBUG] Vobiz answerUrl being sent:', answerUrl);

        providerCall = await vobizService.initiateCall({
          authId,
          authToken,
          to: toNumber,
          from: fromNumber,
          answerUrl,
          hangupUrl,
          apiBaseUrl: metadata.apiBaseUrl || 'https://api.vobiz.ai',
        });

        if (!isSttLlmTts) {
          vobizGeminiBridge.prewarmCallSession({
            callSessionId: callSession._id.toString(),
            params: {
              callSessionId: callSession._id.toString(),
              telephonyIntegrationId: telephony._id.toString(),
              leadId: lead._id.toString(),
              campaignId: campaign._id.toString(),
              aiCallerId: caller._id.toString(),
              agentName: caller.name || '',
              integrationId: integration._id.toString(),
              model: caller.s2sConfig?.model || 'gemini-3.1-flash-live-preview',
              temperature: String(caller.s2sConfig?.temperature ?? 0.8),
              voice: caller.s2sConfig?.voice || '',
              language: caller.s2sConfig?.language || '',
              thinkingLevel: caller.s2sConfig?.thinkingLevel || '',
              maxCallDuration: String(campaign.settings?.maxCallDuration || caller.guardrails?.maxCallDuration || ''),
            },
          }).catch((prewarmError) => {
            console.warn('[S2SCallingService] Vobiz Gemini prewarm failed', {
              agentName: caller?.name || undefined,
              leadId: lead._id.toString(),
              callSid: providerCall?.sid || providerCall?.callSid || '',
              source,
              message: prewarmError?.message,
            });
          });
        }
      }

      const normalizedProviderCallSid =
        providerCall?.sid ||
        providerCall?.callSid ||
        providerCall?.call_uuid ||
        providerCall?.raw?.call_uuid ||
        providerCall?.raw?.callId ||
        providerCall?.raw?.call_id ||
        '';

      await callSessionService.attachTwilioCallSid({
        callSessionId: callSession._id.toString(),
        callSid: normalizedProviderCallSid,
        initialStatus: providerCall?.status || 'queued',
        provider,
      });

      lead.status = 'calling';
      lead.lastCalledAt = new Date();
      lead.nextRetryAt = null;
      await lead.save();

      return {
        leadId: lead._id,
        campaignId: campaign._id,
        callSessionId: callSession._id,
        provider,
        callSid: normalizedProviderCallSid,
        status: providerCall?.status,
      };
    } catch (error) {
      if (callSession?._id) {
        await callSessionService
          .markSessionFailed({
            callSessionId: callSession._id.toString(),
            reason: `initiate-lead-call-failed: ${error?.message || 'unknown'}`,
          })
          .catch((sessionError) => {
            console.error('Failed to mark call session failed:', sessionError);
          });
      }

      throw error;
    }
  }
}

export default new S2SCallingService();
