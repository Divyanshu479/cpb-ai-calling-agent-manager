const FOREIGN_SCRIPT = /[\u0400-\u04FF\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g;
const DEVANAGARI = /[\u0900-\u097F]/;
const ROMANCE_WORD = /^(amo|la|el|los|las|una|uno|es|ya|que|qué|como|cómo|entonces|entao|então|nao|não|voce|você|por|para|con|mi|mí|hola|gracias|quieres|quiero|habla|grites|grito|dejame|déjame|oigo|ver|dieta|cult|estoy|esta|está|senor|señor|adios|adiós)$/i;
const ENGLISH_CONTENT = /^(the|is|are|am|hello|hi|yes|ok|okay|please|thank|thanks|what|who|when|where|how|i|you|we|my|your|not|this|that|doctor|dr|and|but|have|had|was|were|can|will|just|now|hear|time|bye|good|day)$/i;
const PHONETIC_WORD = new Map([
  ['thingg', 'thing'],
  ['thinggg', 'thing'],
  ['samthing', 'something'],
  ['samthingg', 'something'],
  ['somthing', 'something'],
  ['somthingg', 'something'],
  ['vhich', 'which'],
  ['vich', 'which'],
  ['bikoz', 'because'],
  ['becaz', 'because'],
  ['dats', "that's"],
  ['thats', "that's"],
  ['mistek', 'mistake'],
  ['aask', 'ask'],
  ['charjes', 'charges'],
  ['charjez', 'charges'],
  ['dajant', "doesn't"],
  ['spekt', 'expect'],
  ['yoo', 'you'],
  ['ij', 'is'],
]);

const wordsIn = (text) => text.match(/[a-zA-Z\u00C0-\u024F']+/g) || [];

// Phone noise is often written as Spanish, Portuguese, or Italian. Hindi written
// in Devanagari is kept as Gemini produced it.
const isRomanceNoise = (text) => {
  if (DEVANAGARI.test(text)) return false;
  const words = wordsIn(text);
  if (words.length === 0) return true;
  let romance = 0;
  let english = 0;
  for (const word of words) {
    if (ROMANCE_WORD.test(word)) romance += 1;
    else if (ENGLISH_CONTENT.test(word)) english += 1;
  }
  if (/[¿¡]/u.test(text) && english === 0) return true;
  if (/[áéíóúñãõçàèìòù]/iu.test(text) && english === 0) return true;
  if (romance >= 1 && english === 0 && romance === words.length) return true;
  return romance >= 2 && romance > english;
};

const stripToolLeak = (text) => text
  .replace(/\bcall\s+end_call\b/gi, '')
  .replace(/\bend_call\b/gi, '');

const tidyPhoneticEnglish = (text) => {
  const replaced = text.replace(/\b[\w']+\b/g, (word) => PHONETIC_WORD.get(word.toLowerCase()) || word);
  return replaced
    .replace(/\bnot e big\b/gi, 'not a big')
    .replace(/\bthat's vhai\b/gi, "that's why");
};

const stripNoiseSentences = (text) => {
  const parts = text.split(/(?<=[.?!।])/u);
  const kept = [];
  for (const part of parts) {
    const sentence = part.trim();
    if (!sentence || isRomanceNoise(sentence)) continue;
    kept.push(sentence);
  }
  return kept.join(' ');
};

// Keep Gemini's own script. Drop silence, Spanish/Portuguese noise, and the
// end_call tool name. Do not rewrite Devanagari into Roman letters.
export const normalizeCallTranscript = (value) => {
  const raw = String(value || '').replace(/\u0000/g, '').trim();
  if (!raw) return '';
  const cleaned = stripToolLeak(raw).replace(FOREIGN_SCRIPT, ' ');
  const text = tidyPhoneticEnglish(stripNoiseSentences(cleaned)).replace(/\s+/g, ' ').trim();
  if (!text || !/[a-z0-9\u0900-\u097F]/iu.test(text)) return '';
  return text;
};

export { openingLanguageLine } from './languagePrompts.js';
