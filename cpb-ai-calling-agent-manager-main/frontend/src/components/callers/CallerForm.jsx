import { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import axios from '../../utils/axios';
import S2SModelSelector from './S2SModelSelector';
import QAPairsEditor from './QAPairsEditor';
import { createCaller, updateCaller } from '../../store/slices/callersSlice';

const CallerForm = ({ caller = null, onClose, onSuccess }) => {
  console.log('[CallerForm] Component rendered', { caller: caller?._id, onClose: !!onClose, onSuccess: !!onSuccess });

  const dispatch = useDispatch();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [telephonyIntegrations, setTelephonyIntegrations] = useState([]);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    callingMechanism: 's2s',
    // Speech-to-Speech configuration
    s2sConfig: {
      pipeline: 'GEMINI_LIVE',
      provider: 'gemini_live',
      model: 'gemini-3.1-flash-live-preview',
      voice: 'Puck',
      language: 'en-US',
      promptRegion: 'north',
      systemPrompt: 'You are a helpful AI assistant making phone calls.',
      temperature: 0.8,
    },
    telephonyConfig: {
      integrationId: '',
      callerId: '',
    },
    qaEntries: [],
    guardrails: {
      maxCallDuration: 600,
      silenceTimeout: 10,
      profanityFilter: true,
    },
  });

  useEffect(() => {
    const fetchTelephony = async () => {
      try {
        const response = await axios.get('/integrations/active/telephony');
        setTelephonyIntegrations(response.data.data || []);
      } catch (err) {
        console.error('Failed to fetch telephony integrations:', err);
      }
    };
    fetchTelephony();
  }, []);

  useEffect(() => {
    if (caller) {
      setFormData({
        name: caller.name || '',
        description: caller.description || '',
        callingMechanism: 's2s',
        s2sConfig: {
          provider: 'gemini_live',
          pipeline: 'GEMINI_LIVE',
          model: 'gemini-3.1-flash-live-preview',
          voice: 'Puck',
          language: 'en-US',
          systemPrompt: 'You are a helpful AI assistant making phone calls.',
          temperature: 0.8,
          ...(caller.s2sConfig || {}),
          promptRegion: caller.s2sConfig?.promptRegion === 'south' ? 'south' : 'north',
        },
        telephonyConfig: caller.telephonyConfig || {
          integrationId: '',
          callerId: '',
        },
        qaEntries: caller.qaEntries || [],
        guardrails: caller.guardrails || {
          maxCallDuration: 600,
          silenceTimeout: 10,
          profanityFilter: true,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caller]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    console.log('[CallerForm] Submit clicked');
    console.log('[CallerForm] Form data:', formData);

    // Validation
    if (!formData.name.trim()) {
      console.log('[CallerForm] Validation failed: name is empty');
      setError('Caller name is required');
      return;
    }

    if (!formData.s2sConfig.systemPrompt.trim()) {
      console.log('[CallerForm] Validation failed: systemPrompt is empty');
      setError('System prompt is required');
      return;
    }
    if (formData.s2sConfig.pipeline === 'STT_LLM_TTS') {
      const required = [
        ['sttIntegrationId', 'Deepgram STT integration'],
        ['llmIntegrationId', 'LLM integration'],
        ['ttsIntegrationId', 'ElevenLabs TTS integration'],
        ['llmModel', 'LLM model'],
        ['ttsModel', 'TTS model'],
        ['ttsVoice', 'TTS voice'],
        ['sttLanguage', 'STT language'],
      ];
      const missing = required.find(([field]) => !String(formData.s2sConfig[field] || '').trim());
      if (missing) {
        setError(`${missing[1]} is required for STT_LLM_TTS`);
        return;
      }
    }

    console.log('[CallerForm] Validation passed, setting loading true');
    setLoading(true);

    try {
      console.log('[CallerForm] Dispatching action...');
      if (caller) {
        await dispatch(updateCaller({ id: caller._id, data: formData })).unwrap();
        console.log('[CallerForm] Update successful');
      } else {
        const result = await dispatch(createCaller(formData)).unwrap();
        console.log('[CallerForm] Create successful:', result);
      }

      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err) {
      console.error('[CallerForm] Error:', err);
      setError(err.message || err || 'Failed to save AI caller');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {caller ? 'Edit AI Caller' : 'Create AI Caller'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Configure speech recognition, AI model, and text-to-speech settings
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-6">
            {/* Basic Information */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Caller Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Sales Bot v1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe the purpose of this AI caller"
                    rows="3"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            </div>

            {/* Telephony Configuration */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Telephony Configuration</h3>
              <p className="text-sm text-gray-600 mb-4">
                Select the carrier account and phone number (Caller ID) this agent will use.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Telephony Carrier
                  </label>
                  <select
                    value={formData.telephonyConfig?.integrationId || ''}
                    onChange={(e) => {
                      const integrationId = e.target.value;
                      const selected = telephonyIntegrations.find(ti => ti._id === integrationId);
                      const meta = selected ? (selected.metadata instanceof Map ? Object.fromEntries(selected.metadata) : (selected.metadata || {})) : {};
                      const callerId = meta.callerIds?.[0] || '';
                      setFormData({
                        ...formData,
                        telephonyConfig: {
                          integrationId,
                          callerId,
                        }
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="">Use Default Integration</option>
                    {telephonyIntegrations.map((ti) => (
                      <option key={ti._id} value={ti._id}>
                        {ti.name} ({String(ti.metadata?.provider || '').toUpperCase()}) {ti.isDefault ? '[Default]' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Caller ID
                  </label>
                  <select
                    value={formData.telephonyConfig?.callerId || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      telephonyConfig: {
                        ...formData.telephonyConfig,
                        callerId: e.target.value,
                      }
                    })}
                    disabled={!formData.telephonyConfig?.integrationId}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white disabled:opacity-50"
                  >
                    {!formData.telephonyConfig?.integrationId ? (
                      <option value="">(Select a carrier first)</option>
                    ) : (
                      <>
                        {(() => {
                          const selected = telephonyIntegrations.find(ti => ti._id === formData.telephonyConfig.integrationId);
                          const meta = selected ? (selected.metadata instanceof Map ? Object.fromEntries(selected.metadata) : (selected.metadata || {})) : {};
                          const callerIds = meta.callerIds || [];
                          return (
                            <>
                              <option value="">Select Caller ID</option>
                              {callerIds.map((cid) => (
                                <option key={cid} value={cid}>
                                  {cid}
                                </option>
                              ))}
                            </>
                          );
                        })()}
                      </>
                    )}
                  </select>
                </div>
              </div>
            </div>

            {/* S2S Configuration */}
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-lg border border-purple-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                <span className="mr-2">🎙️</span>
                Speech-to-Speech Model
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Configure your end-to-end voice model for natural conversations
              </p>
              <S2SModelSelector
                config={formData.s2sConfig}
                onChange={(config) => setFormData({ ...formData, s2sConfig: config })}
              />
            </div>

            {/* Q&A Pairs */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="mb-3 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded px-3 py-2">
                These Q&amp;A pairs are injected into Gemini system instructions as knowledge context.
              </p>
              <QAPairsEditor
                qaEntries={formData.qaEntries}
                onChange={(entries) => setFormData({ ...formData, qaEntries: entries })}
              />
            </div>

            {/* Guardrails */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Guardrails &amp; Limits</h3>
              <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Saved for configuration, but not yet enforced in live Twilio + Gemini runtime.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Call Duration (seconds)
                  </label>
                  <input
                    type="number"
                    value={formData.guardrails.maxCallDuration}
                    onChange={(e) => setFormData({
                      ...formData,
                      guardrails: { ...formData.guardrails, maxCallDuration: parseInt(e.target.value) }
                    })}
                    min="60"
                    max="3600"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Silence Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    value={formData.guardrails.silenceTimeout}
                    onChange={(e) => setFormData({
                      ...formData,
                      guardrails: { ...formData.guardrails, silenceTimeout: parseInt(e.target.value) }
                    })}
                    min="5"
                    max="60"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.guardrails.profanityFilter}
                      onChange={(e) => setFormData({
                        ...formData,
                        guardrails: { ...formData.guardrails, profanityFilter: e.target.checked }
                      })}
                      className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">Profanity Filter</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 mt-6 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </span>
              ) : (
                caller ? 'Update Caller' : 'Create Caller'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CallerForm;
