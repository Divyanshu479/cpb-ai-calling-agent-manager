# CPB AI Calling Agent Manager

An AI-powered outbound calling platform that autonomously conducts phone conversations with campaign leads using Google Gemini Live for real-time bidirectional speech, Vobiz/Twilio for telephony, and MongoDB for persistence. The system manages the full lifecycle from lead upload through AI-driven phone conversations to structured post-call data extraction.

## What This Platform Does

- **AI-driven outbound calls**: Automatically dials leads from uploaded CSV lists and conducts real-time conversations using a configurable AI persona powered by Google Gemini Live.
- **Campaign management**: Supports concurrent campaigns with per-campaign concurrency limits, calling windows, retry logic, and automatic completion detection.
- **Real-time audio bridging**: Transcodes audio bidirectionally between telephony providers (Vobiz/Twilio) and Gemini Live with sub-second latency via a pre-warm connection strategy.
- **Structured data extraction**: After every call, a separate Gemini model analyzes the transcript to extract intent, interest level, callback requests, and objections.
- **Multi-role admin interface**: Administrators manage integrations, telephony, and platform-wide reporting. Campaign managers configure AI callers, launch campaigns, upload leads, and review call outcomes.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, Mongoose, PM2 |
| Frontend | React 18, Vite, Redux Toolkit, TailwindCSS |
| AI Engine | Google Gemini Live (bidirectional audio WebSocket) |
| Telephony | Vobiz (primary), Twilio (secondary) |
| Database | MongoDB Atlas |
| Hosting | AWS EC2 (backend), Vercel/Netlify (frontend) |

## Quick Start

```bash
# Backend
cd backend
npm install
cp .env.example .env    # Configure MongoDB URI, JWT secrets, Gemini/Vobiz credentials
npm run dev

# Frontend
cd frontend
npm install
cp .env.example .env.local    # Set VITE_API_URL=http://localhost:5000
npm run dev
```

> **Note**: Vobiz/Twilio webhooks cannot reach `localhost`. Use [ngrok](https://ngrok.com/) for local telephony testing. See the [Configuration and Deployment Guide](docs/10-configuration-and-deployment.md) for details.

### Optional Deepgram live test

The default tests mock Deepgram and do not require credentials. To explicitly test a real
Deepgram connection, set `DEEPGRAM_API_KEY` in the backend environment and run:

```bash
cd backend
$env:DEEPGRAM_LIVE_TEST="true"   # PowerShell; use DEEPGRAM_LIVE_TEST=true on POSIX shells
npm run test:deepgram:live
```

This test is opt-in and is not part of `npm run test:pipeline`; it may incur provider
usage and does not validate the complete telephony pipeline.

### STT_LLM_TTS LLM integration

The LLM adapter currently supports `openai`, `openai_compatible`, and `anthropic`
providers through the existing backend Integration model. Set the provider in the
integration metadata, select the model in the AI caller configuration, and keep the
credential in the integration's backend-only `authConfig`. The credential is never
sent to the frontend. OpenAI-compatible providers use chat-completions SSE streaming;
Anthropic uses Messages SSE streaming. The LLM adapter is currently scaffolding for
the new pipeline and is not connected to live telephony orchestration.

### STT_LLM_TTS ElevenLabs TTS compatibility

ElevenLabs streaming input is used through its WebSocket endpoint with incremental
text messages. The adapter requests `pcm_16000` output and emits normalized audio
chunks after converting them to signed PCM16 8 kHz and then μ-law 8 kHz. This is
required because the current Vobiz and Twilio media paths send/play mono
`audio/x-mulaw` at 8000 Hz (typically 160 bytes per 20 ms frame). ElevenLabs audio
must not be sent directly to Vobiz or Twilio.

The adapter's normalized audio event is:

```text
{ type: "audio", audio: Buffer, encoding: "mulaw", sampleRate: 8000, channels: 1 }
```

Configure the ElevenLabs credential through the existing backend `tts` Integration
(`authConfig`) or `ELEVENLABS_API_KEY` for backend-only development configuration.
Select the voice and model on the AI caller. The adapter does not expose credentials
to the frontend.

### STT_LLM_TTS latency, cost, and load validation

The runtime records STT partial/final latency, endpointing delay, LLM time to first
token, TTS time to first audio, audio transport delay, and end-of-turn-to-first-audio
latency in `CallSession.bridgeMetrics`. Percentiles are reported only for samples
that were actually collected; no target is assumed to be achieved without live
measurements.

Cost reporting is opt-in and estimate-only. Configure verified INR rates in the
backend environment:

```env
TELEPHONY_COST_PER_MINUTE_INR=
DEEPGRAM_COST_PER_MINUTE_INR=
LLM_INPUT_COST_PER_MILLION_TOKENS_INR=
LLM_OUTPUT_COST_PER_MILLION_TOKENS_INR=
ELEVENLABS_COST_PER_MILLION_CHARACTERS_INR=
```

If any rate is absent, the persisted cost status is `unknown` rather than
inventing a total. Infrastructure costs are not included.

Run deterministic application-level checks with:

```text
npm run test:pipeline
npm run test:pipeline:load
```

The load test uses mocked providers at 1, 5, 10, 25, and 50 concurrent calls.
It does not verify provider quotas, network latency, live pricing, or production
resource capacity.

## Repository Structure

```
cpb-ai-calling-agent-manager/
├── backend/                 # Node.js/Express API server + WebSocket bridges
│   ├── server.js            # Runtime entry point
│   ├── ecosystem.config.cjs # PM2 process configuration
│   └── src/
│       ├── controllers/     # HTTP request handlers
│       ├── models/          # Mongoose schemas (9 models)
│       ├── routes/          # Route registration
│       └── services/        # Business logic, telephony bridges, queue system
├── frontend/                # React + Vite SPA
│   └── src/
│       ├── pages/           # Admin and Campaign Manager views
│       ├── store/           # Redux Toolkit slices
│       └── components/      # Shared UI components
└── docs/                    # Technical documentation
```

## Documentation

For the complete technical documentation — architecture, data model, workflow guides, operational runbooks, and more — see the **[Documentation Index](docs/README.md)**.
