# Configuration and Deployment

This document covers everything needed to configure, set up, and deploy the platform — environment variables, local development, production deployment, and infrastructure requirements.

---

## Environment Variables

### Required for Operation

| Variable | Location | Purpose |
|----------|----------|---------|
| `MONGODB_URI` | `backend/.env` | MongoDB Atlas connection string |
| `JWT_SECRET` | `backend/.env` | JWT access token signing secret |
| `JWT_REFRESH_SECRET` | `backend/.env` | Refresh token signing secret |
| `BACKEND_PUBLIC_URL` | `backend/.env` | Public URL of the backend (used in webhook URLs sent to Vobiz/Twilio) |
| `FRONTEND_URL` | `backend/.env` | CORS allowed origin for the frontend |
| `VITE_API_URL` | `frontend/.env` | Base URL for Axios in the frontend (must point to the backend) |

### Optional / Tuning

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `5000` | Backend HTTP port |
| `NODE_ENV` | `development` | Controls logging behavior |
| `ALLOWED_ORIGINS` | (none) | Comma-separated additional CORS origins |
| `BACKEND_URL` | Same as `BACKEND_PUBLIC_URL` | Fallback URL for webhooks |
| `TWILIO_MEDIA_STREAM_WS_URL` | Derived from `BACKEND_PUBLIC_URL` | WebSocket URL for Twilio Media Streams |
| `VOBIZ_STREAM_WS_URL` | Derived from `BACKEND_PUBLIC_URL` | WebSocket URL for Vobiz streams |
| `VOBIZ_CDR_POLL_MS` | `60000` | CDR polling interval in milliseconds |
| `GEMINI_EXTRACTION_MODEL` | `gemini-2.5-flash` | Model for post-call structured extraction |
| `GEMINI_EXTRACTION_API_KEY` | (none) | Dedicated Gemini API key for post-call extraction (overrides MongoDB integration key) |
| `CAMPAIGN_AUTODIALER_ENABLED` | `true` | Set to `false` to disable the autodialer entirely |
| `CAMPAIGN_AUTODIALER_LOOP_MS` | `5000` | Autodialer service loop interval |
| `MAX_GLOBAL_CONCURRENCY` | `50` | Maximum concurrent calls across all campaigns |
| `JWT_EXPIRE` | `1d` | Access token expiry |
| `JWT_REFRESH_EXPIRE` | `7d` | Refresh token expiry |
| `DEBUG` | `false` | Extra debug logging (bridge-specific) |
| `DEEPGRAM_API_KEY` | (none) | Enables Deepgram Nova-3 for Hinglish transcription |

### Twilio Bridge Tuning

| Variable | Default | Purpose |
|----------|---------|---------|
| `TWILIO_GEMINI_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `TWILIO_GEMINI_PREWARM_ENABLED` | `true` | Enable Gemini pre-warm |
| `TWILIO_GEMINI_PREWARM_TTL_MS` | `120000` | How long to hold pre-warm open (ms) |
| `TWILIO_GEMINI_MAX_CALL_WRAPUP_GRACE_SECONDS` | `30` | Extra time after AI ends call |
| `TWILIO_GEMINI_PROACTIVE_GREETING_ENABLED` | `true` | Auto-greeting on connect |

### Hardcoded Constants (`config/constants.js`)

These are not configurable via environment variables — they require a code change:

| Constant | Value | Purpose |
|----------|-------|---------|
| `HARD_STOP_TIMEOUT_MS` | 5 minutes | Bridge forcibly ends call after this time |
| `DIAL_QUEUE_LEASE_TIMEOUT_MS` | 5.5 minutes | Worker lease expires, freeing concurrency slot |
| `DIAL_QUEUE_CLAIM_INTERVAL_MS` | 1,000 ms | How often the worker polls for new jobs |
| `DIAL_QUEUE_CLAIM_BATCH_SIZE` | 10 | Max jobs claimed per tick (not currently used in loop) |

For the design rationale behind the timer values (5 min / 5 min / 5.5 min), see [System Architecture — Timer Cascade](02-system-architecture.md#critical-design-decisions).

---

## Local Development Setup

### Prerequisites

- Node.js 18+ (ESM support required)
- A MongoDB Atlas cluster (or local MongoDB instance)
- ngrok (for testing telephony webhooks locally)

### Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` with:
- `MONGODB_URI` — your MongoDB connection string
- `JWT_SECRET` and `JWT_REFRESH_SECRET` — any secure random strings
- `BACKEND_PUBLIC_URL` — your ngrok URL (see below) or `http://localhost:5000`
- Gemini and Vobiz credentials (obtain from integration dashboards)

