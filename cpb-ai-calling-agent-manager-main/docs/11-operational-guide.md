# Operational Guide

This document is the runbook for operating the platform day-to-day — monitoring, debugging, recovery procedures, and emergency actions. It is written for engineers responsible for keeping the platform running in production.

For system design context, see [System Architecture](02-system-architecture.md). For queue-specific debugging, see [Dial Queue System — Debugging Playbook](07-dial-queue-system.md#debugging-playbook). For bridge internals, see [Vobiz-Gemini Bridge](08-vobiz-gemini-bridge.md).

---

## Monitoring

### Current State

The platform has **no structured monitoring, metrics collection, or alerting**. Observability is limited to:

| Source | What It Provides |
|--------|-----------------|
| PM2 logs | Raw console output from the Node.js process. All `console.log`, `.warn`, `.error` output is captured here. |
| `pm2 status` / `pm2 list` | Process status (online, stopped, errored), uptime, restart count, memory usage |
| Admin Queue Dashboard (`/admin/queue`) | Real-time view of DialQueueJob counts per status, timing percentiles, dead-letter jobs |
| Admin Usage Reports (`/admin/reports`) | Aggregated call counts, durations, and outcomes per manager |
| AWS EC2 Console | CPU utilization, network I/O, disk I/O, CPU credit balance |

There is no Prometheus, no Datadog, no CloudWatch custom metrics, no PagerDuty, and no Slack alerting. All monitoring requires manual log inspection. See [Known Gaps](12-known-gaps.md).

---

## Common Operational Commands

```bash
# Check what is running
pm2 status
pm2 list

# View live logs (last 100 lines, then follow)
pm2 logs ai-calling-backend --lines 100

# View only error output
pm2 logs ai-calling-backend --err --lines 50

# Restart after code deploy
pm2 restart ai-calling-backend

# Stop the process (prevents PM2 from restarting it)
pm2 stop ai-calling-backend

# Start after a stop
pm2 start ai-calling-backend

# Kill PM2 daemon entirely (nuclear option)
pm2 kill

# Flush PM2 log files (reclaim disk space)
pm2 flush

# Check disk usage
df -h /

# Check memory usage
free -h

# Check CPU credit balance (AWS t2/t3 instances)
# → Must check via AWS EC2 Console → Instance → Monitoring → CPUCreditBalance
```

---

## Debugging Playbooks

### "Calls aren't being made"

This is the most common operational issue. Work through this checklist in order:

1. **Is the worker running?**
   - Campaign workers are in-memory only. After any PM2 restart, no campaigns are actively dialing.
   - Check PM2 logs for `startCampaignWorker` messages. If absent since the last restart, the worker is not running.
   - **Fix**: An operator must open each campaign in the UI and click Start again.

2. **Is the campaign status `running`?**
   - Check in MongoDB: `Campaign.findById(id)` → `status` field.
   - A campaign may show as `running` in the database but have no active worker (the worker died on restart).

3. **Is it within the calling window?**
   - The campaign's `settings.callingWindow` defines allowed hours, timezone, and days of the week.
   - Outside this window, the worker skips every tick without logging.

4. **Are there eligible jobs?**
   - `DialQueueJob.countDocuments({ campaignId, status: 'waiting' })` — if 0, all jobs are either completed, dead-lettered, or waiting for retry delays.
   - Check `queue_tail` and `backoff` jobs: `DialQueueJob.countDocuments({ campaignId, status: { $in: ['queue_tail', 'backoff'] } })` — these are waiting for `nextEligibleAt` to pass.

5. **Is the concurrency limit saturated?**
   - Count active: `Lead.countDocuments({ campaignId, status: 'calling' })` + `DialQueueJob.countDocuments({ campaignId, status: 'claimed' })`.
   - If this equals `campaign.settings.concurrencyLimit`, all slots are occupied. Wait for in-flight calls to finish.

---

### "Calls are stuck / not completing"

1. **Check for leaked leases**:
   ```javascript
   DialQueueJob.find({ status: 'claimed', leaseExpiresAt: { $lte: new Date() } })
   ```
   These are jobs where the worker crashed after claiming but before completing. They auto-release on the next worker tick via `_releaseExpiredLeases()`, but if no worker is running, they stay stuck.
   - **Fix**: Run `node fix_global_stuck.js` or wait for the worker to restart.

2. **Check stuck CallSessions**:
   ```javascript
   CallSession.find({
     status: { $in: ['initiated', 'in_progress'] },
     updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) }
   })
   ```
   These are sessions where the bridge crashed without finalizing.
   - The CDR poller should recover these within 60 seconds.
   - **Manual fix**: Update status to `failed` and set `callOutcome` to `system_error`.

3. **Check bridge health**:
   - Look for WebSocket error messages in PM2 logs (`gemini-error`, `gemini-close`, `vobiz-close`).
   - If Gemini Live WebSockets are consistently failing, pre-warm will fail and calls won't proceed.

---

### "Same lead called twice"

1. **Check CallSession duplicates**:
   ```javascript
   CallSession.find({ leadId, campaignId, attemptIndex: N })
   ```
   If two documents exist with the same `attemptIndex` in non-failed statuses, the idempotency check was bypassed (timing race).

2. **Check DialQueueJob duplicates**:
   The `dedupeKey` unique index should prevent this. Check for multiple documents with the same `leadId`.

---

### "Campaign won't complete"

1. **Check for non-terminal leads**:
   ```javascript
   Lead.countDocuments({
     campaignId,
     status: { $nin: ['completed', 'exhausted', 'failed', 'canceled'] }
   })
   ```
   If not 0, some leads are stuck.

2. **Check for leads stuck in `calling`**:
   ```javascript
   Lead.find({ campaignId, status: 'calling', lastCalledAt: { $lt: fiveMinutesAgo } })
   ```
   These are leads where the bridge crashed without updating lead status.
   - **Fix**: Manually set status to `no_answer` or `exhausted`.

---

### "Backend keeps crashing on boot"

1. **Check PM2 restart count**: `pm2 status` — if `↺` column shows 10, PM2 has given up (`max_restarts: 10`).
2. **Check logs**: `pm2 logs ai-calling-backend --err --lines 200`.
3. **Common causes**:
   - **MongoDB connection failure**: `MONGODB_URI` is wrong or Atlas IP whitelist doesn't include the server's IP.
   - **OOM on extraction recovery**: The boot-time `recoverMissedExtractions()` was previously set to recover 5,000 sessions — this was reduced to 50 to prevent OOM crashes.
   - **Port already in use**: Another process is holding port 5000. Run `lsof -i :5000`.

---

### "Dashboard / Usage Reports crashes the backend"

1. **Cause**: Dashboard and usage report queries can consume excessive memory if they load full documents (with transcripts, extracted data) instead of using `.lean()` projections.
2. **Check**: Look for OOM errors in PM2 logs. PM2's `max_memory_restart: '1G'` will trigger an auto-restart if RAM exceeds 1GB.
3. **Fix**: Ensure all aggregation queries use `.select('status durationSeconds callOutcome').lean()` to avoid loading full documents into memory.

---

### "CPU at 100% / SSH lockout"

This is a CPU credit exhaustion issue on the burstable `t2.micro` instance:

1. **Symptoms**: The server becomes unresponsive. SSH connections time out. API requests hang.
2. **Root cause**: Sustained CPU usage exhausted the instance's CPU credit balance. AWS throttles the instance to its baseline (10% for `t2.micro`).
3. **Immediate fix**:
   - Use **EC2 Instance Connect** (browser-based terminal in the AWS Console) — it sometimes works when SSH doesn't because it bypasses the SSH daemon's key negotiation.
   - If Instance Connect also fails: **Stop and Start** the instance in the AWS Console (not Reboot — Stop/Start allocates a fresh CPU credit pool).
   - After restart: all campaign workers are lost. Manually restart campaigns.
4. **Prevention**: Upgrade to `t3.medium` or a compute-optimized instance for sustained calling load.

---

### "Disk space full"

1. **Check**: `df -h /`
2. **Common consumers**:
   - PM2 logs: `pm2 flush` clears all log files.
   - systemd journal: `sudo journalctl --vacuum-size=100M` or `sudo journalctl --vacuum-time=3d`.
   - npm cache: `npm cache clean --force`.
   - Orphaned node_modules or old deployments.
3. **Impact**: If disk is full, MongoDB writes fail, PM2 can't write logs, and the system becomes unstable.

---

## Known Operational Risks

| Risk | Cause | Probability | Mitigation |
|------|-------|-------------|------------|
| CPU credit exhaustion | Sustained calling load or boot loops on `t2.micro` | High under load | Stop/Start instance for fresh credits. Upgrade instance type. |
| SSH lockout | CPU throttle prevents sshd from processing connections | Medium | EC2 Instance Connect, or Stop/Start instance |
| Lost campaign workers on restart | Workers are in-memory only, no boot-time recovery | Certain on every restart | Operators must manually re-click Start on each campaign |
| Extraction queue backlog | Boot-time recovery limited to 50 sessions | Low–Medium | Monitor `extractor.ran: false` count. Additional recoveries run on each restart. |
| PM2 crash loop | App crashes within `min_uptime` (10s); PM2 stops after 10 attempts | Low | `pm2 stop all`, investigate logs, fix issue, `pm2 start all` |
| Disk space exhaustion | PM2 logs, journalctl, npm cache | Medium | Schedule periodic `pm2 flush` and `journalctl --vacuum-time` |
| Phantom concurrency after restart | Claimed jobs with expired leases inflate concurrency count for up to 5.5 min | Low | Self-healing — `_releaseExpiredLeases()` auto-clears on worker tick |
| Webhook endpoint abuse | All telephony webhooks are public (no signature verification) | Low but exploitable | Not yet mitigated — see [Known Gaps](12-known-gaps.md) |

---

## Recovery Procedures

### After PM2 Restart

1. Verify the process is online: `pm2 status`.
2. Check logs for successful MongoDB connection and boot sequence completion.
3. Wait 10 seconds for `recoverMissedExtractions()` to run.
4. **Manually restart campaign workers**: Open each campaign that was `running` before the restart and click Start in the UI. There is no automatic recovery.
5. Monitor for leaked leases: `DialQueueJob.countDocuments({ status: 'claimed', leaseExpiresAt: { $lte: new Date() } })`. These will auto-clear within 5.5 minutes.

### Extraction Queue Backlog

If many sessions are missing extractions:

1. Check count: `CallSession.countDocuments({ status: 'completed', 'extractor.ran': { $ne: true } })`.
2. Each PM2 restart recovers up to 50. For larger backlogs, restart the process multiple times, or write a one-off script that calls `callSessionService.pushToExtractionQueue()` for each missed session.

### Stuck Dial Queue Jobs

1. Run `node fix_global_stuck.js` — this script resets stuck `claimed` jobs back to `waiting`.
2. Alternatively, wait for `_releaseExpiredLeases()` to auto-clear them (runs every worker tick, leases expire at 5.5 minutes).

---

## Emergency Procedures

### Kill PM2 Boot Loop

If the app is crashing on startup and PM2 keeps restarting it:

```bash
pm2 stop all          # Stop all processes
pm2 logs --err        # Read the error logs
# Fix the issue
pm2 start all         # Restart
```

### Force-Stop All Campaigns

If campaigns need to be stopped immediately (e.g., misconfigured AI caller, wrong phone numbers):

```bash
# In a MongoDB shell or script:
db.campaigns.updateMany(
  { status: 'running' },
  { $set: { status: 'stopped', completedAt: new Date() } }
)
```

Then restart PM2 — the workers will see `status: 'stopped'` and skip all ticks.

### Clear Concurrency Slots Manually

If the concurrency count is inflated by phantom leases and blocking new calls:

```bash
# In a MongoDB shell:
db.dialqueuejobs.updateMany(
  { status: 'claimed', leaseExpiresAt: { $lte: new Date() } },
  { $set: { status: 'waiting', leaseOwner: null, leaseExpiresAt: null } }
)
```

This is what `_releaseExpiredLeases()` does automatically, but running it manually is faster than waiting for a worker tick.
