import { useState, useEffect } from 'react';
import axios from '../../utils/axios';
import { S2S_PROVIDERS, VOICE_PIPELINES } from '../../utils/constants';
import STTLLMTTSConfig from './STTLLMTTSConfig';

const LANGUAGE_LABELS = {
  'hinglish': 'Hinglish (Hindi in English Script)',
  'kn-IN': 'Kannada (Karnataka / Kanglish)',
  'te-IN': 'Telugu (Andhra & Telangana)',
  'ta-IN': 'Tamil (Tamil Nadu / Tanglish)',
  'ml-IN': 'Malayalam (Kerala)',
  'en-IN': 'English (India)',
  'hi-IN': 'Hindi (India)',
  'en-US': 'English (US)',
  'en': 'English',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
};

const NORTH_LANGUAGES = ['hinglish', 'hi-IN', 'en-IN', 'en-US'];
const SOUTH_LANGUAGES = ['kn-IN', 'te-IN', 'ta-IN', 'ml-IN', 'en-IN'];

const PROMPT_REGIONS = [
  {
    id: 'north',
    title: 'North',
    detail: 'Hindi and English. The agent follows Hinglish or English and switches as soon as the person switches.',
  },
  {
    id: 'south',
    title: 'South',
    detail: 'Kannada, Tamil, Telugu, Malayalam, English, and Hindi. The agent follows whichever the person is speaking.',
  },
];

