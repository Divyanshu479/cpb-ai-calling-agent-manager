/**
 * callOutcome.js — Shared utility for rendering the `callOutcome` field.
 *
 * The `callOutcome` field is the authoritative, human-facing result of a call session.
 * It is set by the backend in finalizeSessionFromBridge and the Twilio AMD webhook.
 *
 * For backwards compatibility, if callOutcome is empty (sessions predating the field),
 * we fall back to deriving an outcome from the legacy `status` and `toolEndReason` fields.
 */

export const CALL_OUTCOME_OPTIONS = [
  { value: '', label: 'All results' },
  { value: 'answered',         label: 'Answered' },
  { value: 'agent_ended',      label: 'Agent Ended' },
  { value: 'voicemail',        label: 'Voicemail' },
  { value: 'call_screening',   label: 'Call Screened' },
  { value: 'ivr',              label: 'IVR / Menu' },
  { value: 'no_answer',        label: 'No Answer' },
  { value: 'busy',             label: 'Busy' },
  { value: 'silence_timeout',  label: 'No Activity' },
  { value: 'max_duration',     label: 'Max Duration' },
  { value: 'failed',           label: 'Failed' },
  { value: 'canceled',         label: 'Canceled' },
  { value: 'system_error',     label: 'System Error' },
];

const OUTCOME_CONFIG = {
  answered:        { label: 'Answered',       color: 'bg-emerald-100 text-emerald-800', icon: '✅' },
  agent_ended:     { label: 'Agent Ended',     color: 'bg-green-100 text-green-800',    icon: '🤝' },
  voicemail:       { label: 'Voicemail',       color: 'bg-cyan-100 text-cyan-800',      icon: '📫' },
  call_screening:  { label: 'Call Screened',   color: 'bg-violet-100 text-violet-800',  icon: '🛡️' },
  ivr:             { label: 'IVR / Menu',      color: 'bg-amber-100 text-amber-800',    icon: '📞' },
  no_answer:       { label: 'No Answer',       color: 'bg-yellow-100 text-yellow-800',  icon: '📵' },
  busy:            { label: 'Busy',            color: 'bg-orange-100 text-orange-800',  icon: '🔴' },
  silence_timeout: { label: 'No Activity',     color: 'bg-slate-100 text-slate-700',    icon: '🔇' },
  max_duration:    { label: 'Max Duration',    color: 'bg-blue-100 text-blue-800',      icon: '⏱️' },
  failed:          { label: 'Failed',          color: 'bg-red-100 text-red-800',        icon: '❌' },
  canceled:        { label: 'Canceled',        color: 'bg-gray-100 text-gray-600',      icon: '🚫' },
  system_error:    { label: 'System Error',    color: 'bg-red-100 text-red-700',        icon: '⚠️' },
};

/**
 * Derives the best outcome key from a call session object.
 * Prefers the authoritative `callOutcome` field, then falls back
 * to toolEndReason / status for legacy sessions.
 */
export function resolveCallOutcome(session) {
  if (!session) return null;

  // Authoritative field (new sessions or leads)
  const co = session.callOutcome || session.outcome;
  if (co && OUTCOME_CONFIG[co]) return co;

  // Legacy fallback: derive from toolEndReason
  const toolReason = (session.toolEndReason || '').toLowerCase();
  if (toolReason.includes('call_screening_detected')) return 'call_screening';
  if (toolReason.includes('ivr_detected')) return 'ivr';
  if (toolReason.includes('voicemail_detected') || toolReason.includes('automated_system_detected')) return 'voicemail';

  // Legacy fallback: derive from status
  const status = session.status || '';
  const duration = Number(session.duration || session.durationSeconds || 0);

  if (status === 'voicemail') return 'voicemail';
  if (status === 'no_answer') return 'no_answer';
  if (status === 'busy') return 'busy';
  if (status === 'failed') return 'failed';
  if (status === 'canceled') return 'canceled';
  
  if (status === 'completed' || status === 'connected') {
    if (duration === 0) return 'no_answer';
    return 'answered';
  }

  return null;
}