```bash
npm run dev    # or: node --watch server.js
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

Edit `.env.local`:
- `VITE_API_URL=http://localhost:5000`

```bash
npm run dev
```

### Webhook Challenge for Local Dev

Vobiz and Twilio cannot reach `localhost`. Use ngrok to expose the backend:

```bash
ngrok http 5000
```

Copy the ngrok HTTPS URL and update in `backend/.env`:
- `BACKEND_PUBLIC_URL=https://xxxx.ngrok.io`
- `VOBIZ_STREAM_WS_URL=wss://xxxx.ngrok.io/api/telephony/vobiz/media-stream`

All webhook URLs are derived from `BACKEND_PUBLIC_URL`, so setting it once configures all webhooks.

---

## Production Deployment — Backend (AWS EC2)

### PM2 Configuration (`ecosystem.config.cjs`)

| Setting | Value | Purpose |
|---------|-------|---------|
| `instances` | `1` | Single process (no cluster mode) |
| `exec_mode` | `fork` | Standard fork mode |
| `max_memory_restart` | `1G` | Auto-restart if RAM exceeds 1GB |
| `max_restarts` | `10` | Gives up after 10 consecutive crashes |
| `min_uptime` | `10s` | Crash loops detected if process dies within 10 seconds |
| `autorestart` | `true` | Auto-restart on crash |

### Deployment Commands

```bash
# Install dependencies
npm install

# Start with PM2
pm2 start ecosystem.config.cjs

# Or directly
pm2 start server.js --name ai-calling-backend

# View logs
pm2 logs ai-calling-backend

# Restart after code deploy
pm2 restart ai-calling-backend
```

### SSL and Network Requirements

- **Static public IP**: Required for Vobiz/Twilio webhook delivery. Use an AWS Elastic IP.
- **SSL (HTTPS)**: Vobiz requires HTTPS for `answer_url`. Twilio requires HTTPS for all webhooks. Use Nginx + Let's Encrypt or an AWS ALB.
- **WebSocket upgrade support**: The reverse proxy must pass `Upgrade` and `Connection` headers for the audio stream WebSockets.

### Post-Deployment Verification

1. `pm2 status` — verify the process is `online`
2. `curl https://{domain}/api/health` — should return 200
3. Check PM2 logs for `Server running on port 5000` and `MongoDB connected`
4. Verify webhook reachability: Vobiz/Twilio must be able to POST to `https://{domain}/api/telephony/...`

---

## Production Deployment — Frontend (Vercel / Netlify)

The frontend is deployed as a static site. Set the environment variable in the hosting platform's settings:

- `VITE_API_URL=https://{backend-domain}`

### SPA Routing

Both `vercel.json` and `netlify.toml` are configured to redirect all routes to `index.html` for client-side React Router handling:

- **Vercel**: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
- **Netlify**: `[[redirects]] from = "/*" to = "/index.html" status = 200`

---

## Docker / Nginx Deployment

`frontend/nginx.conf` serves the SPA and proxies API and WebSocket traffic to the backend:

- Serves static files from the Vite build output
- Proxies `/api/*` requests to the backend
- Proxies WebSocket upgrades for audio streams
- Falls back to `index.html` for all other routes (SPA)

---

## Infrastructure Requirements

| Resource | Minimum | Notes |
|----------|---------|-------|
| Backend compute | AWS `t2.micro` | Current production. 1GB RAM, burstable CPU. Under active calling load, CPU credits exhaust quickly. Upgrade recommended for sustained use. |
| Database | MongoDB Atlas | Free tier works for dev; M10+ recommended for production |
| Backend storage | ~1GB disk | For PM2 logs. Uploads are held in memory (`multer.memoryStorage`), not on disk |
| Network | Public static IP | Required for Vobiz/Twilio webhook delivery. Elastic IP assigned |
| SSL | Required | HTTPS for webhooks, WSS for audio streams |
