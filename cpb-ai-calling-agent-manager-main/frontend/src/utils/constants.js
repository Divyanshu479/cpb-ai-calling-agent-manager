export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export const ROLES = {
  ADMIN: 'admin',
  CAMPAIGN_MANAGER: 'campaign_manager',
};

export const CALL_STATUSES = {
  PENDING: 'pending',
  QUEUED: 'queued',
  CALLING: 'calling',
  CONNECTED: 'connected',
  NO_ANSWER: 'no_answer',
  VOICEMAIL: 'voicemail',
  COMPLETED: 'completed',
  EXHAUSTED: 'exhausted',
};

export const CALL_OUTCOMES = {
  INTERESTED: 'interested',
  NOT_INTERESTED: 'not_interested',
  CALLBACK: 'callback',
  NO_ANSWER: 'no_answer',
  VOICEMAIL: 'voicemail',
  OTHER: 'other',
};

export const CAMPAIGN_STATUSES = {
  DRAFT: 'draft',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  STOPPED: 'stopped',
};

// Speech-to-Speech (S2S) providers - End-to-end voice models
export const S2S_PROVIDERS = [
  {
    id: 'openai_realtime',
    name: 'OpenAI GPT-4o Realtime',
    models: ['gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview'],
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'],
    description: 'OpenAI GPT-4o Realtime API for low-latency voice conversations with advanced reasoning',
    icon: '🤖',
  },
  {
    id: 'gemini_live',
    name: 'Google Gemini Live',
    models: ['gemini-3.1-flash-live-preview', 'gemini-3.8-live'],
    voices: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'],
    languages: ['hinglish', 'kn-IN', 'te-IN', 'ta-IN', 'ml-IN', 'en-IN', 'hi-IN', 'en-US'],
    description: 'Low-latency audio-to-audio Gemini Live model for real-time voice conversations',
    icon: '✨',
  },
  {
    id: 'elevenlabs_conversational',
    name: 'ElevenLabs Conversational',
    voices: ['rachel', 'drew', 'clyde', 'paul', 'domi', 'dave', 'fin', 'sarah'],
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'hi'],
    description: 'ElevenLabs Conversational AI with ultra-realistic voices and low latency',
    icon: '🎭',
  },
  {
    id: 'hume_evi',
    name: 'Hume AI EVI',
    voices: ['ITO', 'KORA', 'DACHER', 'AURA', 'FINN', 'STELLA'],
    languages: ['en'],
    description: 'Hume AI Empathic Voice Interface with emotional intelligence',
    icon: '💜',
  },
  {
    id: 'vapi',
    name: 'Vapi Voice AI',
    voices: ['jennifer', 'mark'],
    languages: ['en', 'es', 'fr', 'de'],
    description: 'Vapi platform for building voice AI agents with multiple LLM support',
    icon: '📞',
  },
  {
    id: 'retell',
    name: 'Retell AI',
    voices: ['eleven_labs_rachel', 'eleven_labs_josh', 'play_ht_jennifer'],
    languages: ['en', 'es'],
    description: 'Retell AI for building production-ready voice agents',
    icon: '🚀',
  },
  {
    id: 'custom',
    name: 'Custom S2S',
    voices: [],
    languages: [],
    description: 'Custom speech-to-speech integration',
    icon: '⚙️',
  },
];

export const VOICE_PIPELINES = [
  {
    id: 'GEMINI_LIVE',
    name: 'Gemini Live (existing S2S)',
    description: 'Existing audio-to-audio Gemini pipeline',
  },
  {
    id: 'STT_LLM_TTS',
    name: 'STT → LLM → TTS',
    description: 'Deepgram, configurable LLM, and ElevenLabs',
  },
];



export const NODE_TYPES = {
  START: 'start',
  SAY: 'say',
  LISTEN: 'listen',
  CONDITION: 'condition',
  QUESTION: 'question',
  KNOWLEDGE_LOOKUP: 'knowledge_lookup',
  TAG: 'tag',
  END_CALL: 'end_call',
};
