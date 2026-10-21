# STT_LLM_TTS staging rollout

This checklist enables a controlled staging trial without changing existing
Gemini Live callers or enabling the pipeline globally.

## Current safety controls

- `GEMINI_LIVE` remains the default when `s2sConfig.pipeline` is absent.
- `STT_LLM_TTS_ENABLED` defaults to `false`.
- The pipeline is selected per AI caller and is not applied to existing callers.
- Campaign start validates the selected caller and provider integrations before
  dialing.
- Provider credentials remain in backend `Integration.authConfig`; active
  integration responses redact credential-like metadata.
- Vobiz and Twilio use separate STT_LLM_TTS WebSocket paths. Existing Gemini
  bridge paths are separate and were not modified.

## Required backend configuration

Set these only in the staging secret manager or backend environment. Do not
commit `.env` files or put provider secrets in frontend variables.

```env
STT_LLM_TTS_ENABLED=false
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=

# Optional estimate-only INR rates. Leave blank when not verified.
TELEPHONY_COST_PER_MINUTE_INR=
DEEPGRAM_COST_PER_MINUTE_INR=
LLM_INPUT_COST_PER_MILLION_TOKENS_INR=
LLM_OUTPUT_COST_PER_MILLION_TOKENS_INR=
ELEVENLABS_COST_PER_MILLION_CHARACTERS_INR=
```

The preferred production setup is to store Deepgram, LLM, and ElevenLabs
credentials in active backend integrations of types `stt`, `llm`, and `tts`.
Environment API keys are fallback development configuration only. Never expose
them through `VITE_*`, browser configuration, logs, URLs, or webhook
parameters.

## Staging deployment steps

1. Deploy the backend and frontend to an isolated staging environment.
2. Confirm MongoDB points to the staging database or an approved staging
   namespace. No migration or destructive update is required: old callers
   without `pipeline` resolve to `GEMINI_LIVE`.
3. Confirm `STT_LLM_TTS_ENABLED=false` during deployment.
4. Configure active staging integrations:
   - Vobiz or Twilio telephony.
   - Deepgram STT with streaming permission and quota.
   - A supported LLM provider/model with streaming access.
   - ElevenLabs streaming TTS with the selected voice/model and quota.
5. Confirm the public HTTPS/WSS URL is reachable by the selected telephony
   provider.
6. Confirm the existing Gemini S2S health path with an existing Gemini caller
   before enabling the new pipeline.
7. Create a new test AI caller. Do not edit an existing production caller.
8. Select `STT_LLM_TTS`, the Deepgram integration, LLM integration/model, and
   ElevenLabs integration/model/voice.
9. Create a small restricted staging campaign with one to five test leads.
10. Set `STT_LLM_TTS_ENABLED=true` only in staging.
11. Start the restricted campaign and verify the campaign-start validation
    succeeds before placing calls.
12. Verify Vobiz `start`, `media`, outbound `playAudio`, `clearAudio`, and
    `stop` behavior. If using Twilio, verify `media`, outbound media, `clear`,
    and stop behavior separately.
13. Keep the test campaign paused unless an operator is actively observing it.

## Complete voice-flow test plan

For each telephony provider intended for production:

- Answer webhook returns the expected bidirectional media instruction.
- WebSocket receives `connected` and `start`.
- Caller audio reaches Deepgram as PCM16, 16 kHz, mono.
- Partial and final transcripts are emitted without duplicate final turns.
- Endpointing produces one LLM turn.
- LLM response streams in order and records usage when available.
- ElevenLabs emits incremental audio.
- Audio is converted to μ-law 8 kHz mono before telephony delivery.
- Vobiz receives `playAudio` with the correct stream ID and sample rate.
- Twilio receives the expected outbound media payload.
- Caller speech during playback cancels obsolete LLM/TTS work and clears stale
  audio.
- Hangup, provider error, WebSocket close, timeout, and duplicate webhook each
  release resources and finalize the session once.
- CallSession stores transcript turns, outcome/finalization data, latency
  summaries, usage, and cost status.

## Monitoring during staging

Monitor per call and per provider:

- Connection failures and reconnect attempts.
- Deepgram partial/final transcript latency and transcript quality.
- Endpointing delay.
- LLM time to first token and provider errors.
- ElevenLabs time to first audio and character usage.
- End-of-turn-to-first-audio and total turn latency.
- Call duration and hangup reason.
- WebSocket close/error counts.
- Campaign queue delay, retries, duplicate-call attempts, and concurrency.
- `CallSession.bridgeMetrics.cost.status` and component estimates.

The configured cost values are estimates only. If any rate is absent, cost
status must remain `unknown`. Do not treat mocked latency or cost as provider
billing evidence.

## Rollback conditions

Immediately pause the restricted campaign and disable the pipeline if any of
the following occur:

- Repeated call setup or provider connection failures.
- Audio is missing, distorted, duplicated, or delivered to the wrong call.
- Transcript quality is unacceptable for the business use case.
- Sustained first-audio or turn latency is unacceptable.
- Unexpected provider usage or cost.
- Duplicate calls, uncontrolled retries, or resource leaks.
- Any regression in an existing Gemini S2S caller.

## Rollback procedure

1. Pause or stop only the STT_LLM_TTS test campaign.
2. Set `STT_LLM_TTS_ENABLED=false` in the backend staging environment.
3. Restart or redeploy the backend so the flag is reloaded.
4. Do not edit or delete caller, campaign, lead, or CallSession documents.
5. Allow active calls to terminate normally where possible; use the existing
   telephony hangup control only for stuck calls.
6. Verify that existing callers with no explicit pipeline still resolve to
   `GEMINI_LIVE`.
7. Confirm Gemini S2S call setup, media streaming, and finalization.
8. Preserve failed CallSession records and bridge metrics for diagnosis.

Disabling the flag blocks new STT_LLM_TTS calls at validation time. It does not
rewrite saved caller configuration or damage existing campaign state.

## External permissions and quotas

Before production rollout, obtain and verify:

- Deepgram API key with live streaming transcription permission, model access,
  endpointing support, and sufficient concurrency/quota.
- LLM credentials with streaming access to the selected model, rate limits, and
  production billing approval.
- ElevenLabs API key with streaming TTS access, voice/model access, and enough
  character quota.
- Vobiz account permission for bidirectional streaming and outbound
  `playAudio`/`clearAudio`.
- Twilio Media Streams permission and account limits if Twilio is used.
- Public TLS WebSocket reachability from the telephony provider.

## Status

### Completed and locally tested

- Feature flag remains disabled by default.
- Backward-compatible Gemini pipeline default.
- Per-caller pipeline selection and validation.
- Backend-only provider credential handling.
- Mocked adapter and orchestration tests.
- Duplicate close, interruption, timeout, provider error, and isolation tests.
- Mocked concurrency tests at 1, 5, 10, 25, and 50 calls.
- Frontend production build.

### Not tested in this environment

- Live Vobiz media delivery through the new pipeline.
- Live Twilio media delivery through the new pipeline.
- Live Deepgram, LLM, or ElevenLabs connections.
- Real provider quotas, throttling, billing, or pricing.
- Production latency percentiles and the sub-1.2-second target.
- Multi-instance distributed coordination.

### Deployment gate

Do not declare production readiness until the staging test plan passes with
real provider credentials and the rollback criteria are reviewed by the
operator responsible for the campaign.