const HUMAN_RESULTS = new Set([
  'voicemail',
  'call_screening',
  'ivr',
  'no_answer',
  'busy',
  'canceled',
  'max_duration',
  'silence_timeout',
]);

const NORMAL_SOCKET_CLOSE_CODES = new Set([1000, 1001, 1005]);
const WARNING_SOCKET_CLOSE_CODES = new Set([1012, 1013, 1014]);

const socketCloseSeverity = (entry) => {
  const code = Number(entry?.code);
  if (!Number.isFinite(code) || code <= 0 || NORMAL_SOCKET_CLOSE_CODES.has(code)) return null;
  if (WARNING_SOCKET_CLOSE_CODES.has(code)) return 'warning';
  if (code >= 1002 && code <= 1015) return 'error';
  return null;
};

const closeMetaOf = (session) => session?.bridgeMetrics?.closeMeta || session?.closeMeta || {};

const faultCodeOf = (session) => {
  const closeMeta = closeMetaOf(session);
  const geminiCode = Number(closeMeta.gemini?.code);
  if (socketCloseSeverity({ code: geminiCode })) return geminiCode;
  const provider = closeMeta.vobiz || closeMeta.twilio || {};
  const providerCode = Number(provider.code);
  if (socketCloseSeverity({ code: providerCode }) && [1008, 1002, 1003, 1011, 1012, 1013, 1014].includes(providerCode)) {
    return providerCode;
  }
  const match = String(session?.endReason || '').match(/\b(1002|1003|1006|1008|1011|1012|1013|1014)\b/);
  return match ? Number(match[1]) : null;
};

// System faults only: Gemini 1008, quota closes, Vobiz/Twilio socket failures.
// Voicemail, no-answer, and busy are call results and stay on their own colors.
const storedFaultSeverity = (session) => {
  if (!session) return null;
  const reason = String(session.endReason || '').toLowerCase();
  if (/gemini-(start-failed|error|payload-error)|vobiz-error|twilio-error|system-error|no-integration/.test(reason)) {
    return 'error';
  }
  if (/tool-end/.test(reason)) return null;

  const closeMeta = closeMetaOf(session);
  const geminiFault = socketCloseSeverity(closeMeta.gemini);
  if (geminiFault && (!reason || /gemini/.test(reason))) return geminiFault;

  const provider = closeMeta.vobiz || closeMeta.twilio || {};
  const providerCode = Number(provider.code);
  if (/vobiz-close|twilio-close/.test(reason) && [1008, 1002, 1003, 1011].includes(providerCode)) return 'error';
  if (/vobiz-close|twilio-close/.test(reason) && WARNING_SOCKET_CLOSE_CODES.has(providerCode)) return 'warning';

  const code = faultCodeOf(session);
  if (code && /gemini|vobiz|twilio|system/.test(reason)) {
    return WARNING_SOCKET_CLOSE_CODES.has(code) ? 'warning' : 'error';
  }
  return null;
};

export function callOutcomeSeverity(session) {
  const key = resolveCallOutcome(session);
  if (HUMAN_RESULTS.has(key)) return null;
  const fault = storedFaultSeverity(session);
  if (fault) return fault;
  if (key === 'system_error' || key === 'failed') return 'error';
  return null;
}

/**
 * Returns the display config (label, color, icon) for a session's call outcome.
 * Returns null if there is no meaningful outcome yet (e.g., still ringing/initiated).
 */
export function getCallOutcomeBadge(session) {
  let key = resolveCallOutcome(session);
  const fault = storedFaultSeverity(session);
  if (fault && !HUMAN_RESULTS.has(key)) key = 'system_error';
  if (!key || !OUTCOME_CONFIG[key]) return null;

  const badge = { key, ...OUTCOME_CONFIG[key] };
  if (key !== 'system_error') return badge;

  const code = faultCodeOf(session);
  if (fault === 'warning') {
    badge.color = 'bg-amber-100 text-amber-800';
    badge.label = code ? `System Warning ${code}` : 'System Warning';
  } else if (code) {
    badge.label = `System Error ${code}`;
  }
  return badge;
}
