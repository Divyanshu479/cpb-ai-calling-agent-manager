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

export const PROVIDER_FAILURE_PAUSE_THRESHOLD = 10;


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

export { VOICE_PIPELINES, DEFAULT_VOICE_PIPELINE } from './voicePipelines.js';

export const KNOWLEDGE_BASE_STATUSES = {
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// ========== DIAL QUEUE SYSTEM CONSTANTS ==========

export const DIAL_QUEUE_JOB_STATUSES = {
  WAITING: 'waiting',           // Ready to claim and execute
  CLAIMED: 'claimed',           // Leased to a worker, in progress
  COMPLETED: 'completed',       // Attempt succeeded, call connected
  BACKOFF: 'backoff',           // Temporary failure, waiting for exponential delay
  QUEUE_TAIL: 'queue_tail',     // Retryable failure (busy/no_answer), re-enqueue to tail
  DEAD_LETTER: 'dead_letter',   // Max attempts exceeded, manual intervention needed
  TERMINAL: 'terminal',         // Unretryable failure (invalid lead data, etc)
};

export const RETRY_MODES = {
  QUEUE_TAIL: 'queue_tail',     // Push failed jobs to queue tail immediately (no timer)
  BACKOFF: 'backoff',           // Exponential backoff with jitter before re-enqueue
};

export const FAILURE_CATEGORIES = {
  RETRYABLE: 'retryable',       // no_answer, busy, brief_silence (user not ready)
  TRANSIENT: 'transient',       // Network errors, timeout, provider API errors
  TERMINAL: 'terminal',         // Invalid lead, permission denied, unsupported carrier
};

export const HARD_STOP_TIMEOUT_MS = 10 * 60 * 1000; // 5 minutes
export const DIAL_QUEUE_LEASE_TIMEOUT_MS = 10.5 * 60 * 1000; // 5.5 minutes (aggressively free stuck slots)
export const DIAL_QUEUE_CLAIM_INTERVAL_MS = 1000; // Worker checks for claiming every 1s
export const DIAL_QUEUE_CLAIM_BATCH_SIZE = 10; // Claim up to 10 jobs per interval
