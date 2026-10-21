import axios from 'axios';

const DEFAULT_VOBIZ_BASE_URL = 'https://api.vobiz.ai/api/v1';

class VobizService {
  getBaseUrl(apiBaseUrl = '') {
    let candidate = String(apiBaseUrl || process.env.VOBIZ_API_BASE_URL || DEFAULT_VOBIZ_BASE_URL).trim();
    candidate = candidate.replace(/\/+$/, '');
    if (candidate && !candidate.endsWith('/api/v1') && !candidate.endsWith('/v1') && (candidate.includes('api.vobiz.ai') || candidate.includes('vobiz.ai'))) {
      candidate = `${candidate}/api/v1`;
    }
    return candidate;
  }

  validateCredentials({ authId, authToken }) {
    if (!authId || !authToken) {
      throw new Error('Vobiz authId and authToken are required');
    }
  }

  getHeaders({ authId, authToken }) {
    this.validateCredentials({ authId, authToken });
    return {
      'Content-Type': 'application/json',
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken,
    };
  }

  extractCallId(payload = {}) {
    return (
      payload?.call_uuid ||
      payload?.callId ||
      payload?.call_id ||
      payload?.uuid ||
      payload?.id ||
      payload?.sid ||
      payload?.call?.call_uuid ||
      payload?.call?.uuid ||
      payload?.call?.id ||
      payload?.data?.call_uuid ||
      payload?.data?.callId ||
      payload?.data?.call_id ||
      payload?.response?.call_uuid ||
      payload?.response?.callId ||
      ''
    );
  }

  async initiateCall({
    authId,
    authToken,
    to,
    from,
    answerUrl,
    hangupUrl,
    apiBaseUrl,
  }) {
    if (!to || !from) {
      throw new Error('Vobiz call initiation requires to and from numbers');
    }

    if (!answerUrl || !hangupUrl) {
      throw new Error('Vobiz call initiation requires answerUrl and hangupUrl');
    }

    const baseUrl = this.getBaseUrl(apiBaseUrl);
    const endpoint = `${baseUrl}/Account/${encodeURIComponent(authId)}/Call/`;

    const payload = {
      from,
      to,
      answer_url: answerUrl,
      answer_method: 'POST',
      hangup_url: hangupUrl,
      hangup_method: 'POST',
    };

    console.log('[DEBUG] Vobiz API initiateCall payload:', JSON.stringify(payload, null, 2));

    try {
      const response = await axios.post(endpoint, payload, {
        headers: this.getHeaders({ authId, authToken }),
        timeout: 15000,
      });

      const responseData = response?.data || {};
      const sid = this.extractCallId(responseData);

      return {
        sid,
        status: String(responseData?.status || responseData?.call_status || 'queued').toLowerCase(),
        to: responseData?.to || to,
        from: responseData?.from || from,
        raw: responseData,
      };
    } catch (error) {
      console.error('[VobizService] Call initiation failed:', {
        url: endpoint,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  async startRecording({ authId, authToken, callUuid, apiBaseUrl }) {
    if (!callUuid) {
      console.warn('[VobizService] Cannot start recording: missing callUuid');
      return { success: false, reason: 'missing-call-uuid' };
    }

    const baseUrl = this.getBaseUrl(apiBaseUrl);
    const endpoint = `${baseUrl}/Account/${encodeURIComponent(authId)}/Call/${encodeURIComponent(callUuid)}/Record/`;

    try {
      const response = await axios.post(
        endpoint,
        {
          fileFormat: 'mp3',
          transcriptionType: 'auto',
        },
        {
          headers: this.getHeaders({ authId, authToken }),
          timeout: 10000,
        }
      );

      console.log('[VobizService] Recording started successfully for call:', callUuid);
      return { success: true, data: response?.data };
    } catch (error) {
      console.warn('[VobizService] Failed to start recording:', {
        callUuid,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  async validateConfig({ authId, authToken, apiBaseUrl }) {
    const baseUrl = this.getBaseUrl(apiBaseUrl);
    const endpoint = `${baseUrl}/Account/${encodeURIComponent(authId)}/Endpoint/`;

    try {
      await axios.get(endpoint, {
        headers: this.getHeaders({ authId, authToken }),
        timeout: 10000,
      });
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      if (status === 401) {
        throw new Error('Invalid Vobiz credentials');
      }
      throw new Error(`Vobiz connection test failed: ${error.message}`);
    }
  }

  async initiateTestCall({
    authId,
    authToken,
    to,
    from,
    answerUrl,
    hangupUrl,
    apiBaseUrl,
  }) {
    // For Vobiz, we first validate the config to ensure credentials are correct
    await this.validateConfig({ authId, authToken, apiBaseUrl });

    return this.initiateCall({
      authId,
      authToken,
      to,
      from,
      answerUrl,
      hangupUrl,
      apiBaseUrl,
    });
  }

  async hangupCall({
    authId,
    authToken,
    callUuid,
    apiBaseUrl,
  }) {
    if (!callUuid) {
      throw new Error('Vobiz hangup requires callUuid');
    }

    const baseUrl = this.getBaseUrl(apiBaseUrl);
    const endpoint = `${baseUrl}/Account/${encodeURIComponent(authId)}/Call/${encodeURIComponent(callUuid)}/`;

    await axios.delete(endpoint, {
      headers: this.getHeaders({ authId, authToken }),
      timeout: 15000,
    });

    return { success: true, callUuid };
  }
}

const vobizService = new VobizService();
export default vobizService;
