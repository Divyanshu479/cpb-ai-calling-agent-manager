import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VOICE_PIPELINE,
  VOICE_PIPELINES,
  normalizeVoicePipeline,
  validateVoicePipelineShape,
} from '../src/config/voicePipelines.js';
import AICaller from '../src/models/AICaller.js';
import voicePipelineService from '../src/services/voicePipelineService.js';

test('defaults missing pipeline to the existing Gemini pipeline', () => {
  assert.equal(normalizeVoicePipeline(undefined), DEFAULT_VOICE_PIPELINE);
  assert.equal(validateVoicePipelineShape({}).pipeline, VOICE_PIPELINES.GEMINI_LIVE);
});

test('selects STT_LLM_TTS explicitly', () => {
  const result = validateVoicePipelineShape({
    pipeline: 'stt_llm_tts',
    sttIntegrationId: 'stt',
    llmIntegrationId: 'llm',
    ttsIntegrationId: 'tts',
    llmModel: 'configured-model',
    ttsModel: 'eleven-model',
    ttsVoice: 'configured-voice',
    sttLanguage: 'en-US',
    sttEncoding: 'linear16',
    sttSampleRate: 16000,
    sttChannels: 1,
  });

  assert.equal(result.valid, true);
  assert.equal(result.pipeline, VOICE_PIPELINES.STT_LLM_TTS);
});

test('rejects incomplete STT_LLM_TTS configuration', () => {
  const result = validateVoicePipelineShape({ pipeline: 'STT_LLM_TTS' });
  assert.equal(result.valid, false);
  assert.match(result.message, /sttIntegrationId/);
  assert.match(result.message, /llmModel/);
});

test('rejects Deepgram audio settings that do not match the adapter contract', () => {
  const result = validateVoicePipelineShape({
    pipeline: 'STT_LLM_TTS',
    sttIntegrationId: 'stt',
    llmIntegrationId: 'llm',
    ttsIntegrationId: 'tts',
    llmModel: 'configured-model',
    ttsVoice: 'configured-voice',
    sttLanguage: 'en-US',
    sttEncoding: 'mulaw',
  });

  assert.equal(result.valid, false);
  assert.match(result.message, /sttEncoding=linear16/);
});

test('rejects unknown pipelines without affecting Gemini defaults', () => {
  assert.equal(normalizeVoicePipeline('unknown'), null);
  assert.equal(validateVoicePipelineShape({ pipeline: 'unknown' }).valid, false);
  assert.equal(validateVoicePipelineShape({}).pipeline, DEFAULT_VOICE_PIPELINE);
});

test('persists explicit STT_LLM_TTS fields while defaulting legacy callers to Gemini', () => {
  const legacy = new AICaller({
    name: 'Legacy caller',
    createdBy: '507f1f77bcf86cd799439011',
  });

  const configured = new AICaller({
    name: 'Pipeline caller',
    createdBy: '507f1f77bcf86cd799439011',
    s2sConfig: {
      pipeline: VOICE_PIPELINES.STT_LLM_TTS,
      sttIntegrationId: '507f1f77bcf86cd799439012',
      llmIntegrationId: '507f1f77bcf86cd799439013',
      ttsIntegrationId: '507f1f77bcf86cd799439014',
      llmModel: 'gpt-test',
      ttsModel: 'eleven_flash_v2_5',
      ttsVoice: 'voice-test',
      sttLanguage: 'en-US',
    },
  });

  assert.equal(legacy.s2sConfig.pipeline, DEFAULT_VOICE_PIPELINE);
  assert.equal(configured.s2sConfig.pipeline, VOICE_PIPELINES.STT_LLM_TTS);
  assert.equal(configured.s2sConfig.llmModel, 'gpt-test');
  assert.equal(configured.s2sConfig.ttsVoice, 'voice-test');
});

test('keeps the existing S2S runtime validation path unchanged for legacy config', async () => {
  const result = await voicePipelineService.validateForCall({});
  assert.deepEqual(result, { pipeline: VOICE_PIPELINES.GEMINI_LIVE });
});
