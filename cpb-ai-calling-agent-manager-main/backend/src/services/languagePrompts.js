const LANGUAGE_NAMES = {
  'kn-in': 'Kannada (Kanglish)',
  kannada: 'Kannada (Kanglish)',
  'te-in': 'Telugu (Telugish)',
  telugu: 'Telugu (Telugish)',
  'ta-in': 'Tamil (Tanglish)',
  tamil: 'Tamil (Tanglish)',
  'ml-in': 'Malayalam (Manglish)',
  malayalam: 'Malayalam (Manglish)',
  hinglish: 'Hinglish (Romanized Hindi)',
  'hi-in': 'Hindi / Hinglish',
  hi: 'Hindi / Hinglish',
  hindi: 'Hindi / Hinglish',
  'en-in': 'Indian English',
  'en-us': 'English',
  en: 'English',
  english: 'English',
};

const NORTH_OPENING_DIRECTIVE =
  'LANGUAGE OVERRIDE. This outranks the caller script. Match the person: if they speak English, answer in English; if they speak Hindi, answer in Hinglish. Switch as soon as they switch. Do not stay in Hindi after they speak English. Always write Hindi in Roman letters, the way people type it: "haan ji, bataiye", "kya meri baat Rahul se ho rahi hai". Do not write Devanagari. Never write Korean, Spanish, Chinese, or any other non-Indian language.';

const SOUTH_OPENING_DIRECTIVE =
  'LANGUAGE OVERRIDE. This outranks the caller script. Match the person: Kannada gets Kanglish, Tamil gets Tanglish, Telugu gets Telugish, Malayalam gets Manglish, English gets Indian English, and Hindi gets Hinglish. Switch as soon as they switch. Do not stay in the previous language after they change, and do not drift back to the starting language. Always use Roman letters. Kannada looks like "namaskara, heli", Tamil like "vanakkam, sollunga", Telugu like "namaskaram, cheppandi", Malayalam like "namaskaram, parayuvo", Hindi like "haan ji, bataiye". Do not write Devanagari or any other native script. Never write Korean, Spanish, Chinese, or any other non-Indian language.';

const TRANSCRIPTION_RULE =
  'Transcription Rule: Write the transcript in Roman letters. Hindi must look like "haan ji, kya scene hai", never Devanagari. 8kHz phone noise, beeps, and silence are not words. Never transcribe them as Korean, Spanish, Chinese, Portuguese, or any other language. If you cannot hear real words in English or an Indian language, output no transcript text.';

export const resolvePromptRegion = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return key === 'south' ? 'south' : 'north';
};

export const resolveSessionPromptRegion = (session) =>
  resolvePromptRegion(
    session?.params?.promptRegion || session?.aiCaller?.s2sConfig?.promptRegion
  );

export const languageOpeningDirective = (promptRegion) =>
  resolvePromptRegion(promptRegion) === 'south'
    ? SOUTH_OPENING_DIRECTIVE
    : NORTH_OPENING_DIRECTIVE;

const startingLanguageName = (promptRegion, preferredLanguage) => {
  const region = resolvePromptRegion(promptRegion);
  const langKey = String(preferredLanguage || '').trim().toLowerCase();
  if (region === 'north' && (langKey === 'ml-in' || langKey === 'malayalam')) {
    return 'Malayalam';
  }
  if (LANGUAGE_NAMES[langKey]) return LANGUAGE_NAMES[langKey];
  if (preferredLanguage) return preferredLanguage;
  return region === 'south' ? 'Kannada (Kanglish)' : 'Hinglish';
};

export const languagePreferenceSection = (promptRegion, preferredLanguage) => {
  const startingLanguage = startingLanguageName(promptRegion, preferredLanguage);

  if (resolvePromptRegion(promptRegion) === 'south') {
    return `Language Preference & Natural Adaptation:
- Starting Language: Start the call in ${startingLanguage}. The first line uses that language. Do not open in Hindi unless the starting language is Hindi.
- Match the answerer on every turn: Kanglish for Kannada, Tanglish for Tamil, Telugish for Telugu, Manglish for Malayalam, Indian English for English, Hinglish for Hindi. Change immediately when they change. Do not drift back to the starting language out of habit.
- Mixing is normal. If they mix Kannada and English, stay in Kanglish. Same for Tamil (Tanglish), Telugu (Telugish), and Malayalam (Manglish). Do not answer that mix in Hindi.
- Script Rule: Roman letters only. "namaskara, naanu call madtini" is correct. "ನಮಸ್ಕಾರ" is forbidden. "vanakkam, naan pesuren" is correct. "வணக்கம்" is forbidden. "namaskaram, nenu matladutunnanu" is correct. "నమస్కారం" is forbidden.
- ${TRANSCRIPTION_RULE}`;
  }

  return `Language Preference & Natural Adaptation:
- Starting Language: Start the call in ${startingLanguage}. If that is English, the first line is English, not Hindi.
- Match the answerer: English reply for English, Hinglish for Hindi. Change immediately when they change. Do not remain in Hindi out of habit.
- You may also follow Kannada, Telugu, Tamil, or Malayalam if that is what they speak.
- Script Rule: Roman letters only, including Hindi. "kya meri baat Rahul se ho rahi hai" is correct. Devanagari is not.
- ${TRANSCRIPTION_RULE}`;
};

export const romanTranscriptRule = (promptRegion) => {
  if (resolvePromptRegion(promptRegion) === 'south') {
    return 'The transcript is Roman letters only. Kannada, Tamil, Telugu, Malayalam, and Hindi stay romanized. Devanagari and other native scripts are not used.';
  }
  return 'The transcript is Roman letters only. Hindi is Hinglish, like "haan ji, bataiye". Devanagari is not used.';
};

export const openingLanguageLine = (languageCode, promptRegion) => {
  const region = resolvePromptRegion(promptRegion);
  const key = String(languageCode || '').trim().toLowerCase();

  if (['en', 'en-in', 'en-us', 'english'].includes(key)) {
    if (region === 'south') {
      return 'Say this opening in simple Indian English only. Do not use Kannada, Tamil, Telugu, Malayalam, or Hindi words.';
    }
    return 'Say this opening in simple Indian English only. Do not use Hindi words.';
  }

  if (['hi', 'hi-in', 'hinglish', 'hindi'].includes(key)) {
    return 'Say this opening in Hinglish using Roman letters, for example "Namaste, kya meri baat Rahul se ho rahi hai?". Do not use Devanagari.';
  }

  if (region === 'south') {
    if (['kn-in', 'kannada'].includes(key)) {
      return 'Say this opening in Kanglish using Roman letters, for example "Namaskara, naanu call madtiddini". No Kannada script.';
    }
    if (['ta-in', 'tamil'].includes(key)) {
      return 'Say this opening in Tanglish using Roman letters, for example "Vanakkam, naan call panren". No Tamil script.';
    }
    if (['te-in', 'telugu'].includes(key)) {
      return 'Say this opening in Telugish using Roman letters, for example "Namaskaram, nenu call chestunnanu". No Telugu script.';
    }
    if (['ml-in', 'malayalam'].includes(key)) {
      return 'Say this opening in Manglish using Roman letters, for example "Namaskaram, njan call cheyyunnu". No Malayalam script.';
    }
  }

  return 'Say this opening in simple Indian English unless the person has already spoken Hindi. If you use Hindi, write it in Roman letters.';
};