const S2SModelSelector = ({ config, onChange }) => {
  const [integrations, setIntegrations] = useState([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);

  const selectedProvider = S2S_PROVIDERS.find(p => p.id === config.provider);
  const selectedIntegration = integrations.find(i => String(i._id) === String(config.integrationId));

  const availableModelsList = Array.from(
    new Set([
      ...(selectedProvider?.models || []),
      ...(selectedIntegration?.availableModels || []).map(m => m.id || m),
      ...(config.model ? [config.model] : [])
    ])
  ).filter(Boolean);

  // Fetch available S2S integrations
  useEffect(() => {
    const fetchIntegrations = async () => {
      try {
        const response = await axios.get('/integrations/active/s2s');
        setIntegrations(response.data.data || []);
      } catch (error) {
        console.error('Error fetching S2S integrations:', error);
        setIntegrations([]);
      } finally {
        setLoadingIntegrations(false);
      }
    };
    fetchIntegrations();
  }, []);

  const handleProviderChange = (e) => {
    const providerId = e.target.value;
    const provider = S2S_PROVIDERS.find(p => p.id === providerId);

    // Try to find a matching integration for this provider
    const matchingIntegration = integrations.find(
      int => int.name.toLowerCase().includes(providerId.replace(/_/g, ' ').toLowerCase())
    );

    const promptRegion = config.promptRegion === 'south' ? 'south' : 'north';
    const allowedLanguages = promptRegion === 'south' ? SOUTH_LANGUAGES : NORTH_LANGUAGES;
    const nextLanguage = providerId === 'gemini_live'
      ? (allowedLanguages.includes(config.language)
        ? config.language
        : promptRegion === 'south' ? 'kn-IN' : 'hinglish')
      : (provider?.languages?.[0] || 'en-US');

    onChange({
      provider: providerId,
      integrationId: matchingIntegration?._id || config.integrationId,
      model: provider?.models?.[0] || config.model || 'gemini-3.1-flash-live-preview',
      voice: provider?.voices?.[0] || 'default',
      language: nextLanguage,
      promptRegion,
      systemPrompt: config.systemPrompt || 'You are a helpful AI assistant making phone calls.',
      temperature: config.temperature ?? 0.8,
      thinkingLevel: config.thinkingLevel,
    });
  };

  const handleRegionChange = (region) => {
    const allowed = region === 'south' ? SOUTH_LANGUAGES : NORTH_LANGUAGES;
    const language = allowed.includes(config.language)
      ? config.language
      : region === 'south'
        ? 'kn-IN'
        : 'hinglish';
    onChange({
      ...config,
      promptRegion: region,
      language,
    });
  };

  const handleIntegrationChange = (integrationId) => {
    onChange({
      ...config,
      integrationId: integrationId,
    });
  };

  const handleFieldChange = (field, value) => {
    onChange({
      ...config,
      [field]: value
    });
  };

  const promptRegion = config.promptRegion === 'south' ? 'south' : 'north';
  const isGemini = config.provider === 'gemini_live';
  const regionLanguages = promptRegion === 'south' ? SOUTH_LANGUAGES : NORTH_LANGUAGES;
  const providerLanguages = selectedProvider?.languages || [];
  const languageOptions = (
    isGemini ? providerLanguages.filter((lang) => regionLanguages.includes(lang)) : providerLanguages
  ).filter(Boolean);
  if (config.language && !languageOptions.includes(config.language)) {
    languageOptions.unshift(config.language);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Voice pipeline
        </label>
        <select
          value={config.pipeline || 'GEMINI_LIVE'}
          onChange={(e) => onChange({ ...config, pipeline: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          {VOICE_PIPELINES.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
        {config.pipeline === 'STT_LLM_TTS' && (
          <p className="mt-1 text-xs text-amber-700">
            Configure each provider below. The pipeline must also be enabled by the backend before campaigns can start.
          </p>
        )}
      </div>
      {config.pipeline === 'STT_LLM_TTS' && <STTLLMTTSConfig config={config} onChange={onChange} />}
      <div className={config.pipeline === 'STT_LLM_TTS' ? 'hidden' : 'space-y-4'}>
      {/* Warning if no integrations */}
      {!loadingIntegrations && integrations.length === 0 && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-yellow-800">
              <p className="font-medium">No S2S Integrations Configured</p>
              <p className="mt-1 text-yellow-700">
                Please ask your admin to set up a Speech-to-Speech integration in the
                <strong> Admin → Custom Integrations → Speech-to-Speech</strong> section before using this feature.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Integration Selection (if available) */}
      {integrations.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            S2S Integration
          </label>
          <select
            value={config.integrationId || ''}
            onChange={(e) => handleIntegrationChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">Auto-select based on provider</option>
            {integrations.map(integration => (
              <option key={integration._id} value={integration._id}>
                {integration.name} {integration.isDefault && '(Default)'}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Select a specific integration or let the system auto-select based on provider
          </p>
        </div>
      )}

      {/* Provider Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          S2S Provider
        </label>
        <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1">
          {S2S_PROVIDERS.map(provider => (
            <div
              key={provider.id}
              onClick={() => handleProviderChange({ target: { value: provider.id } })}
              className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                config.provider === provider.id
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-purple-300'
              } ${provider.id === 'custom' ? 'border-dashed' : ''}`}
            >
              <div className="flex items-center">
                <span className="text-xl mr-2">{provider.icon || '🎙️'}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{provider.name}</p>
                  <p className="text-xs text-gray-500 truncate">{provider.description}</p>
                </div>
                {config.provider === provider.id && (
                  <svg className="w-5 h-5 text-purple-500 flex-shrink-0 ml-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedProvider && (
        <>
          {/* Model Selection */}
          {availableModelsList.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Model
              </label>
              <select
                value={config.model || availableModelsList[0]}
                onChange={(e) => handleFieldChange('model', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {availableModelsList.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>
          )}

          {/* Voice Selection */}
          {selectedProvider.voices && selectedProvider.voices.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Voice
              </label>
              <select
                value={config.voice || ''}
                onChange={(e) => handleFieldChange('voice', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {selectedProvider.voices.map(voice => (
                  <option key={voice} value={voice}>{voice}</option>
                ))}
              </select>
            </div>
          )}

          {isGemini && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Language prompt
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {PROMPT_REGIONS.map((region) => (
                  <button
                    key={region.id}
                    type="button"
                    onClick={() => handleRegionChange(region.id)}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      promptRegion === region.id
                        ? 'border-purple-500 bg-white'
                        : 'border-gray-200 bg-white hover:border-purple-300'
                    }`}
                  >
                    <p className="font-medium text-gray-900 text-sm">{region.title}</p>
                    <p className="mt-1 text-xs text-gray-500">{region.detail}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Language Selection */}
          {languageOptions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Starting language
              </label>
              <select
                value={config.language || ''}
                onChange={(e) => handleFieldChange('language', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {languageOptions.map(lang => (
                  <option key={lang} value={lang}>{LANGUAGE_LABELS[lang] || lang}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {isGemini
                  ? 'The first line uses this language. After the person speaks, the agent switches to match them.'
                  : 'Language used for this caller'}
              </p>
            </div>
          )}

          {/* Temperature */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Temperature: {config.temperature || 0.8}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={config.temperature || 0.8}
              onChange={(e) => handleFieldChange('temperature', parseFloat(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>More Focused</span>
              <span>More Creative</span>
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              System Instructions
            </label>
            <textarea
              value={config.systemPrompt || 'You are a helpful AI assistant making phone calls.'}
              onChange={(e) => handleFieldChange('systemPrompt', e.target.value)}
              rows="4"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Define the AI's personality, role, and behavior guidelines..."
            />
            <p className="mt-1 text-xs text-gray-500">
              The call script: who you are, what to ask, and when to end. Language switching comes from the prompt above, so this script stays the same for North and South.
            </p>
          </div>
        </>
      )}

      {/* Info about S2S */}
      <div className="mt-4 p-3 bg-purple-100 rounded-lg">
        <div className="flex items-start">
          <svg className="w-5 h-5 text-purple-600 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-purple-800">
            <p className="font-medium">About Speech-to-Speech Models</p>
            <p className="mt-1 text-purple-700">
              S2S models process voice directly without separate transcription steps,
              resulting in lower latency and more natural conversations. Note: Script flow
              is not used with S2S - the model handles the entire conversation dynamically.
            </p>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default S2SModelSelector;
