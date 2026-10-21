import twilio from 'twilio';

class TwilioService {
  static xmlEscape(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  createClient({ accountSid, authToken }) {
    if (!accountSid || !authToken) {
      throw new Error('Twilio accountSid and authToken are required');
    }
    return twilio(accountSid, authToken);
  }

  async initiateCall({
    accountSid,
    authToken,
    to,
    from,
    voiceWebhookUrl,
    statusCallbackUrl,
    machineDetection,
    asyncAmd,
    asyncAmdStatusCallback,
    asyncAmdStatusCallbackMethod,
  }) {
    const client = this.createClient({ accountSid, authToken });

    const params = {
      to,
      from,
      url: voiceWebhookUrl,
      method: 'POST',
      statusCallback: statusCallbackUrl,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    };

    if (machineDetection) {
      params.machineDetection = machineDetection;
      if (asyncAmd) {
        params.asyncAmd = asyncAmd;
      }
      if (asyncAmdStatusCallback) {
        params.asyncAmdStatusCallback = asyncAmdStatusCallback;
      }
      if (asyncAmdStatusCallbackMethod) {
        params.asyncAmdStatusCallbackMethod = asyncAmdStatusCallbackMethod;
      }
    }

    const call = await client.calls.create(params);

    return {
      sid: call.sid,
      status: call.status,
      to: call.to,
      from: call.from,
    };
  }

  async initiateTestCall({
    accountSid,
    authToken,
    to,
    from,
    message = 'This is a test call from your AI calling platform Twilio configuration.',
  }) {
    const client = this.createClient({ accountSid, authToken });
    const twiml = `<Response><Say>${TwilioService.xmlEscape(message)}</Say></Response>`;

    const call = await client.calls.create({
      to,
      from,
      twiml,
    });

    return {
      sid: call.sid,
      status: call.status,
      to: call.to,
      from: call.from,
    };
  }

  async endCall({ accountSid, authToken, callSid }) {
    if (!callSid) {
      throw new Error('callSid is required to end a call');
    }

    const client = this.createClient({ accountSid, authToken });
    const call = await client.calls(callSid).update({ status: 'completed' });

    return {
      sid: call.sid,
      status: call.status,
    };
  }

  async listCalls({
    accountSid,
    authToken,
    status,
    startTimeAfter,
    startTimeBefore,
    limit = 50,
  }) {
    const client = this.createClient({ accountSid, authToken });
    const query = {
      limit: Math.min(Math.max(Number(limit) || 50, 1), 1000),
    };

    if (status) {
      query.status = status;
    }
    if (startTimeAfter instanceof Date && !Number.isNaN(startTimeAfter.getTime())) {
      query.startTimeAfter = startTimeAfter;
    }
    if (startTimeBefore instanceof Date && !Number.isNaN(startTimeBefore.getTime())) {
      query.startTimeBefore = startTimeBefore;
    }

    return client.calls.list(query);
  }

  async getCall({ accountSid, authToken, callSid }) {
    if (!callSid) {
      throw new Error('callSid is required to fetch call details');
    }

    const client = this.createClient({ accountSid, authToken });
    return client.calls(callSid).fetch();
  }

  async listRecordings({ accountSid, authToken, callSid, limit = 1 }) {
    if (!callSid) {
      return [];
    }

    const client = this.createClient({ accountSid, authToken });
    const recordings = await client.recordings.list({
      callSid,
      limit: Math.min(Math.max(Number(limit) || 1, 1), 20),
    });

    return recordings.map((recording) => {
      const baseUri = String(recording.uri || '').replace('.json', '');
      const mediaUrl = baseUri
        ? `https://api.twilio.com${baseUri}.mp3`
        : '';

      return {
        sid: recording.sid,
        status: recording.status,
        duration: recording.duration,
        mediaUrl,
      };
    });
  }
}

const twilioService = new TwilioService();
export default twilioService;
