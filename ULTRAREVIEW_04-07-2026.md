# Agentic EHR — Ultrareview Report

**Date:** 2026-04-07
**Reviewer:** Claude Opus 4.6 (5-agent parallel review)
**Scope:** Full codebase — server, agents, security, frontend, tests/config
**Commit:** main branch, current HEAD

---

## Executive Summary

The Agentic EHR is an ambitious, well-architected system with a strong vision document and thoughtful governance model (three-tier autonomy, module registry, phased pipeline). The core design is sound. However, the implementation has **critical security gaps** that must be fixed before any deployment with real patient data, plus several **patient safety bugs** in the agent layer that could produce incorrect clinical behavior.

**By the numbers:**

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL (P0)** | 10 | Auth bypass, SQL injection, PHI exposure, agent governance violations |
| **HIGH (P1)** | 16 | Encryption gaps, patient safety bugs, audit integrity, broken agent features |
| **MEDIUM (P2)** | 25 | Race conditions, missing validation, UX issues, code quality |
| **LOW (P3)** | 18 | Best-practice deviations, dead code, hardening opportunities |
| **Total** | **69** | |

---

## CRITICAL FINDINGS (P0) — Fix Before Any Deployment

### Security: Authentication & Authorization

| ID | Finding | Location | Impact |
|----|---------|----------|--------|
| S-C1 | **No authentication on `/api/*` routes** — `auth.requireAuth` only applied to `/fhir/R4` and `/smart/launch`. Every clinical endpoint is publicly accessible. | `server.js:150-157` | Complete HIPAA access control failure. All PHI readable/writable by anyone on the network. |
| S-C2 | **RBAC middleware defined but never wired** — `requireRole()`, `requirePermission()`, `requireResourceAccess()` are exported from `rbac.js` but never called in any route. | `rbac.js` (entire file), `server.js` | Minimum necessary access (HIPAA §164.502(b)) not enforced. Every user gets physician-level access. |
| S-C3 | **JWT_SECRET exported as public module property** — Any module can `require('./security/auth').JWT_SECRET` and forge tokens. | `auth.js:279` | Supply chain attack or internal code can bypass all auth. |
| S-C4 | **Dev-mode backdoor defaults ON** — When `NODE_ENV` is unset (common deployment mistake), any client can send `x-user-role: system` header for full system privileges. | `auth.js:218-232` | Misconfigured deployment = complete auth bypass with role escalation. |

### Security: Data Protection

| ID | Finding | Location | Impact |
|----|---------|----------|--------|
| S-C5 | **SQL injection via dynamic column names** — `updateWorkflowState` interpolates object keys directly into SQL without whitelisting (unlike `updateAppointment` and `updateCharge` which do filter). | `database.js:1260-1270` | Attacker-controlled keys can inject arbitrary SQL. |
| S-C6 | **PHI stored unencrypted at rest** — SQLite stores all patient data (names, DOB, SSN-equivalent IDs, clinical notes, transcripts) in plaintext. `phi-encryption.js` exists but is never called in database operations. | `database.js:60-73, 1134-1141` | Violates HIPAA §164.312(a)(2)(iv). |

### Agent System: Governance Violations

| ID | Finding | Location | Impact |
|----|---------|----------|--------|
| A-C1 | **Orchestrator singleton created without DB** — `new AgentOrchestrator()` passes no `db` parameter. `MessageBus(undefined)` and `AgentMemory(name, undefined)` will throw on any operation. | `index.js:50` | All inter-agent communication and learning is non-functional. |
| A-C2 | **`options.only` permanently disables agents** — Setting `agent.enabled = false` on shared singletons persists beyond the current pipeline run. `BaseAgent.reset()` does NOT restore the `enabled` flag. | `orchestrator.js:163-165` | One pipeline run with `only` silently breaks all subsequent runs. |
| A-C3 | **Pipeline concurrency has no mutex** — `pipelineRunning` check-and-set is not atomic. Two concurrent encounters can both pass the check. | `orchestrator.js:151-155` | PHI cross-contamination between patients. |
| A-C4 | **Physician agent auto-responds to escalations** — `_findAutoResponseForEscalation` matches by string type and returns automatic directives without physician review. | `physician-agent.js:65-93` | Tier 3 governance violated — clinical decisions made without physician. |

