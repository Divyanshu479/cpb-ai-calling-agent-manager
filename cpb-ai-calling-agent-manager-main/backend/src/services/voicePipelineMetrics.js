const numberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export const percentile = (values, percentileValue) => {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = (percentileValue / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (rank - lower));
};

export const summarizeLatencies = (samples = {}) => Object.fromEntries(
  Object.entries(samples).map(([name, values]) => [
    name,
    {
      sampleSize: values.filter(Number.isFinite).length,
      p50: percentile(values, 50),
      p90: percentile(values, 90),
      p95: percentile(values, 95),
      p99: Number.isFinite(percentile(values, 99))
        ? Number(percentile(values, 99).toFixed(3))
        : null,
    },
  ])
);

export const createPipelineMetrics = () => ({
  sttPartialLatencyMs: [],
  sttFinalLatencyMs: [],
  endOfTurnDelayMs: [],
  llmTimeToFirstTokenMs: [],
  ttsTimeToFirstAudioMs: [],
  audioTransportDelayMs: [],
  endOfTurnToFirstAudioMs: [],
  userPerceivedLatencyMs: [],
  turnCount: 0,
  audioBytesSentToStt: 0,
  ttsCharacters: 0,
  llmUsage: {},
  startedAt: Date.now(),
});

const rate = (rates, key) => numberOrNull(rates?.[key]);

export const estimatePipelineCost = ({
  durationMs = 0,
  audioBytesSentToStt = 0,
  ttsCharacters = 0,
  llmUsage = {},
  rates = {},
} = {}) => {
  const telephonyMinutes = Math.max(0, Number(durationMs) || 0) / 60000;
  const sttMinutes = Math.max(0, Number(audioBytesSentToStt) || 0) / (2 * 16000 * 60);
  const inputTokens = Number(llmUsage.prompt_tokens ?? llmUsage.input_tokens ?? 0) || 0;
  const outputTokens = Number(llmUsage.completion_tokens ?? llmUsage.output_tokens ?? 0) || 0;
  const components = {
    telephony: rate(rates, 'telephonyPerMinuteInr') === null
      ? null
      : telephonyMinutes * rate(rates, 'telephonyPerMinuteInr'),
    stt: rate(rates, 'sttPerMinuteInr') === null
      ? null
      : sttMinutes * rate(rates, 'sttPerMinuteInr'),
    llmInput: rate(rates, 'llmInputPerMillionTokensInr') === null
      ? null
      : (inputTokens / 1_000_000) * rate(rates, 'llmInputPerMillionTokensInr'),
    llmOutput: rate(rates, 'llmOutputPerMillionTokensInr') === null
      ? null
      : (outputTokens / 1_000_000) * rate(rates, 'llmOutputPerMillionTokensInr'),
    tts: rate(rates, 'ttsPerMillionCharactersInr') === null
      ? null
      : (Number(ttsCharacters) / 1_000_000) * rate(rates, 'ttsPerMillionCharactersInr'),
  };
  const known = Object.values(components).filter((value) => value !== null);
  return {
    currency: 'INR',
    status: known.length === Object.keys(components).length ? 'estimate' : 'unknown',
    components,
    totalInr: known.length === Object.keys(components).length
      ? known.reduce((total, value) => total + value, 0)
      : null,
    connectedCallMinutes: telephonyMinutes,
    sttMinutes,
    usage: { inputTokens, outputTokens, ttsCharacters },
    rates,
    note: 'Estimate only; configure verified provider rates. Unknown components are not included in total.',
  };
};
