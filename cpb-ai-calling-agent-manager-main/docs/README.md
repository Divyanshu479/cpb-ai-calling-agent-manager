# Documentation Index

This is the central navigation hub for the CPB AI Calling Agent Manager technical documentation. Every document here is written as a permanent engineering reference — detailed enough to onboard a new engineer, trace system behavior, debug production issues, and safely modify the application.

---

## Recommended Reading Order

If you are new to this codebase, read these documents in order:

1. **[Platform Overview](01-platform-overview.md)** — What the platform does, who uses it, and what features exist.
2. **[System Architecture](02-system-architecture.md)** — How the system is deployed, what processes run, and how they communicate.
3. **[Data Model](05-data-model.md)** — Every database entity, its fields, relationships, and state machines.
4. **[Call Lifecycle](06-call-lifecycle.md)** — End-to-end trace of an outbound call from campaign start to post-call extraction.
5. **[Configuration and Deployment](10-configuration-and-deployment.md)** — Environment variables, local setup, and production deployment.
6. **[Operational Guide](11-operational-guide.md)** — Debugging playbooks, monitoring, and recovery procedures.

After these six, explore the deep dives based on what you are working on.

---

## Complete Document Index

| Document | Description |
|----------|-------------|
| [01 — Platform Overview](01-platform-overview.md) | Product capabilities, user roles, feature inventory, and platform limitations |
| [02 — System Architecture](02-system-architecture.md) | Deployment topology, single-process design, transport layers, background workers, boot sequence, and critical design decisions |
| [03 — Backend Architecture](03-backend-architecture.md) | Express middleware chain, route hierarchy, controllers, service layer, authentication, and error handling |
| [04 — Frontend Architecture](04-frontend-architecture.md) | React/Redux stack, routing, state management, API communication patterns, and major pages |
| [05 — Data Model](05-data-model.md) | All Mongoose schemas with field-level documentation, entity relationships, indexes, and state machine diagrams |
| [06 — Call Lifecycle](06-call-lifecycle.md) | End-to-end outbound call workflow — campaign launch, queue processing, telephony, AI conversation, and post-call extraction |
| [07 — Dial Queue System](07-dial-queue-system.md) | Queue architecture, concurrency control, atomic job claiming, retry strategies, idempotency layers, and debugging |
| [08 — Vobiz-Gemini Bridge](08-vobiz-gemini-bridge.md) | Real-time AI telephony engine — pre-warm lifecycle, audio codec pipeline, transcription, tool calls, and safety timers |
| [09 — Integrations](09-integrations.md) | External system contracts for Vobiz, Twilio, and Google Gemini Live — APIs, webhooks, audio streaming, and failure handling |
| [10 — Configuration and Deployment](10-configuration-and-deployment.md) | Environment variables, local dev setup, PM2 production deployment, infrastructure requirements, and Docker/Nginx |
| [11 — Operational Guide](11-operational-guide.md) | Debugging playbooks, known operational risks, monitoring, recovery procedures, and emergency commands |
| [12 — Known Gaps](12-known-gaps.md) | Open questions, partially implemented features, security gaps, and technical debt |

---

## Quick Reference

| I need to... | Go to |
|-------------|-------|
| Understand what the platform does | [Platform Overview](01-platform-overview.md) |
| Set up a local development environment | [Configuration and Deployment](10-configuration-and-deployment.md) |
| Understand the database schema | [Data Model](05-data-model.md) |
| Trace how an outbound call works end-to-end | [Call Lifecycle](06-call-lifecycle.md) |
| Debug why calls aren't being made | [Operational Guide](11-operational-guide.md) |
| Understand environment variables | [Configuration and Deployment](10-configuration-and-deployment.md) |
| Modify the AI conversation behavior | [Vobiz-Gemini Bridge](08-vobiz-gemini-bridge.md) |
| Add a new telephony provider | [Integrations](09-integrations.md) |
| Understand queue concurrency logic | [Dial Queue System](07-dial-queue-system.md) |
| Find known bugs or incomplete features | [Known Gaps](12-known-gaps.md) |