### Frontend: Clinical Safety

| ID | Finding | Location | Impact |
|----|---------|----------|--------|
| F-C1 | **CheckOutPage shows success screen on error** — `catch` block sets `checkedOut = true`, displaying "Encounter Complete" even when checkout failed. | `CheckOutPage.jsx:149` | Physician believes checkout succeeded when it may not have. |
| F-C2 | **ReviewPage navigates to checkout on signing failure** — `catch` block navigates to `/checkout/` even when signing threw. | `ReviewPage.jsx:138-139` | Unsigned note proceeds to checkout workflow. |

---

## HIGH FINDINGS (P1) — Fix Before Production

### Security

| ID | Finding | Location |
|----|---------|----------|
| S-H1 | **No JWT revocation/blacklist** — Stolen JWT valid for 8 hours. No way to force-logout a compromised account. Violates HIPAA §164.312(d) emergency access termination. | `auth.js:153-158` |
| S-H2 | **PBKDF2 salt deterministic** — Salt derived from key material via SHA-256, not random. Two deployments with same key produce identical derived keys. | `phi-encryption.js:33-36` |
| S-H3 | **Key rotation swaps `process.env`** — Not thread-safe. Concurrent encrypt/decrypt during rotation uses wrong key = data corruption. | `phi-encryption.js:292-316` |
| S-H4 | **No break-glass emergency access** — HIPAA §164.312(a)(2)(ii) requires emergency access procedure. None exists. | All security files |
| S-H5 | **Audit log endpoints unauthenticated** — Full CSV export (10,000 records) publicly accessible. | `server.js:1629-1716` |
| S-H6 | **Audit log integrity unprotected** — Regular SQLite table, no write protection. Any db access can modify/delete entries. | `audit-logger.js` |
| S-H7 | **Audit user identity from request body** — Falls back to `req.body.provider` / `req.body.prescriber` when header missing. Caller can claim any identity. | `audit-logger.js:133-142` |

### Patient Safety (Agent System)

| ID | Finding | Location |
|----|---------|----------|
| A-H1 | **MA refill count never decrements** — `_getRemainingRefills` returns `max_refills - 1` every time regardless of actual refills dispensed. No state tracking. | `ma-agent.js:341-342` |
| A-H2 | **Compliance condition always passes** — `case 'compliant'` in `_evaluateProtocol` always sets `conditionMet = true` without checking actual compliance data. | `ma-agent.js:325-326` |
| A-H3 | **Allergy check is substring-only** — "Penicillin" allergy won't catch "amoxicillin". No cross-reactivity checking. False sense of safety. | `orders-agent.js:295-312` |
| A-H4 | **BMI formula assumes imperial units** — Factor 703 hardcoded. Metric values produce wildly wrong BMI (1.7 instead of 24.2). No unit validation. | `cds-agent.js:413-415` |
| A-H5 | **Phone triage/front-desk `process()` signature mismatch** — Takes 3 params but orchestrator passes 2. `callInfo`/`requestInfo` never received via pipeline. Agents non-functional in pipeline mode. | `phone-triage-agent.js:70`, `front-desk-agent.js:60` |

### Server

| ID | Finding | Location |
|----|---------|----------|
| SV-H1 | **CDS suggestions duplicated on every evaluation** — No check for existing suggestions. Same alerts accumulate repeatedly per encounter. | `cds-engine.js:477-487` |
| SV-H2 | **Claude API response not schema-validated** — Parsed JSON passed directly to database. Malicious/confused AI response could inject unexpected properties. | `ai-client.js:714-715` |
| SV-H3 | **MRN generation collision-prone** — Only 90,000 possible MRNs per year. Birthday paradox makes collisions likely around 300 patients. No retry logic. | `database.js:472-476` |

### Frontend

