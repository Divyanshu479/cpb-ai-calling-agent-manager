# Known Gaps

This document is an honest inventory of what is incomplete, unverified, or missing in the platform. These are not guesses — they are specific findings identified during code analysis where implementation evidence is ambiguous, absent, or explicitly incomplete.

For operational impact and workarounds, see [Operational Guide](11-operational-guide.md).

---

## Architecture Gaps

### 1. Campaign Worker State Not Recovered on Restart

**What exists**: `CampaignAutodialerService.activeCampaigns` and `DialQueueWorker.activeCampaigns` are in-memory Maps that track which campaigns have active worker loops.

**What is missing**: No boot-time recovery scans for `Campaign.status === 'running'` and automatically restarts workers.

**Impact**: After any PM2 restart, all campaigns in `running` status are stalled. Outbound calling halts until an operator manually clicks Start on each campaign in the UI.

**Evidence**: `server.js` does not call any autodialer `resume()` or `recoverRunningCampaigns()` function at startup. The `recoverMissedExtractions()` function exists for extraction recovery but covers only post-call extraction, not worker recovery.

**Workaround**: Manual operator intervention after every restart.

---

### 2. Extraction Queue Recovery Covers Only 50 Sessions Per Boot

**What exists**: `recoverMissedExtractions()` uses `.limit(50)` when querying for sessions that need extraction.

**What is missing**: Pagination or a mechanism to continue processing beyond the first 50 unprocessed sessions.

**Impact**: If there are 500 missed extractions after a crash, only 50 are recovered per restart. The remaining 450 require additional restarts or a manual script.

**History**: The limit was recently reduced from 5,000 to 50 to prevent OOM crashes on the `t2.micro` instance during boot-time recovery.

---

## Unverified Features

### 3. Script Flow Runtime Execution

**What exists**: `AICaller.scriptFlow` stores a node-and-edge graph in MongoDB. The `ScriptBuilder.jsx` frontend page lets campaign managers build this graph visually. Node types include `start`, `say`, `listen`, `condition`, `question`, `knowledge_lookup`, `tag`, and `end_call`.

**What is missing**: Evidence that the bridge (`vobizGeminiBridge.js` or `twilioGeminiBridge.js`) actually reads and executes `scriptFlow` at call time.

**What is observed**: The bridge assembles a system prompt from `AICaller.s2sConfig.systemPrompt`, `qaEntries`, and hardcoded directives. No code was found that iterates `scriptFlow.nodes` during the call. The `buildContextualSystemPrompt()` function does not reference `scriptFlow`.

**Assessment**: The Script Builder is likely UI scaffolding for a feature that is either in-progress or was replaced by the system prompt approach. **This needs verification by a human reviewing the full bridge code.**

---

### 4. Knowledge Base Feature Not User-Accessible

**What exists**: `KnowledgeBase` model with processing states, `knowledgeController.js` with full CRUD routes, and `AICaller.knowledgeBaseIds` field for linking knowledge documents to callers.

**What is missing**: No route in the frontend `App.jsx` for campaign managers to manage knowledge bases. No UI page found in `pages/cm/`.

**Impact**: Knowledge bases can be created via the API but not via the UI. The feature is wired in the backend but not exposed to end users.

---

## Data Model Questions

### 5. Dual Phone Fields on Lead (`phone` vs `phoneNumber`)

**Observation**: The `Lead` model has both `phone` (required) and `phoneNumber` (optional). The call initiation service uses `lead.phoneNumber || lead.phone`, preferring `phoneNumber` when available.

**Open question**: Is this intentional (some telephony providers require different phone formats) or a historical artifact from a schema migration? What populates `phoneNumber` vs `phone` during CSV import?

**Risk**: Confusion for engineers modifying the CSV import logic or debugging why a lead was called at an unexpected number.

---

### 6. `TelephonyConfig` vs `Integration` (Legacy Conflict)

**Observation**: Two parallel data models exist for telephony provider configuration:

- **`TelephonyConfig`**: A legacy singleton model. Written to by the admin `/admin/telephony` UI page via `telephonyController.getTelephonyConfig/saveTelephonyConfig`.
- **`Integration`**: The active model. Read by `s2sCallingService` when initiating calls.

**Gap**: The admin Telephony Settings page (`/admin/telephony`) writes to `TelephonyConfig`, but the call pipeline only reads from `Integration`. These are completely disconnected.

**Impact**: An admin may configure telephony via the Settings page, see a success message, and believe the configuration is active — but it has zero effect on actual calls. Only the Integration management page (`/admin/integrations`) affects the live call path.

**Recommendation**: Either remove the Telephony Settings page or migrate it to write to `Integration` records.

---

### 7. Campaign Stats — Stored vs. Aggregated

