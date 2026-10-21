const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

const muLawToLinearSample = (muLawByte) => {
  const muLaw = ~muLawByte & 0xff;
  const sign = muLaw & 0x80;
  const exponent = (muLaw >> 4) & 0x07;
  const mantissa = muLaw & 0x0f;
  const sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  return sign ? MULAW_BIAS - sample : sample - MULAW_BIAS;
};

const linearToMuLawSample = (sample) => {
  let pcm = Math.max(-32768, Math.min(32767, sample));
  const sign = pcm < 0 ? 0x80 : 0x00;

  if (pcm < 0) {
    pcm = -pcm;
  }
  if (pcm > MULAW_CLIP) {
    pcm = MULAW_CLIP;
  }

  pcm += MULAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent -= 1;
  }

  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
};

export const decodeMulawToPcm16 = (mulawBuffer) => {
  const output = Buffer.allocUnsafe(mulawBuffer.length * 2);
  for (let i = 0; i < mulawBuffer.length; i += 1) {
    output.writeInt16LE(muLawToLinearSample(mulawBuffer[i]), i * 2);
  }
  return output;
};

export const encodePcm16ToMulaw = (pcm16Buffer) => {
  const samples = Math.floor(pcm16Buffer.length / 2);
  const output = Buffer.allocUnsafe(samples);
  for (let i = 0; i < samples; i += 1) {
    const sample = pcm16Buffer.readInt16LE(i * 2);
    output[i] = linearToMuLawSample(sample);
  }
  return output;
};

export const resamplePcm16 = (pcm16Buffer, inputRate, outputRate) => {
  if (!pcm16Buffer || pcm16Buffer.length === 0) {
    return Buffer.alloc(0);
  }

  if (inputRate === outputRate) {
    return Buffer.from(pcm16Buffer);
  }

  const inputSamples = Math.floor(pcm16Buffer.length / 2);
  if (inputSamples <= 1) {
    return Buffer.from(pcm16Buffer);
  }

  const outputSamples = Math.max(1, Math.round((inputSamples * outputRate) / inputRate));
  const output = Buffer.allocUnsafe(outputSamples * 2);

  for (let i = 0; i < outputSamples; i += 1) {
    const position = (i * inputRate) / outputRate;
    const idx = Math.floor(position);
    const frac = position - idx;

    const idxNext = Math.min(idx + 1, inputSamples - 1);
    const sampleA = pcm16Buffer.readInt16LE(Math.min(idx, inputSamples - 1) * 2);
    const sampleB = pcm16Buffer.readInt16LE(idxNext * 2);
    const interpolated = Math.round(sampleA + (sampleB - sampleA) * frac);

    output.writeInt16LE(interpolated, i * 2);
  }

  return output;
};

export const getSampleRateFromMimeType = (mimeType, defaultRate = 16000) => {
  if (!mimeType) return defaultRate;
  const rateMatch = /rate=(\d+)/i.exec(mimeType);
  return rateMatch ? parseInt(rateMatch[1], 10) : defaultRate;
};