| ID | Finding | Location |
|----|---------|----------|
| F-H1 | **No React Error Boundary** — Any component throw = full white screen mid-encounter. Physician loses all context. | `App.jsx` |
| F-H2 | **PatientPage mutations bypass audit-tracked API client** — Uses raw `fetch()` instead of `api` client. Mutations not audit-logged. | `PatientPage.jsx:115, 140, 165` |
| F-H3 | **AgentPanel/PreVisitPanel bypass audit client** — Same issue. Agent API calls have no audit headers. | `AgentPanel.jsx:474-509`, `PreVisitPanel.jsx:149-161` |
| F-H4 | **console.error may dump PHI** — 10+ files log full error objects (which may contain API response bodies with patient data) to browser console. | Multiple files |

---

## MEDIUM FINDINGS (P2)

### Security

| ID | Finding | Location |
|----|---------|----------|
| S-M1 | Rate limiter and session store are in-memory Maps — no cluster awareness | `hipaa-middleware.js:26-37` |
| S-M2 | Sessions created for unauthenticated requests — audit pollution | `hipaa-middleware.js:450-469` |
| S-M3 | CORS allows all origins when `NODE_ENV` unset | `server.js:82` |
| S-M4 | Error messages may contain PHI — blacklist approach instead of whitelist | `hipaa-middleware.js:294-308` |
| S-M5 | Refresh token prune SQL operator precedence bug (missing parens) | `refresh-tokens.js:155` |
| S-M6 | No password complexity validation | `auth.js:245-252` |
| S-M7 | No account lockout after failed login attempts | `auth.js:91-147` |
| S-M8 | Audit log write failures silently swallowed — PHI served without logging | `hipaa-middleware.js:411-412` |

### Agent System

| ID | Finding | Location |
|----|---------|----------|
| A-M1 | Quality measures regex false-positives on negated phrases ("denies tobacco use" → smoker) | `quality-agent.js:71-78` |
| A-M2 | Audit trail silently truncated at 500 entries without persistence guarantee | `base-agent.js:244-247` |
| A-M3 | Protocol injection — `updateProtocols` accepts arbitrary objects, no validation or audit | `physician-agent.js:229-246` |
| A-M4 | `Math.random()` UUIDs in clinical audit context — not cryptographically secure | `physician-agent.js:8-13`, `ma-agent.js:19-23` |
| A-M5 | Confidence decay defined but never implemented — learning never forgets stale patterns | `agent-memory.js:23-27` |
| A-M6 | Coding agent auto-selects higher of MDM vs time-based — systematic upcoding risk | `coding-agent.js:83` |

### Server

| ID | Finding | Location |
|----|---------|----------|
| SV-M1 | Workflow queue route unreachable — `/:encounterId` matches before `/queue/:state` | `server.js:1160 vs 1085` |
| SV-M2 | No role enforcement on workflow state transitions (role field is decorative) | `workflow-engine.js:73-101` |
| SV-M3 | Provider learning records garbage associations for all active problems per order | `provider-learning.js:618-625` |
| SV-M4 | No timeout on Claude API calls — hangs indefinitely if API unresponsive | `ai-client.js:59` |
| SV-M5 | `JSON.parse` without try/catch in CDS rule evaluation — malformed rule crashes all CDS | `cds-engine.js:43-44` |
| SV-M6 | HEART score ECG always defaults to 1 — inflates every score, over-triage risk | `cds-engine.js:363` |
| SV-M7 | `calculateAge` missing import in ai-client.js — runtime crash in SOAP generation | `ai-client.js` |
| SV-M8 | Encounter status not validated against enum on PATCH | `server.js:458` |

### Frontend

| ID | Finding | Location |
|----|---------|----------|
| F-M1 | No unsaved-work protection (no `beforeunload`/`useBlocker`) on EncounterPage, MAPage, ReviewPage | 3 page files |
| F-M2 | Context providers recreate value objects every render — unnecessary re-renders | `AuthContext.jsx:26`, `EncounterContext.jsx:20` |
| F-M3 | Modal has no focus trap, no `role="dialog"`, no `aria-modal` | `Modal.jsx` |
| F-M4 | No offline/disconnect handling in API client — silent failures during encounters | `client.js` |
| F-M5 | CDS polling runs even when tab is backgrounded | `useCDS.js:59-64` |
| F-M6 | AppShell silently swallows dashboard errors — "No active encounters" when API is down | `AppShell.jsx:32` |
| F-M7 | API client doesn't handle 401/403 — session timeout shows generic error, no redirect to login | `client.js:33-37` |

