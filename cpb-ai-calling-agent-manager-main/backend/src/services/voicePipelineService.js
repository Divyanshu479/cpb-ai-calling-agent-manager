import Integration from '../models/Integration.js';
import mongoose from 'mongoose';
import {
  isSttLlmTtsEnabled,
  validateVoicePipelineShape,
  VOICE_PIPELINES,
} from '../config/voicePipelines.js';
import { createVoicePipelineAdapters } from './voicePipelines/adapters.js';

const asObject = (value) => {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
};

const integrationTypeFor = {
  sttIntegrationId: 'stt',
  llmIntegrationId: 'llm',
  ttsIntegrationId: 'tts',
};

class VoicePipelineService {
  validateShape(config = {}) {
    return validateVoicePipelineShape(config);
  }

  async validateForCall(config = {}) {
    const shape = this.validateShape(config);
    if (!shape.valid) {
      const error = new Error(shape.message);
      error.statusCode = 400;
      throw error;
    }

    if (shape.pipeline === VOICE_PIPELINES.GEMINI_LIVE) {
      return { pipeline: shape.pipeline };
    }

    if (!isSttLlmTtsEnabled()) {
      const error = new Error('STT_LLM_TTS pipeline is disabled');
      error.statusCode = 503;
      throw error;
    }

    const integrations = {};
    for (const [field, expectedType] of Object.entries(integrationTypeFor)) {
      if (!mongoose.isValidObjectId(config[field])) {
        const error = new Error(`A valid ${expectedType.toUpperCase()} integration is required`);
        error.statusCode = 400;
        throw error;
      }
      const integration = await Integration.findOne({
        _id: config[field],
        type: expectedType,
        isActive: true,
      });
      if (!integration) {
        const error = new Error(`Active ${expectedType.toUpperCase()} integration is required`);
        error.statusCode = 400;
        throw error;
      }
      integrations[expectedType] = integration;
    }

    return {
      pipeline: shape.pipeline,
      integrations,
      adapters: createVoicePipelineAdapters({
        stt: {
          ...asObject(integrations.stt.metadata),
          ...(integrations.stt.authConfig?.toObject?.() || integrations.stt.authConfig || {}),
          apiKey:
            integrations.stt.authConfig?.token ||
            integrations.stt.authConfig?.headerValue ||
            asObject(integrations.stt.metadata).apiKey,
          model: config.sttModel,
          language: config.sttLanguage,
          encoding: config.sttEncoding,
          sampleRate: config.sttSampleRate,
          channels: config.sttChannels,
          endpointingMs: config.sttEndpointingMs,
          utteranceEndMs: config.sttUtteranceEndMs,
        },
        llm: {
          ...asObject(integrations.llm.metadata),
          ...(integrations.llm.authConfig?.toObject?.() || integrations.llm.authConfig || {}),
          apiKey:
            integrations.llm.authConfig?.token ||
            integrations.llm.authConfig?.headerValue ||
            asObject(integrations.llm.metadata).apiKey,
          baseUrl: integrations.llm.baseUrl,
          provider: asObject(integrations.llm.metadata).provider || 'openai_compatible',
          authType: integrations.llm.authType,
          headerName: integrations.llm.authConfig?.headerName,
          headerValue: integrations.llm.authConfig?.headerValue,
          availableModels: integrations.llm.availableModels,
          model: config.llmModel,
        },
        tts: {
          ...asObject(integrations.tts.metadata),
          ...(integrations.tts.authConfig?.toObject?.() || integrations.tts.authConfig || {}),
          apiKey:
            integrations.tts.authConfig?.token ||
            integrations.tts.authConfig?.headerValue ||
            asObject(integrations.tts.metadata).apiKey,
          baseUrl: integrations.tts.baseUrl,
          model: config.ttsModel,
          voice: config.ttsVoice,
          outputFormat: config.ttsOutputFormat,
          telephonyFormat: config.ttsTelephonyFormat,
        },
      }),
    };
  }
}

export default new VoicePipelineService();
