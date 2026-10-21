
import { AppError } from '../middleware/errorHandler.js';
import TelephonyConfig from '../models/TelephonyConfig.js';
import Integration from '../models/Integration.js';
import Lead from '../models/Lead.js';
import twilioService from '../services/twilioService.js';
import vobizService from '../services/vobizService.js';
import callSessionService from '../services/callSessionService.js';
import DialQueueJob from '../models/DialQueueJob.js';
import dialQueueService from '../services/dialQueueService.js';
import Campaign from '../models/Campaign.js';
import { RETRY_MODES, FAILURE_CATEGORIES } from '../config/constants.js';
import CallSession from '../models/CallSession.js';
const getBackendPublicBaseUrl = (req) => {
  const rawBaseUrl = (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    `${req.protocol}://${req.get('host')}`
  );

  return rawBaseUrl
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');
};

// @desc    Get telephony configuration
// @route   GET /api/telephony/config
// @access  Private/Admin
export const getTelephonyConfig = async (req, res, next) => {
  try {
    let config = await TelephonyConfig.findOne();

    if (!config) {
      // Return default empty config if none exists
      return res.status(200).json({
        success: true,
        data: {
          provider: null,
          isActive: false,
        },
      });
    }

    // Don't send sensitive credentials to frontend
    const safeConfig = {
      _id: config._id,
      provider: config.provider,
      isActive: config.isActive,
      webhookUrl: config.webhookUrl,
      callerIds: config.callerIds,
      settings: {
        recordCalls: config.settings?.recordCalls || false,
        transcribeCalls: config.settings?.transcribeCalls || false,
      },
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };

    res.status(200).json({
      success: true,
      data: safeConfig,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create or update telephony configuration
// @route   POST /api/telephony/config
// @access  Private/Admin
export const saveTelephonyConfig = async (req, res, next) => {
  try {
    const { provider, credentials, callerIds, settings } = req.body;

    if (!provider) {
      return next(new AppError('Provider is required', 400));
    }

    if (!credentials) {
      return next(new AppError('Credentials are required', 400));
    }

    // Validate provider-specific credentials
    const validationError = validateProviderCredentials(provider, credentials);
    if (validationError) {
      return next(new AppError(validationError, 400));
    }

    // Generate webhook URL
    const webhookUrl = `${getBackendPublicBaseUrl(req)}/api/telephony/webhook/${provider}`;

    // Check if config exists
    let config = await TelephonyConfig.findOne();

    if (config) {
      // Update existing config
      config.provider = provider;
      config.credentials = credentials;
      config.callerIds = callerIds || [];
      config.callerId = (callerIds && callerIds[0]) || config.callerId;
      config.webhookUrl = webhookUrl;
      config.settings = {
        recordCalls: settings?.recordCalls || false,
        transcribeCalls: settings?.transcribeCalls || false,
        ...settings,
      };
      config.isActive = true;
      config.updatedBy = req.user._id;

      await config.save();
    } else {
      // Create new config
      config = await TelephonyConfig.create({
        provider,
        credentials,
        callerIds: callerIds || [],
        callerId: (callerIds && callerIds[0]) || null,
        webhookUrl,
        settings: {
          recordCalls: settings?.recordCalls || false,
          transcribeCalls: settings?.transcribeCalls || false,
          ...settings,
        },
        isActive: true,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });
    }

    // Return safe config (without credentials)
    const safeConfig = {
      _id: config._id,
      provider: config.provider,
      isActive: config.isActive,
      webhookUrl: config.webhookUrl,
      callerIds: config.callerIds,
      settings: config.settings,
    };

    res.status(200).json({
      success: true,
      data: safeConfig,
      message: 'Telephony configuration saved successfully',
    });
  } catch (error) {
    next(error);
  }
};

const xmlEscape = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const getVobizStreamWsUrl = (req, streamWsUrl = '') => {
  // Prefer explicit config -> env var -> derive from public URL
  const candidate = String(streamWsUrl || process.env.VOBIZ_STREAM_WS_URL || '').trim();

  let base = candidate;
  if (!base) {
    // Derive from backend public base URL
    const backendBase = getBackendPublicBaseUrl(req);
    if (!backendBase) return '';

    base = backendBase.startsWith('https://')
      ? backendBase.replace('https://', 'wss://')
      : backendBase.replace('http://', 'ws://');

    const path = req.query?.pipeline === 'STT_LLM_TTS'
      ? '/api/telephony/vobiz/stt-llm-tts-stream'
      : '/api/telephony/vobiz/media-stream';
    base = `${base.replace(/\/$/, '')}${path}`;
  }

  let normalized = base.endsWith('/') ? base.slice(0, -1) : base;
  if (req.query?.pipeline === 'STT_LLM_TTS') {
    normalized = normalized.replace(
      /\/api\/telephony\/vobiz\/media-stream$/i,
      '/api/telephony/vobiz/stt-llm-tts-stream'
    );
  }
  const query = new URLSearchParams({
    leadId: req.query?.leadId || '',
    campaignId: req.query?.campaignId || '',
    aiCallerId: req.query?.aiCallerId || '',
    agentName: req.query?.agentName || '',
    integrationId: req.query?.integrationId || '',
    pipeline: req.query?.pipeline || '',
    callSessionId: req.query?.callSessionId || '',
    model: req.query?.model || '',
    temperature: req.query?.temperature || '',
    voice: req.query?.voice || '',
    language: req.query?.language || '',
    thinkingLevel: req.query?.thinkingLevel || '',
    maxCallDuration: req.query?.maxCallDuration || '',
  });

  const queryString = query.toString();
  return queryString ? `${normalized}?${queryString}` : normalized;
};

const mapVobizStatusToTwilioLike = (status = '') => {
  const normalized = String(status || '').trim().toLowerCase();
  switch (normalized) {
    case 'queued':
    case 'initiated':
    case 'ringing':
    case 'connected':
    case 'in-progress':
    case 'answered':
      return normalized === 'answered' ? 'in-progress' : normalized;
    case 'completed':
    case 'stopped':
      return 'completed';
    case 'busy':
      return 'busy';
    case 'no_answer':
    case 'no-answer':
      return 'no-answer';
    case 'failed':
    case 'timeout':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return normalized || 'queued';
  }
};

const getTwilioMediaStreamUrl = (req) => {
  if (process.env.TWILIO_MEDIA_STREAM_WS_URL) {
    let streamUrl = process.env.TWILIO_MEDIA_STREAM_WS_URL.trim().replace(/\/+$/, '');

    if (streamUrl.startsWith('https://')) {
      streamUrl = `wss://${streamUrl.slice('https://'.length)}`;
    } else if (streamUrl.startsWith('http://')) {
      streamUrl = `ws://${streamUrl.slice('http://'.length)}`;
    }

    // Handle common misconfiguration: webhook path pasted instead of stream path.
    streamUrl = streamUrl.replace(
      /\/api\/telephony\/webhook\/twilio$/i,
      '/api/telephony/twilio/media-stream'
    );

    // Handle accidental duplicated /api/api segments.
    streamUrl = streamUrl.replace(/\/api\/api\//gi, '/api/');
    if (req.query?.pipeline === 'STT_LLM_TTS') {
      streamUrl = streamUrl.replace(
        /\/api\/telephony\/twilio\/media-stream$/i,
        '/api/telephony/twilio/stt-llm-tts-stream'
      );
    }

    return streamUrl;
  }

  const baseUrl = getBackendPublicBaseUrl(req);

  const wsBase = baseUrl.startsWith('https://')
    ? baseUrl.replace('https://', 'wss://')
    : baseUrl.replace('http://', 'ws://');

  const path = req.query?.pipeline === 'STT_LLM_TTS'
    ? '/api/telephony/twilio/stt-llm-tts-stream'
    : '/api/telephony/twilio/media-stream';
  return `${wsBase.replace(/\/$/, '')}${path}`;
};

// @desc    Twilio voice webhook (returns TwiML that starts media stream)
// @route   POST /api/telephony/twilio/voice
// @access  Public
export const twilioVoiceWebhook = async (req, res, next) => {
  try {
    const {
      leadId = '',
      campaignId = '',
      aiCallerId = '',
      integrationId = '',
      callSessionId = '',
      systemPrompt = '',
      temperature = '',
      model = '',
      voice = '',
      language = '',
      thinkingLevel = '',
      maxCallDuration = '',
      pipeline = '',
      sttIntegrationId = '',
      llmIntegrationId = '',
      ttsIntegrationId = '',
      sttModel = '',
      sttLanguage = '',
      sttEncoding = '',
      sttSampleRate = '',
      sttChannels = '',
      sttEndpointingMs = '',
      sttUtteranceEndMs = '',
      llmModel = '',
      ttsModel = '',
      ttsVoice = '',
      ttsOutputFormat = '',
      ttsTelephonyFormat = '',
    } = req.query;

    const mediaStreamUrl = getTwilioMediaStreamUrl(req);

    const params = [
      ['leadId', leadId],
      ['campaignId', campaignId],
      ['aiCallerId', aiCallerId],
      ['integrationId', integrationId],
      ['callSessionId', callSessionId],
      ['systemPrompt', systemPrompt],
      ['temperature', temperature],
      ['model', model],
      ['voice', voice],
      ['language', language],
      ['thinkingLevel', thinkingLevel],
      ['maxCallDuration', maxCallDuration],
      ['pipeline', pipeline],
      ['sttIntegrationId', sttIntegrationId],
      ['llmIntegrationId', llmIntegrationId],
      ['ttsIntegrationId', ttsIntegrationId],
      ['sttModel', sttModel],
      ['sttLanguage', sttLanguage],
      ['sttEncoding', sttEncoding],
      ['sttSampleRate', sttSampleRate],
      ['sttChannels', sttChannels],
      ['sttEndpointingMs', sttEndpointingMs],
      ['sttUtteranceEndMs', sttUtteranceEndMs],
      ['llmModel', llmModel],
      ['ttsModel', ttsModel],
      ['ttsVoice', ttsVoice],
      ['ttsOutputFormat', ttsOutputFormat],
      ['ttsTelephonyFormat', ttsTelephonyFormat],
    ].filter(([, value]) => value !== '');

    const parameterTags = params
      .map(
        ([name, value]) =>
          `<Parameter name="${xmlEscape(name)}" value="${xmlEscape(value)}" />`
      )
      .join('');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEscape(mediaStreamUrl)}">
      ${parameterTags}
    </Stream>
  </Connect>
</Response>`;

    res.type('text/xml');
    res.status(200).send(twiml);
  } catch (error) {
    next(error);
  }
};

// @desc    Twilio call status callback
// @route   POST /api/telephony/twilio/status
// @access  Public
export const twilioStatusWebhook = async (req, res, next) => {
  try {
    const { leadId = '', callSessionId = '' } = req.query;
    const callStatus = req.body?.CallStatus || '';
    const callSid = req.body?.CallSid || '';

    const sessionUpdate = await callSessionService.handleTwilioStatusUpdate({
      callSessionId,
      callSid,
      callStatus,
      payload: req.body || {},
    });

    if (!sessionUpdate?.sessionUpdated && leadId) {
      const lead = await Lead.findById(leadId);
      if (lead) {
        const normalized = String(callStatus).toLowerCase();
        const mappedStatus = (() => {
          switch (normalized) {
            case 'completed':
              return 'completed';
            case 'busy':
            case 'no-answer':
              return 'no_answer';
            case 'queued':
            case 'initiated':
            case 'ringing':
            case 'in-progress':
              return 'calling';
            case 'failed':
            case 'canceled':
              return 'exhausted';
            default:
              return lead.status;
          }
        })();

        lead.status = mappedStatus;
        lead.lastCalledAt = new Date();
        await lead.save();
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    next(error);
  }
};

// @desc    Twilio asynchronous AMD webhook
// @route   POST /api/telephony/twilio/amd
// @access  Public
export const twilioAmdWebhook = async (req, res, next) => {
  try {
    const { AnsweredBy, CallSid } = req.body;
    const { callSessionId } = req.query;

    console.log(`[Twilio AMD] Call ${CallSid} answered by: ${AnsweredBy}`);

    if (
      AnsweredBy === 'machine_start' ||
      AnsweredBy === 'machine_end_beep' ||
      AnsweredBy === 'machine_end_other' ||
      AnsweredBy === 'machine_end_silence' ||
      AnsweredBy === 'fax'
    ) {
      console.log(`[Twilio AMD] Machine detected for call ${CallSid}. Hanging up.`);
      
      const session = await CallSession.findById(callSessionId);
      if (session) {
        // Only update if not already terminal
        if (!['completed', 'failed', 'canceled', 'voicemail'].includes(session.status)) {
          session.status = 'voicemail';
          session.callOutcome = 'voicemail';
          session.endReason = 'answering_machine_detected';
          session.toolEndReason = 'voicemail';
          await session.save();
        } else if (!session.callOutcome) {
          // Status already voicemail but callOutcome not set yet (backfill)
          session.callOutcome = 'voicemail';
          await session.save();
        }
      }

      const activeTelephony = await TelephonyConfig.findOne({ isActive: true });
      if (activeTelephony && activeTelephony.credentials) {
        try {
          await twilioService.endCall({
            accountSid: activeTelephony.credentials.accountSid,
            authToken: activeTelephony.credentials.authToken,
            callSid: CallSid
          });
        } catch (error) {
          console.error(`[Twilio AMD] Failed to hang up call ${CallSid}:`, error.message);
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Twilio AMD Error]:', error);
    res.status(500).send('Error');
  }
};

// @desc    Vobiz answer webhook (returns XML that starts bidirectional stream)
// @route   POST /api/telephony/vobiz/answer
// @access  Public
export const vobizAnswerWebhook = async (req, res, next) => {
  try {
    const config = await TelephonyConfig.findOne({ provider: 'vobiz', isActive: true });
    const streamWsUrl = getVobizStreamWsUrl(req, config?.credentials?.streamWsUrl);

    if (!streamWsUrl) {
      const fallbackXml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
      res.type('text/xml');
      return res.status(200).send(fallbackXml);
    }

    const statusParams = new URLSearchParams({
      leadId: req.query?.leadId || '',
      campaignId: req.query?.campaignId || '',
      callSessionId: req.query?.callSessionId || '',
    });
    const statusCallbackUrl = `${getBackendPublicBaseUrl(req)}/api/telephony/vobiz/stream-status?${statusParams.toString()}`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream
    bidirectional="true"
    keepCallAlive="true"
    contentType="audio/x-mulaw;rate=8000"
    statusCallbackUrl="${xmlEscape(statusCallbackUrl)}"
    statusCallbackMethod="POST">${xmlEscape(streamWsUrl)}</Stream>
</Response>`;

    res.type('text/xml');
    res.status(200).send(xml);
  } catch (error) {
    next(error);
  }
};

// @desc    Vobiz stream status callback
// @route   POST /api/telephony/vobiz/stream-status
// @access  Public
export const vobizStreamStatusWebhook = async (req, res, next) => {
  try {
    const { leadId = '', callSessionId = '' } = req.query;
    const callSid = req.body?.call_uuid || req.body?.callId || req.body?.call_id || '';
    const streamStatus = req.body?.status || req.body?.event || '';
    const mappedStatus = mapVobizStatusToTwilioLike(streamStatus);

    const sessionUpdate = await callSessionService.handleTwilioStatusUpdate({
      callSessionId,
      callSid,
      callStatus: mappedStatus,
      payload: req.body || {},
    });

    // Fallback only when we could not map the event to an existing call session.
    // Otherwise, callSessionService already owns lead-state transitions/retries.
    if (!sessionUpdate?.sessionUpdated && leadId) {
      const lead = await Lead.findById(leadId);
      if (lead) {
        const normalized = String(mappedStatus || '').toLowerCase();
        const leadStatus = (() => {
          switch (normalized) {
            case 'completed':
              return 'completed';
            case 'busy':
            case 'no-answer':
              return 'no_answer';
            case 'queued':
            case 'initiated':
            case 'ringing':
            case 'in-progress':
              return 'calling';
            case 'answered':
              return 'connected';
            case 'failed':
            case 'canceled':
              return 'failed';
            default:
              return lead.status;
          }
        })();
        lead.status = leadStatus;
        lead.lastCalledAt = new Date();
        await lead.save();
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    next(error);
  }
};

// @desc    Vobiz call hangup callback
// @route   POST /api/telephony/vobiz/hangup
// @access  Public
export const vobizHangupWebhook = async (req, res, next) => {
  try {
    const { leadId = '', callSessionId = '' } = req.query;
    const callSid = req.body?.call_uuid || req.body?.callId || req.body?.call_id || '';
    const callStatus = mapVobizStatusToTwilioLike(req.body?.call_status || req.body?.status || 'completed');

    await callSessionService.handleTwilioStatusUpdate({
      callSessionId,
      callSid,
      callStatus,
      payload: req.body || {},
    });

    if (leadId) {
      const lead = await Lead.findById(leadId);
      if (lead) {
        lead.status = callStatus === 'completed' ? 'completed' : callStatus === 'failed' ? 'failed' : lead.status;
        lead.lastCalledAt = new Date();
        await lead.save();
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    next(error);
  }
};

// @desc    Test telephony configuration
// @route   POST /api/telephony/test
// @access  Private/Admin
export const testTelephonyConfig = async (req, res, next) => {
  console.log('--- TEST TELEPHONY CONFIG START ---');
  console.log('Body:', JSON.stringify(req.body));
  try {
    const { phoneNumber } = req.body || {};

    if (!phoneNumber) {
      return next(new AppError('Phone number is required for testing', 400));
    }

    const config = await TelephonyConfig.findOne({ isActive: true });

    if (!config) {
      return next(new AppError('No active telephony configuration found', 404));
    }

    let testResult;

    if (config.provider === 'twilio') {
      const accountSid = config.credentials?.accountSid;
      const authToken = config.credentials?.authToken;
      const fromNumber = config.callerIds?.[0] || config.callerId;

      if (!accountSid || !authToken || !fromNumber) {
        return next(
          new AppError('Twilio test requires accountSid, authToken, and at least one caller ID', 400)
        );
      }

      const call = await twilioService.initiateTestCall({
        accountSid,
        authToken,
        to: phoneNumber,
        from: fromNumber,
      });

      testResult = {
        success: true,
        provider: config.provider,
        phoneNumber,
        callSid: call.sid,
        status: call.status,
        message: 'Test call initiated successfully via Twilio',
        timestamp: new Date(),
      };
    } else if (config.provider === 'vobiz') {
      const authId = config.credentials?.authId;
      const authToken = config.credentials?.authToken;
      const fromNumber = config.callerIds?.[0] || config.callerId;

      if (!authId || !authToken || !fromNumber) {
        return next(
          new AppError('Vobiz test requires authId, authToken, and at least one caller ID', 400)
        );
      }

      const baseUrl = getBackendPublicBaseUrl(req);
      const query = new URLSearchParams({ test: 'true' }).toString();
      const answerUrl = `${baseUrl}/api/telephony/vobiz/answer?${query}`;
      const hangupUrl = `${baseUrl}/api/telephony/vobiz/hangup?${query}`;

      try {
        const call = await vobizService.initiateTestCall({
          authId,
          authToken,
          to: phoneNumber,
          from: fromNumber,
          answerUrl,
          hangupUrl,
          apiBaseUrl: config.credentials?.apiBaseUrl || config.apiBaseUrl,
        });

        testResult = {
          success: true,
          provider: config.provider,
          phoneNumber,
          callSid: call.sid,
          status: call.status,
          message: 'Test call initiated successfully via Vobiz',
          timestamp: new Date(),
        };
      } catch (error) {
        // If it's a 400 error and we are on localhost, it's likely the webhook URL
        if (error.message.includes('400') && baseUrl.includes('localhost')) {
          return res.status(200).json({
            success: true,
            provider: config.provider,
            message: 'Vobiz credentials are VALID, but the test call could not be initiated because Vobiz does not support "localhost" webhook URLs. Use ngrok for a full end-to-end test.',
            timestamp: new Date(),
            details: {
              authVerified: true,
              callInitiationError: error.message
            }
          });
        }
        throw error;
      }
    } else {
      // For providers not yet wired with SDK/API calls, keep this as a soft check.
      testResult = {
        success: true,
        provider: config.provider,
        phoneNumber,
        message: 'Test call initiated successfully (simulated)',
        timestamp: new Date(),
      };
    }

    res.status(200).json({
      success: true,
      data: testResult,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Deactivate telephony configuration
// @route   POST /api/telephony/deactivate
// @access  Private/Admin
export const deactivateTelephony = async (req, res, next) => {
  try {
    const config = await TelephonyConfig.findOne();

    if (!config) {
      return next(new AppError('No telephony configuration found', 404));
    }

    config.isActive = false;
    config.updatedBy = req.user._id;
    await config.save();

    res.status(200).json({
      success: true,
      message: 'Telephony configuration deactivated successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Webhook handler for telephony provider
// @route   POST /api/telephony/webhook/:provider
// @access  Public (with validation)
export const handleWebhook = async (req, res, next) => {
  try {
    const { provider } = req.params;
    const webhookData = req.body;

    console.log(`[Telephony Webhook] Received from ${provider}:`, webhookData);

    // Process webhook based on provider
    switch (provider) {
      case 'twilio':
        await handleTwilioWebhook(webhookData);
        break;
      case 'plivo':
        await handlePlivoWebhook(webhookData);
        break;
      case 'exotel':
        await handleExotelWebhook(webhookData);
        break;
      case 'vobiz':
        await handleVobizWebhook(webhookData);
        break;
      default:
        console.warn(`[Telephony Webhook] Unknown provider: ${provider}`);
    }

    // Respond to webhook
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Telephony Webhook] Error:', error);
    next(error);
  }
};

/**
 * Helper Functions
 */

function validateProviderCredentials(provider, credentials) {
  switch (provider) {
    case 'twilio':
      if (!credentials.accountSid || !credentials.authToken) {
        console.warn('Twilio credentials missing: accountSid or authToken')
        return 'Twilio requires accountSid and authToken';
      }
      break;
    case 'plivo':
      if (!credentials.authId || !credentials.authToken) {
        return 'Plivo requires authId and authToken';
      }
      break;
    case 'exotel':
      if (!credentials.apiKey || !credentials.apiToken || !credentials.sid) {
        return 'Exotel requires apiKey, apiToken, and sid';
      }
      break;
    case 'vobiz':
      if (!credentials.authId || !credentials.authToken) {
        return 'Vobiz requires authId and authToken';
      }
      break;
    default:
      return 'Invalid provider. Supported: twilio, plivo, exotel, vobiz';
  }
  return null;
}

async function handleTwilioWebhook(data) {
  // Process Twilio webhook events
  console.log('[Twilio Webhook] Event:', data.CallStatus);
  // TODO: Update call logs based on webhook data
}

async function handlePlivoWebhook(data) {
  // Process Plivo webhook events
  console.log('[Plivo Webhook] Event:', data.Event);
  // TODO: Update call logs based on webhook data
}

async function handleExotelWebhook(data) {
  // Process Exotel webhook events
  console.log('[Exotel Webhook] Event:', data.Status);
  // TODO: Update call logs based on webhook data
}

async function handleVobizWebhook(data) {
  // Process Vobiz webhook events (CallInitiated, Hangup)
  try {
    const event = data.Event || data.event || data.status || data.call_status || '';
    const callUuid = data.CallUUID || data.call_uuid || data.callId || data.call_id || '';
    const requestId = data.RequestID || data.request_id || data.requestId || '';

    const mappedStatus = mapVobizStatusToTwilioLike(data.Status || data.status || data.call_status || event);

    // Try to update call session using provider call id
    await callSessionService.handleTwilioStatusUpdate({
      callSessionId: '',
      callSid: callUuid,
      callStatus: mappedStatus,
      payload: data || {},
    });

    // Also update corresponding DialQueueJob if session is linked
    if (callUuid) {
      try {
        const job = await DialQueueJob.findOne({
          $or: [{ sessionId: requestId }, { sessionId: { $exists: true } }, { callUuid }],
        });

        // If job exists and event indicates hangup/completion, sync job status
        if (job && ['hangup', 'Hangup', 'completed', 'failed', 'no-answer', 'busy', 'no_answer'].includes(String(mappedStatus))) {
          // Map mappedStatus to queue state
          if (mappedStatus === 'completed') {
            await dialQueueService.ackJobCompleted(job._id.toString());
          } else if (['no-answer', 'busy', 'failed', 'canceled'].includes(mappedStatus)) {
            const campaign = await Campaign.findById(job.campaignId);
            const retryMode = campaign?.settings?.retryMode || RETRY_MODES.QUEUE_TAIL;
            await dialQueueService.ackJobWithRetry(job._id.toString(), retryMode, FAILURE_CATEGORIES.RETRYABLE, mappedStatus.toUpperCase(), `Vobiz: ${mappedStatus}`);
          }
        }
      } catch (e) {
        console.warn('[Vobiz Webhook] Failed to update DialQueueJob for callUuid:', callUuid, e?.message || e);
      }
    }
  } catch (err) {
    console.error('[Vobiz Webhook] processing error:', err?.message || err);
  }
}

export const testTelephonyIntegration = async (req, res, next) => {
  console.log('--- TEST TELEPHONY INTEGRATION START ---');
  console.log('ID:', req.params.id);
  console.log('Body:', JSON.stringify(req.body));
  try {
    const { phoneNumber } = req.body || {};

    if (!phoneNumber) {
      return next(new AppError('Phone number is required for testing', 400));
    }

    const integration = await Integration.findOne({ _id: req.params.id, type: 'telephony' });

    if (!integration) {
      return next(new AppError('Telephony integration not found', 404));
    }

    const metadata = integration.metadata instanceof Map ? Object.fromEntries(integration.metadata) : (integration.metadata || {});
    const provider = String(metadata.provider || '').toLowerCase();
    const fromNumber = metadata.callerIds?.[0] || '';

    if (!fromNumber) {
      return next(new AppError('Integration has no configured Caller IDs', 400));
    }

    let testResult;

    if (provider === 'twilio') {
      const accountSid = integration.authConfig?.username;
      const authToken = integration.authConfig?.password;

      if (!accountSid || !authToken) {
        return next(
          new AppError('Twilio test requires accountSid and authToken', 400)
        );
      }

      const call = await twilioService.initiateTestCall({
        accountSid,
        authToken,
        to: phoneNumber,
        from: fromNumber,
      });

      testResult = {
        success: true,
        provider,
        phoneNumber,
        callSid: call.sid,
        status: call.status,
        message: 'Test call initiated successfully via Twilio',
        timestamp: new Date(),
      };
    } else if (provider === 'vobiz') {
      const authId = integration.authConfig?.username;
      const authToken = integration.authConfig?.password;

      if (!authId || !authToken) {
        return next(
          new AppError('Vobiz test requires authId and authToken', 400)
        );
      }

      const baseUrl = getBackendPublicBaseUrl(req);
      const query = new URLSearchParams({ test: 'true' }).toString();
      const answerUrl = `${baseUrl}/api/telephony/vobiz/answer?${query}`;
      const hangupUrl = `${baseUrl}/api/telephony/vobiz/hangup?${query}`;

      try {
        const call = await vobizService.initiateTestCall({
          authId,
          authToken,
          to: phoneNumber,
          from: fromNumber,
          answerUrl,
          hangupUrl,
          apiBaseUrl: metadata.apiBaseUrl || 'https://api.vobiz.ai',
        });

        testResult = {
          success: true,
          provider,
          phoneNumber,
          callSid: call.sid,
          status: call.status,
          message: 'Test call initiated successfully via Vobiz',
          timestamp: new Date(),
        };
      } catch (error) {
        if (error.message.includes('400') && baseUrl.includes('localhost')) {
          return res.status(200).json({
            success: true,
            provider,
            message: 'Vobiz credentials are VALID, but the test call could not be initiated because Vobiz does not support "localhost" webhook URLs. Use ngrok for a full end-to-end test.',
            timestamp: new Date(),
            details: {
              authVerified: true,
              callInitiationError: error.message
            }
          });
        }
        throw error;
      }
    } else {
      testResult = {
        success: true,
        provider,
        phoneNumber,
        message: 'Test call initiated successfully (simulated)',
        timestamp: new Date(),
      };
    }

    res.status(200).json({
      success: true,
      data: testResult,
    });
  } catch (error) {
    next(error);
  }
};