---

## LOW FINDINGS (P3)

| ID | Finding | Location |
|----|---------|----------|
| L1 | `_age()` duplicated across 3 files | cds-agent, quality-agent, front-desk-agent |
| L2 | Dead code: vitals merge logic in scribe-agent, cacheSize in agent-memory | scribe-agent.js:82-85, agent-memory.js:36 |
| L3 | `crypto` required inside per-request middleware | server.js:51 |
| L4 | Duplicate validation on patient creation | server.js:205-207 |
| L5 | `createFhirIngestTables` defined but never called from `runMigrations()` | database-migrations.js:646-704 |
| L6 | Regex false positives in medication extraction | ai-client.js:276 |
| L7 | CDS deduplication by title is fragile | cds-engine.js:467 |
| L8 | Workflow timeline assumes linear state progression | workflow-engine.js:107-131 |
| L9 | Confidence formula caps at max after only 7 uses | database.js:1365 |
| L10 | `updated_at` columns never updated after initial insert | database.js |
| L11 | PRAGMAs fire-and-forget without await | database.js:17-18 |
| L12 | `loadClinicalRules` uses async-in-Promise anti-pattern | database.js:494 |
| L13 | Audit body scrubbing incomplete — PHI fields still logged | audit-logger.js:150-157 |
| L14 | PHI field detection too broad (`'e'` matches `email`, `phone`, `name`, etc.) | hipaa-middleware.js:341-342 |
| L15 | Session cleanup timer not `.unref()`'d — prevents graceful shutdown | hipaa-middleware.js:104 |
| L16 | `parseInt` without radix across 4 frontend files | CheckOutPage, ReviewPage, PatientPage, MAPage |
| L17 | Index-based keys on patient data lists (8+ components) | Multiple component files |
| L18 | DashboardPage hardcodes "Dr. MJR" instead of using auth context `providerName` | DashboardPage.jsx:179 |

---

## Prioritized Remediation Plan

### Phase 0 — Security Emergency (Do First)

These must be fixed before the system is network-accessible:

1. **Apply `auth.requireAuth` globally to `/api/*` routes** (S-C1)
2. **Wire RBAC middleware into route definitions** (S-C2)
3. **Stop exporting `JWT_SECRET`** — create `signToken`/`verifyToken` functions (S-C3)
4. **Default `NODE_ENV` to `'production'`** — remove header-based identity or gate behind explicit flag (S-C4)
5. **Whitelist columns in `updateWorkflowState`** (S-C5)
6. **Integrate `phi-encryption` into database read/write operations** (S-C6)

### Phase 1 — Agent System Critical Fixes

7. **Pass `db` to `AgentOrchestrator` constructor** in `index.js` (A-C1)
8. **Clone agent `enabled` state before `options.only` mutation** — restore after pipeline (A-C2)
9. **Add mutex/queue for pipeline concurrency** (A-C3)
10. **Gate physician auto-responses behind explicit approval** — at minimum, log as "auto-approved" with full audit trail (A-C4)
11. **Fix refill count tracking** — maintain actual dispensed count in state (A-H1)
12. **Fix compliance evaluation** — actually check patient data (A-H2)
13. **Implement drug class cross-reactivity for allergy checks** (A-H3)
14. **Add unit detection/validation for BMI calculation** (A-H4)
15. **Fix `process()` signatures** to match orchestrator contract (A-H5)

### Phase 2 — Frontend Safety + Audit Integrity

16. **Fix CheckOutPage and ReviewPage error handling** — don't show success on failure (F-C1, F-C2)
17. **Add React Error Boundary** wrapping routes and pages (F-H1)
18. **Route all API calls through audit-tracked client** (F-H2, F-H3)
19. **Replace console.error with sanitized logger** — strip response bodies (F-H4)
20. **Implement JWT blacklist or short-lived tokens** (S-H1)
21. **Add account lockout + password complexity** (S-M6, S-M7)
22. **Make audit log failures block PHI access** (S-M8)

