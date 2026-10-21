import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePipelineCost, percentile, summarizeLatencies } from '../src/services/voicePipelineMetrics.js';

test('calculates latency percentiles without fabricating empty samples', () => {
  assert.equal(percentile([10, 20, 30, 40], 50), 25);
  assert.equal(percentile([], 95), null);
  assert.deepEqual(summarizeLatencies({ firstAudio: [10, 20, 30, 40] }).firstAudio, {
    sampleSize: 4,
    p50: 25,
    p90: 37,
    p95: 38.5,
    p99: 39.7,
  });
});

test('marks cost unknown until every configured rate is available', () => {
  const unknown = estimatePipelineCost({
    durationMs: 60000,
    audioBytesSentToStt: 1920000,
    ttsCharacters: 1000,
    llmUsage: { prompt_tokens: 1000, completion_tokens: 500 },
    rates: { telephonyPerMinuteInr: 1 },
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.totalInr, null);

  const estimate = estimatePipelineCost({
    durationMs: 60000,
    audioBytesSentToStt: 1920000,
    ttsCharacters: 1000,
    llmUsage: { prompt_tokens: 1000, completion_tokens: 500 },
    rates: {
      telephonyPerMinuteInr: 1,
      sttPerMinuteInr: 2,
      llmInputPerMillionTokensInr: 100,
      llmOutputPerMillionTokensInr: 200,
      ttsPerMillionCharactersInr: 300,
    },
  });
  assert.equal(estimate.status, 'estimate');
  assert.equal(estimate.totalInr, 3.5);
});
