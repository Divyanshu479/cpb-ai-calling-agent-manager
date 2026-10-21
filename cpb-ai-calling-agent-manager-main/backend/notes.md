## Voices 
- Achernar
- Sulafat

## MVP Planning Questions (Open)
- [ ] Prioritize first 3 upcoming features (ordered).
- [ ] Confirm Twilio + Gemini S2S is the primary production path.
- [ ] Confirm batch campaign execution UX and backend behavior for start/pause/resume.
- [ ] Finalize retry policy (rule-based + summary-aware heuristics).
- [ ] Decide whether manual per-lead call remains first-class after campaign automation.
- [ ] Decide if campaign calling window must be enforced backend-side now.
- [ ] Decide whether call extraction/outcome fields should be editable by managers.
- [ ] Define lead deduping policy (campaign scoped vs global).
- [ ] Decide visibility of token/telephony cost (admin-only vs manager-visible).
- [ ] Confirm security hardening timing (Twilio webhook signature validation, secret handling).
- [ ] Confirm whether to run a stabilization pass before adding broader features.
- [ ] Define expected scale constraints (concurrency, daily calls, leads per campaign).
- [ ] Decide delivery mode (single branch vs staged PR-sized chunks).

## Immediate MVP Features Requested
- [ ] Feature 1: Campaign start/pause/resume for automatic lead calling (no manual trigger requirement).
- [ ] Feature 2: Rule-based retry orchestration with summary-aware safeguards for abrupt/no-conversation calls.

## Non-Negotiable Constraint
- [ ] Do not break current working Twilio + Gemini manual calling flow.