### Phase 3 — Hardening (This Sprint)

23. Use random salt for PBKDF2 (S-H2)
24. Fix key rotation to accept key as parameter (S-H3)
25. Build break-glass emergency access (S-H4)
26. Add CDS suggestion deduplication (SV-H1)
27. Validate Claude API response schema (SV-H2)
28. Fix MRN generation (SV-H3)
29. Add unsaved-work protection to encounter pages (F-M1)
30. Add offline/disconnect handling (F-M4)

---

## Architecture Strengths

The review is not all bad. These are genuinely well-done:

- **Three-tier autonomy model** — The CATC framework with Tier 1/2/3 governance is the right design for clinical AI safety
- **Module registry** — Frozen registry with human counterpart mappings, patient control boundaries, and autonomy tiers is excellent governance-as-code
- **`buildContext` function** (index.js:100-148) — Clean parallel DB queries with graceful fallbacks. One of the strongest parts of the codebase
- **Phased pipeline design** — Dependency-aware agent execution with clear ordering
- **CDS rule engine** — 27 clinical rules covering vitals, labs, drug interactions, differentials, screening, and prescribing advisories
- **HEART score protocol** — Structured chest pain risk stratification
- **Stress test scenarios** — 28 scenarios sourced from ONC certification, FHIR test suites, multi-agent failure research, AHRQ safety patterns
- **HIPAA middleware design intent** — The middleware *tries* to do the right thing (session tracking, PHI detection, access logging). The implementation just needs to be actually wired in
- **Vision document** — The VISION.md is one of the clearest EHR architecture documents I've reviewed. The clinical workflow understanding is deep and physician-informed

---

## Bottom Line

