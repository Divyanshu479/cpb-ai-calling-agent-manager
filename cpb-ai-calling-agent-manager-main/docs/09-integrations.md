# Integrations

This document defines the external system contracts — how the platform communicates with Vobiz, Twilio, and Google Gemini Live. It covers API calls, webhook handling, audio streaming protocols, and failure behavior for each integration.

For how the bridge manages real-time audio during a call, see [Vobiz-Gemini Bridge](08-vobiz-gemini-bridge.md). For how integrations are stored and resolved, see [Data Model — Integration](05-data-model.md#integration).

---

## Integration Model and Resolution

All external service credentials are stored in the `Integration` model. When `s2sCallingService.initiateLeadCall()` needs to place a call, it resolves two integrations:

### Gemini (S2S) Resolution Priority

1. `AICaller.s2sConfig.integrationId` — explicit assignment on the AI Caller
2. `Integration.findOne({ type: 's2s', isActive: true, isDefault: true })` — the default S2S integration
3. `Integration.findOne({ type: 's2s', isActive: true })` with name containing `"gemini"` — fallback name match
4. **Error**: `"No active Gemini S2S integration found"`

### Telephony Resolution Priority

1. `AICaller.telephonyConfig.integrationId` — explicit assignment on the AI Caller
2. `Integration.findOne({ type: 'telephony', isDefault: true, isActive: true })` — the default telephony integration
3. **Error**: `"No active telephony integration found"`

The pre-save hook on Integration enforces **one default per type** — setting `isDefault: true` on one integration automatically clears it on all others of the same type.

---

## Vobiz Integration

Vobiz is the **primary telephony provider** in production.

### Configuration

Stored in an `Integration` document with `type: 'telephony'`:

| Field | Value |
|-------|-------|
| `authConfig.username` | Vobiz `authId` |
| `authConfig.password` | Vobiz `authToken` |
| `metadata.provider` | `vobiz` |
| `metadata.apiBaseUrl` | `https://api.vobiz.com/v1` (or equivalent) |
| `metadata.callerIds` | Array of available outbound phone numbers |

### Call Initiation

`vobizService.initiateCall()`:

```
POST /Account/{authId}/Call/
Headers: Authorization: Basic base64(authId:authToken)
Body: {
  from: callerPhoneNumber,
  to: leadPhoneNumber,
  answer_url: "https://{backendUrl}/api/telephony/vobiz/answer?callSessionId={id}&...",
  answer_method: "POST",
  hangup_url: "https://{backendUrl}/api/telephony/vobiz/hangup?callSessionId={id}&...",
  hangup_method: "POST"
}
Response: { call_uuid: "..." }
```

The `answer_url` and `hangup_url` include query parameters that identify the call session, allowing the webhook handlers to correlate callbacks to the correct session.

### Webhook Callbacks

All webhook endpoints are **public** — no authentication middleware. See [Known Gaps](12-known-gaps.md).

**Answer webhook** — `POST /api/telephony/vobiz/answer`

Fired when the lead picks up. The handler returns JSON instructing Vobiz to open a WebSocket audio stream:

```json
{
  "action": "stream",
  "streamUrl": "wss://{backendUrl}/api/telephony/vobiz/media-stream?callSessionId={id}&leadId={id}&..."
}
```

**Hangup webhook** — `POST /api/telephony/vobiz/hangup`

Fired when either party hangs up. The handler calls `callSessionService.handleTwilioStatusUpdate()` (shared handler despite the name) to update the `CallSession` status to its terminal state.

**Stream status webhook** — `POST /api/telephony/vobiz/stream-status`

Fired when the WebSocket audio stream connects or disconnects. Used for logging and diagnostics.

### Audio Streaming

Vobiz opens a WebSocket to `wss://{backendUrl}/api/telephony/vobiz/media-stream`. The bridge receives this via its upgrade handler.

| Direction | Format | Rate | Frame Size |
|-----------|--------|------|-----------|
| Vobiz → Server | μ-law PCM | 8,000 Hz | 160 bytes (20ms) |
| Server → Vobiz | μ-law PCM | 8,000 Hz | 160 bytes (20ms) |

Vobiz message events: `start` (stream begins), `media` (audio frame), `stop` (stream ends), `clearedaudio` (barge-in acknowledgment).

### CDR Polling

`vobizCdrPoller.js` runs every 60 seconds as a fallback for missed webhooks:

```
GET /Account/{authId}/cdr/recent?limit=50
```

For each CDR entry, the poller finds the matching `CallSession` by `providerCallId`. If the session is not yet in a terminal status, it triggers a status update — recovering sessions where the hangup webhook was never delivered.

### Force Hangup

`vobizService.hangupCall(callUuid)`:

```
DELETE /Account/{authId}/Call/{callUuid}/
Headers: Authorization: Basic base64(authId:authToken)
```

Called by the bridge during `executeEndCall()` to force-terminate the telephony connection.

---

## Twilio Integration

Twilio is the **secondary telephony provider**. Fully implemented but not the primary production call path.

### Configuration

| Field | Value |
|-------|-------|
| `authConfig.username` | Twilio AccountSid |
| `authConfig.password` | Twilio AuthToken |
| `metadata.provider` | `twilio` |
| `metadata.callerIds` | Array of Twilio phone numbers |

### Call Initiation

Uses the Twilio REST API (or SDK) to create an outbound call with TwiML instructions:

```
POST /2010-04-01/Accounts/{AccountSid}/Calls.json
Body: {
  To: leadPhoneNumber,
  From: callerPhoneNumber,
  Url: "https://{backendUrl}/api/telephony/twilio/voice?callSessionId={id}",
  StatusCallback: "https://{backendUrl}/api/telephony/twilio/status?callSessionId={id}",
  MachineDetection: "DetectMessageEnd"  (if AMD enabled)
}
```

### Webhook Callbacks

**Voice webhook** — `POST /api/telephony/twilio/voice`

Returns TwiML instructing Twilio to open a Media Stream WebSocket:

```xml
<Response>
  <Connect>
    <Stream url="wss://{backendUrl}/api/telephony/twilio/media-stream?callSessionId={id}" />
  </Connect>
</Response>
```

**Status callback** — `POST /api/telephony/twilio/status`

Fired on call status changes (ringing, answered, completed, etc.). Updates `CallSession` status.

**AMD callback** — `POST /api/telephony/twilio/amd`

Fired when Twilio's Answering Machine Detection resolves. If `AnsweredBy === 'machine_start'` or similar, the handler can trigger early hangup. The Vobiz bridge relies on Gemini-based voicemail detection instead of a provider-level AMD service.

### Audio Streaming

Same general pattern as Vobiz — Twilio opens a WebSocket, and the bridge transcodes audio bidirectionally. The audio format is the same (μ-law 8kHz) but the WebSocket message framing follows Twilio's Media Streams protocol.

---

## Google Gemini Live Integration

### Configuration

Stored in an `Integration` document with `type: 's2s'`:

| Field | Value |
|-------|-------|
| `authConfig.token` | Google Gemini API key |

### Per-Call WebSocket Setup

Each active call gets a dedicated Gemini Live WebSocket. The bridge opens:

```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={apiKey}
```

On `open`, the bridge sends a `BidiGenerateContentSetup` message:

```json
{
  "setup": {
    "model": "models/gemini-3.8-live",
    "generationConfig": {
      "responseModalities": ["AUDIO"],
      "temperature": 0.8,
      "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Kore" } } },
      "thinkingConfig": { "thinkingBudget": 0 }
    },
    "tools": [{ "functionDeclarations": [{ "name": "end_call", "description": "...", "parameters": { ... } }] }],
    "systemInstruction": { "parts": [{ "text": "assembled system prompt" }] },
    "inputAudioTranscription": {},
    "outputAudioTranscription": {}
  }
}
```

The `end_call` tool declaration tells Gemini it can terminate the conversation by calling this function with `reason` and `summary` parameters.

### Audio Format Requirements

| Direction | Format | Sample Rate |
|-----------|--------|-------------|
| Server → Gemini | PCM16 (linear) | 16,000 Hz |
| Gemini → Server | PCM16 (linear) | 24,000 Hz |

The bridge handles all codec conversion. See [Vobiz-Gemini Bridge — Audio Codec Pipeline](08-vobiz-gemini-bridge.md#phase-4-real-time-audio-relay) for the full conversion chain.

### Post-Call Extraction (Separate API)

After a call ends, the extraction queue sends the transcript to a **separate, non-Live Gemini API** call for structured data extraction:

```
Model: gemini-2.5-flash (configurable via GEMINI_EXTRACTION_MODEL)
Input: Full transcript text
Output: Structured JSON (intent, interest_level, callback, objections, notes)
```

This is a standard Gemini API request, not a WebSocket connection. It runs asynchronously in the extraction queue.

---

## Failure Handling Per Integration

| Integration | Failure Type | Handling |
|------------|-------------|---------|
| Vobiz API | Call initiation fails | `s2sCallingService` catches error → worker retries via `ackJobWithRetry` |
| Vobiz webhook | Hangup webhook missed | CDR poller recovers within 60 seconds |
| Vobiz WebSocket | Audio stream drops mid-call | `vobizWs.on('close')` → `closeSession('vobiz-close')` |
| Twilio API | Call initiation fails | Same retry path as Vobiz |
| Twilio webhook | Status callback missed | No CDR poller equivalent for Twilio |
| Gemini Live WS | Connection fails during pre-warm | Pre-warm session cleaned up; call may proceed without pre-warm or fail |
| Gemini Live WS | Drops mid-call | `geminiWs.on('close')` → `closeSession('gemini-close')` |
| Gemini Live WS | `setupComplete` never arrives | Pre-warm TTL timer (5 min) → auto-cleanup |
| Gemini extraction | Extraction API fails | `extractor.ran = true`, `extractor.success = false`, `extractor.error` logged; session data preserved |
| Deepgram | WebSocket closes | Gemini native transcription continues as fallback |
