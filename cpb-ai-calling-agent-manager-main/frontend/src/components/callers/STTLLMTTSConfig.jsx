import { useEffect, useMemo, useState } from 'react';
import axios from '../../utils/axios';

const DEFAULTS = {
  sttModel: 'nova-3',
  sttLanguage: 'en-US',
  sttEncoding: 'linear16',
  sttSampleRate: 16000,
  sttChannels: 1,
  sttEndpointingMs: 800,
  sttUtteranceEndMs: 1000,
  ttsOutputFormat: 'pcm_16000',
  ttsTelephonyFormat: 'mulaw_8000',
};

const integrationProvider = (integration) => {
  const metadata = integration?.metadata || {};
  return String(metadata.provider || integration?.name || '').toLowerCase();
};

const STTLLMTTSConfig = ({ config, onChange }) => {
  const [integrations, setIntegrations] = useState({ stt: [], llm: [], tts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [stt, llm, tts] = await Promise.all([
          axios.get('/integrations/active/stt'),
          axios.get('/integrations/active/llm'),
          axios.get('/integrations/active/tts'),
        ]);
        if (!cancelled) {
          setIntegrations({
            stt: stt.data.data || [],
            llm: llm.data.data || [],
            tts: tts.data.data || [],
          });
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError.response?.data?.message || 'Unable to load voice integrations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (changes) => onChange({ ...DEFAULTS, ...config, ...changes });
  const selected = {
    stt: integrations.stt.find((item) => String(item._id) === String(config.sttIntegrationId)),
    llm: integrations.llm.find((item) => String(item._id) === String(config.llmIntegrationId)),
    tts: integrations.tts.find((item) => String(item._id) === String(config.ttsIntegrationId)),
  };
  const sttOptions = useMemo(
    () => integrations.stt.filter((item) => /deepgram/i.test(integrationProvider(item))),
    [integrations.stt]
  );
  const ttsOptions = useMemo(
    () => integrations.tts.filter((item) => /elevenlabs/i.test(integrationProvider(item))),
    [integrations.tts]
  );
  const llmModels = useMemo(() => {
    const models = selected.llm?.availableModels || [];
    const values = models.map((model) => model.id || model).filter(Boolean);
    if (config.llmModel && !values.includes(config.llmModel)) values.unshift(config.llmModel);
    return values;
  }, [config.llmModel, selected.llm]);
  const ttsModels = useMemo(() => {
    const models = selected.tts?.availableModels || [];
    const values = models.map((model) => model.id || model).filter(Boolean);
    if (config.ttsModel && !values.includes(config.ttsModel)) values.unshift(config.ttsModel);
    return values;
  }, [config.ttsModel, selected.tts]);
  const ttsVoices = useMemo(() => {
    const voices = (selected.tts?.availableVoices || []).map((voice) => voice.id || voice).filter(Boolean);
    if (config.ttsVoice && !voices.includes(config.ttsVoice)) voices.unshift(config.ttsVoice);
    return voices;
  }, [config.ttsVoice, selected.tts]);

  const selectIntegration = (field, value, list, defaults = {}) => {
    const integration = list.find((item) => String(item._id) === value);
    update({ [field]: value, ...defaults });
    return integration;
  };

  if (loading) return <p className="text-sm text-gray-500">Loading STT, LLM, and TTS integrations...</p>;

  return (
    <div className="space-y-5">
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
        Provider credentials are managed by administrators and are never shown or sent from this form.
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Deepgram STT integration *</label>
        <select
          value={config.sttIntegrationId || ''}
          onChange={(event) => selectIntegration('sttIntegrationId', event.target.value, sttOptions, { sttModel: 'nova-3' })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="">Select Deepgram integration</option>
          {sttOptions.map((integration) => <option key={integration._id} value={integration._id}>{integration.name}</option>)}
        </select>
        {!sttOptions.length && <p className="mt-1 text-xs text-amber-700">Add an active Deepgram integration in Admin → Integrations → STT.</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm text-gray-700">
          STT model
          <input value={config.sttModel || 'nova-3'} onChange={(event) => update({ sttModel: event.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
        </label>
        <label className="text-sm text-gray-700">
          STT language
          <input value={config.sttLanguage || 'en-US'} onChange={(event) => update({ sttLanguage: event.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
        </label>
        <label className="text-sm text-gray-700">
          Endpointing (ms)
          <input type="number" min="0" value={config.sttEndpointingMs ?? 800} onChange={(event) => update({ sttEndpointingMs: Number(event.target.value) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
        </label>
        <label className="text-sm text-gray-700">
          Utterance end (ms)
          <input type="number" min="0" value={config.sttUtteranceEndMs ?? 1000} onChange={(event) => update({ sttUtteranceEndMs: Number(event.target.value) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">LLM provider and integration *</label>
        <select
          value={config.llmIntegrationId || ''}
          onChange={(event) => selectIntegration('llmIntegrationId', event.target.value, integrations.llm)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="">Select LLM integration</option>
          {integrations.llm.map((integration) => <option key={integration._id} value={integration._id}>{integration.name} ({integrationProvider(integration)})</option>)}
        </select>
      </div>
      <label className="block text-sm text-gray-700">
        LLM model *
        {llmModels.length ? (
          <select value={config.llmModel || ''} onChange={(event) => update({ llmModel: event.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md">
            <option value="">Select model</option>
            {llmModels.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        ) : (
          <input value={config.llmModel || ''} onChange={(event) => update({ llmModel: event.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Configured model name" />
        )}
      </label>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">ElevenLabs TTS integration *</label>
        <select
          value={config.ttsIntegrationId || ''}
          onChange={(event) => selectIntegration('ttsIntegrationId', event.target.value, ttsOptions)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="">Select ElevenLabs integration</option>
          {ttsOptions.map((integration) => <option key={integration._id} value={integration._id}>{integration.name}</option>)}
        </select>
        {!ttsOptions.length && <p className="mt-1 text-xs text-amber-700">Add an active ElevenLabs integration in Admin → Integrations → TTS.</p>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm text-gray-700">
          TTS model *
          {ttsModels.length ? (
            <select value={config.ttsModel || ''} onChange={(event) => update({ ttsModel: event.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Select model</option>
              {ttsModels.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          ) : (
            <input value={config.ttsModel || ''} onChange={(event) => update({ ttsModel: event.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="eleven_flash_v2_5" />
          )}
        </label>
        <label className="text-sm text-gray-700">
          TTS voice *
          {ttsVoices.length ? (
            <select value={config.ttsVoice || ''} onChange={(event) => update({ ttsVoice: event.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md">
              <option value="">Select voice</option>
              {ttsVoices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
            </select>
          ) : (
            <input value={config.ttsVoice || ''} onChange={(event) => update({ ttsVoice: event.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="ElevenLabs voice ID" />
          )}
        </label>
      </div>
      <p className="text-xs text-gray-500">Audio is validated and converted server-side to PCM16 16 kHz provider output and μ-law 8 kHz telephony output.</p>
    </div>
  );
};

export default STTLLMTTSConfig;