The architecture is right. The vision is right. The clinical domain knowledge is clearly physician-authored and deeply informed. The implementation has gaps — mostly around security wiring (the pieces exist but aren't connected) and agent state management. None of the issues are design flaws; they're implementation gaps that are fixable without rearchitecting.

The four CRITICAL security findings (S-C1 through S-C4) mean that **in the current state, every API endpoint serving PHI is accessible without authentication or role checks.** That's the #1 priority. The agent P0s (A-C1 through A-C4) are the #2 priority — they affect clinical correctness.

Sprint 1 (FHIR facade) should not begin until Phase 0 security is complete. Building new features on an unauthenticated API creates more surface area to protect later.

---

---

## Tests & Infrastructure Review

### Test Coverage

**What exists:** A single monolithic test runner (`test/run-tests.js`, 2090+ lines) with a custom micro-framework. 17 phases covering database, AI pattern matching, SOAP notes, workflow, CDS, provider learning, orders, audit, scheduling, billing, FHIR mapping, FHIR HTTP, FHIR ingestion, SMART-on-FHIR, paging/metrics.

**What does NOT exist (critical gaps for a clinical system):**

| Gap | Impact |
|-----|--------|
| **Zero auth/RBAC tests** | `auth.js`, `rbac.js`, `refresh-tokens.js` completely untested |
| **Zero PHI encryption tests** | `phi-encryption.js` encrypt/decrypt round-trip, key rotation never verified |
| **Zero HIPAA middleware tests** | Session timeout, break-glass, minimum necessary access untested |
| **Zero agent orchestration tests** | 9 agents, message bus, orchestrator have no unit or integration tests (only 1 scribe test) |
| **Zero API integration tests** | 30+ Express endpoints never tested through HTTP with actual middleware stack |
| **Zero input validation tests** | No XSS, injection, or boundary value testing |
| **Zero migration tests** | Upgrade/downgrade paths, data preservation untested |
| **Zero error handling tests** | Express error handler, uncaughtException, unhandledRejection unverified |

**Scenario files are strong but aspirational:** The 31 stress-test scenarios in `stress-test-scenarios.json` are exceptionally well-designed (sourced from ONC certification, FHIR test suites, AHRQ safety patterns). However, `expected_agent_behavior` fields are documentation only — no code validates whether agents actually behave as specified.

### Missing Test Infrastructure

- No testing framework (vitest, jest, mocha) — custom harness lacks coverage, isolation, mocking
- No CI/CD pipeline — no `.github/workflows/`, no Jenkinsfile
- No linting (eslint)
- No type checking (typescript or jsdoc)
- No security scanner script
- No code coverage tool
- No test isolation — tests share state via closure variables

### Deployment Blockers

| Issue | Severity | Detail |
|-------|----------|--------|
| **`nginx/nginx.conf` does not exist** | BLOCKING | `docker-compose.yml` mounts it but the file/directory doesn't exist. Docker deployment fails immediately. |
| **`scripts/setup.js` does not exist** | BLOCKING | Documented setup procedure (`node scripts/setup.js`) references nonexistent file. |
| **No `.dockerignore`** | HIGH | `.env` files with secrets and `.git/` directory get copied into Docker image layers. Security risk. |
| **DATABASE_PATH mismatch** | MEDIUM | Dockerfile sets `/data/mjr-ehr.db`, docker-compose sets `/data/agentic-ehr.db`. Compose override wins but naming inconsistency causes confusion. |

### Dependency Issues

| Package | Issue |
|---------|-------|
| `lucide-react ^0.263.1` | ~200 versions behind current (0.460+). May have security patches. |
| `node:22` in Dockerfile | Node 22 is current/active, not LTS until Oct 2026. Node 20 LTS is safer for clinical. |
| No `dotenv` | Local dev without Docker won't load `.env` files. |
| No `compression` | No response compression for production. |
| `@anthropic-ai/sdk ^0.39.0` | SDK moves fast — verify compatibility with latest. |

### Docker Configuration

**Good:** Named volumes, internal network isolation, health checks, resource limits, log rotation, app port bound to 127.0.0.1 only, non-root user, multi-stage build.

**Issues:**
- `COPY . .` in builder without `.dockerignore` copies everything including secrets
- `version: '3.8'` deprecated in Compose V2
- Shared log volume between app and nginx could cause confusion
- No cert generation script for TLS (referenced but missing)

---

## Updated Totals

With tests & config findings included:

| Severity | Count |
|----------|-------|
| **CRITICAL (P0)** | 10 (unchanged — security + agent) |
| **HIGH (P1)** | 19 (+3: deployment blockers, test coverage gaps) |
| **MEDIUM (P2)** | 28 (+3: dependency issues, config mismatches) |
| **LOW (P3)** | 20 (+2: version pin, deprecated compose field) |
| **Total** | **77** |

---

---

## Fix Implementation Log (2026-04-07)

**Execution:** 6 parallel fix agents with strict file ownership boundaries.
**Test result after fixes:** 140/141 passing (99.3%). One pre-existing failure (scribe physicalExam mock mode — predates this session).

### Agent 1: Server Core (server.js, workflow-engine.js, provider-learning.js)
- S-C1: `auth.requireAuth` applied globally to `/api/*`
- S-C2: RBAC middleware wired per resource group (patients, encounters, medications, audit, billing, scheduling)
- S-M3: CORS fail-secure — requires explicit `NODE_ENV=development`
- SV-M1: Workflow queue route moved before param route
- SV-M8: Encounter status validated against allowed enum
- SV-M2: Role enforcement on workflow state transitions
- SV-M3: Provider learning only associates matching indications
- L3: `crypto` moved to top-level
- L4: Duplicate validation removed

### Agent 2: Security Modules (auth.js, phi-encryption.js, hipaa-middleware.js, rbac.js, refresh-tokens.js)
- S-C3: `JWT_SECRET` removed from exports; `signToken` accepts custom payloads
- S-C4: Dev backdoor requires explicit `NODE_ENV=development`
- S-H1: JWT blacklist with auto-cleanup (in-memory, production should use Redis)
- S-H2: Random PBKDF2 salt with backward-compatible old-format decryption
- S-H3: Key rotation passes key as parameter — race condition eliminated
- S-M5: Refresh token prune SQL parenthesized
- S-M6: Password complexity (12+ chars, mixed case, digit, special)
- S-M7: Account lockout (5 failures → 15 min lock)
- S-M8: Audit failures block PHI access (503)
- S-M2: Sessions only created for authenticated requests
- M5: Error message whitelist
- L1: X-XSS-Protection set to 0
- L4: PHI field detection exact match
- L5: Session cleanup timer `.unref()`'d
- L6: Admin delete logic documented

### Agent 3: Agent System (14 files in server/agents/)
- A-C1: Lazy factory `getOrchestrator(db)` replaces module-level singleton
- A-C2: Agent `enabled` states saved/restored in `finally` block
- A-C3: Promise-based mutex for pipeline concurrency
- A-C4: Auto-escalation audited with `auto_approved: true` flag
- A-H1: Refill tracking with per-protocol dispense counter
- A-H2: Compliance actually checked; defaults fail-safe
- A-H3: Drug class cross-reactivity (7 classes, 50+ members)
- A-H4: BMI unit detection (metric/imperial heuristic)
- A-H5: Process signatures fixed to 2-param contract
- A-M1: Quality regex negation-aware
- A-M2: Audit truncation increased to 1000, emits warning
- A-M3: Protocol validation + audit on changes
- A-M4: `crypto.randomUUID()` everywhere
- A-M5: Confidence decay implemented
- A-M6: Upcoding warning when time > MDM by 2+ levels
- L1: `_age()` on BaseAgent, duplicates removed
- L2: Dead code removed (scribe vitals merge, agent-memory cacheSize)

### Agent 4: Frontend (all src/ files)
- F-C1: CheckOutPage no longer shows success on error
- F-C2: ReviewPage no longer navigates on signing failure
- F-H1: ErrorBoundary wrapping app routes
- F-H2: PatientPage mutations routed through audit-tracked API client
- F-H3: AgentPanel/PreVisitPanel routed through API client
- F-H4: `safeLog` utility replaces `console.error` across 8+ files
- F-M1: `beforeunload` on EncounterPage, MAPage, ReviewPage
- F-M2: Context provider values memoized
- F-M3: Modal accessibility (role, aria, focus trap, Escape key)
- F-M4: Offline detection + 1-retry in API client
- F-M5: CDS polling pauses when tab hidden
- F-M6: AppShell shows "Queue unavailable" on dashboard error
- F-M7: 401/403 redirects to login
- L16: `parseInt` radix added
- L17: Stable keys on patient data lists
- L18: Hardcoded "Dr. MJR" replaced with auth context

### Agent 5: Database + CDS + AI (database.js, cds-engine.js, ai-client.js, audit-logger.js, migrations)
- S-C5: Column whitelist in `updateWorkflowState`
- S-C6: PHI encryption integrated into patient CRUD with graceful fallback
- SV-H1: CDS suggestion deduplication before insert
- SV-H2: Claude API responses stripped of dangerous fields
- SV-H3: Crypto-secure MRN generation with retry
- SV-M4: 30-second timeout on Claude API calls
- SV-M5: All 7 CDS evaluators try/catch JSON.parse
- SV-M6: HEART ECG flagged for manual review
- S-H7: Audit identity from auth only
- S-M2 (partial): Session ID UUID validation
- L5: `createFhirIngestTables` called from `runMigrations`
- L10/L11/L12: PRAGMAs awaited, async-in-Promise fixed
- L13: Body scrubbing expanded to all PHI fields

### Agent 6: Infrastructure (Dockerfile, docker-compose, nginx, scripts)
- Created `nginx/nginx.conf` (production reverse proxy)
- Created `.dockerignore` (excludes .env, .git, node_modules, data, test)
- Created `scripts/setup.js` (env generation, key creation)
- Created `data/.gitkeep`
- Dockerfile: Node 20 LTS, DATABASE_PATH fixed
- docker-compose: Deprecated `version` removed
- package.json: `setup` script added

### Manual Fix: token.js JWT_SECRET
- `server/fhir/smart/token.js:176`: Replaced `auth.JWT_SECRET` with `auth.signToken()` wrapper
- `auth.js signToken()`: Refactored to accept both user objects and raw payloads with custom options

---

*Report complete. Generated by 5-agent parallel review, fixed by 6-agent parallel execution on 2026-04-07.*
