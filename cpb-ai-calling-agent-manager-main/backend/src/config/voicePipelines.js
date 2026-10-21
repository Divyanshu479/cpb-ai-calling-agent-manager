export const VOICE_PIPELINES = Object.freeze({
  GEMINI_LIVE: 'GEMINI_LIVE',
  STT_LLM_TTS: 'STT_LLM_TTS',
});

export const DEFAULT_VOICE_PIPELINE = VOICE_PIPELINES.GEMINI_LIVE;

export const normalizeVoicePipeline = (value) => {
  if (!value) return DEFAULT_VOICE_PIPELINE;
  const normalized = String(value).trim().toUpperCase();
  return Object.values(VOICE_PIPELINES).includes(normalized) ? normalized : null;
};

export const isSttLlmTtsEnabled = () =>
  String(process.env.STT_LLM_TTS_ENABLED || 'false').toLowerCase() === 'true';

export const validateVoicePipelineShape = (config = {}) => {
  const pipeline = normalizeVoicePipeline(config.pipeline);
  if (!pipeline) {
    return {
      valid: false,
      message: `Unsupported voice pipeline: ${config.pipeline || 'empty'}`,
    };
  }

  if (pipeline === VOICE_PIPELINES.STT_LLM_TTS) {
    const missing = ['sttIntegrationId', 'llmIntegrationId', 'ttsIntegrationId'].filter(
      (field) => !config[field]
    );
    if (!config.llmModel) missing.push('llmModel');
    if (!config.ttsModel) missing.push('ttsModel');
    if (!config.ttsVoice) missing.push('ttsVoice');
    if (!config.sttLanguage) missing.push('sttLanguage');
    if (config.sttEncoding && config.sttEncoding !== 'linear16') {
      missing.push('sttEncoding=linear16');
    }
    if (config.sttSampleRate && Number(config.sttSampleRate) !== 16000) {
      missing.push('sttSampleRate=16000');
    }
    if (config.sttChannels && Number(config.sttChannels) !== 1) {
      missing.push('sttChannels=1');
    }
    if (config.ttsOutputFormat && config.ttsOutputFormat !== 'pcm_16000') {
      missing.push('ttsOutputFormat=pcm_16000');
    }
    if (config.ttsTelephonyFormat && config.ttsTelephonyFormat !== 'mulaw_8000') {
      missing.push('ttsTelephonyFormat=mulaw_8000');
    }
    if (missing.length > 0) {
      return {
        valid: false,
        pipeline,
        message: `STT_LLM_TTS configuration is missing: ${missing.join(', ')}`,
      };
    }
  }

  return { valid: true, pipeline };
};