**Observation**: `Campaign.stats.*` fields (e.g., `interested`, `notInterested`, `totalCalls`) exist in the schema and are updated by `Campaign.incrementStats()`. However, when the campaign list is queried, `getCampaignsWithAggregatedStats()` runs a live MongoDB aggregation from `CallSession` documents and **overwrites** the stored stats.

**Open question**: Are the stored `Campaign.stats` ever the authoritative source? If the live aggregation always replaces them, then `Campaign.incrementStats()` is effectively dead code and the stored stats fields are noise.

---

## Security Gaps

### 8. Webhook Endpoints Are Fully Public

**Observation**: All telephony webhook routes have **no authentication middleware**:

- `POST /api/telephony/twilio/voice`
- `POST /api/telephony/twilio/status`
- `POST /api/telephony/twilio/amd`
- `POST /api/telephony/vobiz/answer`
- `POST /api/telephony/vobiz/hangup`
- `POST /api/telephony/vobiz/stream-status`

Any HTTP client can POST to these endpoints.

**Risk**: An attacker could forge fake Twilio/Vobiz status callbacks to manipulate `CallSession` state, potentially marking calls as completed that never happened, or triggering unintended state transitions.

**Missing**: Twilio provides `X-Twilio-Signature` validation. No equivalent verification is implemented for either provider.

---

### 9. JWT Token Not Invalidated on Logout

**Observation**: JWT is a stateless token. There is no token blocklist, no Redis-based revocation, and no server-side session store.

**Impact**: If a manager's JWT is stolen (e.g., via XSS or a compromised machine), it remains valid until its expiry (default: 1 day via `JWT_EXPIRE`). There is no way to force-expire a session.

**Current behavior on logout**: The frontend simply clears the token from `localStorage`. The token itself remains cryptographically valid — any client possessing it can continue making authenticated API calls until it expires naturally.

---

## Operational Gaps

### 10. No Alerting or Structured Monitoring

**Observation**: The system relies entirely on human operators watching PM2 logs or the AWS console.

**Missing**:
- No structured metrics (CPU, memory, queue depth, call success rate)
- No alerting for high error rates or consecutive failures
- No alerting for stuck campaigns or exhausted CPU credits
- No health dashboard beyond the admin Queue Dashboard in the UI
- No log aggregation service

**Impact**: Problems are discovered only when a human notices symptoms (e.g., calls stopped, SSH is slow, dashboard crashes). There is no proactive notification.

---

### 11. Concurrency Limit Inflation After Restart

**Observation**: When the server restarts during active calls, workers stop but `DialQueueJob` documents remain in `claimed` status until their leases expire (5.5 minutes).

**Impact**: If the server restarts and immediately starts new calls, for up to 5.5 minutes there may be phantom `claimed` jobs inflating the concurrency count. This can temporarily block legitimate new calls because `claimNextJob()` sees the concurrency limit as saturated.

**Mitigation in place**: Lease timeout ensures phantom claims auto-clear within 5.5 minutes. This is self-healing but not instantaneous.

---

## Code Debt

### 12. `CampaignControls.jsx` is Dead Code

`frontend/src/components/campaigns/CampaignControls.jsx` implements a modal with campaign start/pause/stop controls but is **not imported or mounted by any currently-routed page**. Its logic was migrated directly into `CampaignDetail.jsx`.

**Recommendation**: Delete the file or clearly mark it as deprecated to avoid confusion.

---

### 13. `fix_global_stuck.js` is Undocumented

`backend/fix_global_stuck.js` is an operational script that resets stuck `DialQueueJob` documents. It exists with no README, no inline documentation, and no explanation of when or how to use it.

**Recommendation**: Add a header comment explaining:
- What it does (resets `claimed` jobs with expired leases to `waiting`)
- When to run it (after server crashes with stuck jobs)
- How to run it (`node fix_global_stuck.js`)
- Safety considerations (safe to run while the server is running)

---

### 14. Redundant Calling Window Logic

**Observation**: The calling window check (`isCampaignWithinCallingWindow`) is implemented **twice**:
1. As a standalone function in `campaignAutodialerService.js`
2. As a method on the `Campaign` model (`campaign.isWithinCallingWindow()`)

The dial queue worker uses the model method. The autodialer service has its own identical standalone implementation.

**Recommendation**: Remove the duplicate in `campaignAutodialerService.js` and use the model method everywhere.

---

### 15. Shared Status Handler Name (`handleTwilioStatusUpdate`)

The `callSessionService.handleTwilioStatusUpdate()` function is used for **both** Twilio and Vobiz status callbacks, despite its name suggesting Twilio-only. This is confusing for engineers reading the Vobiz webhook handler code.

**Recommendation**: Rename to `handleProviderStatusUpdate()` or create separate handlers.
