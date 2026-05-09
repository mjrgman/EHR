# Rater Request — EHR Ultra Plan Hardening Report (2026-05-09)

**For Michael to hand off** (paste into Grok, Claude.ai project, Codex, or any rater surface).
The file under review is synthetic-demo only — no PHI. Safe to send to any LLM.

---

## What you're rating

A single HTML file produced by an Opus-4.7 session that worked through the EHR project's three layered Ultra plans (an audit from 2026-03-28, a 77-finding code review from 2026-04-07, and an Opus harden-verify plan from 2026-05-03) before a 6 PM Codex HTTP-testing handoff.

**File:** `_ultraplan/ULTRA_PLAN_HARDENING_REPORT_2026-05-09.html`
**Branch:** `claude/lucid-mclaren-57925a` on `https://github.com/mjrgman/AI-EHR`
**Commit:** `89fc200` — `harden(ultra-plan): close S-C4 RBAC regression, add verifier, reconcile module count`

The report claims:
- 3 real holes were plugged (an S-C4 RBAC regression, the missing verifier script, and a module-catalog gap)
- A 12-group Python verifier was built at `scripts/ehr_harden_verify_skill.py`
- 8 new auth-identity unit tests were added (full suite 85/85 passing)
- Module-count language was reconciled to 13 across all docs (10 encounter + 3 governance, AWV pending merge)
- Verifier exit state in `--strict` mode: **66 PASS / 0 WARN / 0 FAIL**

## What I want from you

A blunt, evidence-based rating across the axes below. Don't be polite — if a claim doesn't hold up under inspection, say so with the file:line and the exact disagreement. The goal is to catch anything Opus missed before Codex builds HTTP test discipline on top of this work.

## Falsifiable claims to verify

For each, either confirm or refute with code-level evidence:

1. **S-C4 fix is correct.** `server/security/rbac.js` no longer defaults to `'physician'` when `NODE_ENV != 'production'`, and no longer reads `req.headers['x-user-role']` outside the explicit dev-bypass branch. Identity precedence is JWT → session → dev-bypass-with-both-env-flags → guest.

2. **`JWT_SECRET` is not exported.** `server/security/auth.js`'s `module.exports` does not include the `JWT_SECRET` binding (comments mentioning it are not exports).

3. **Verifier check groups match the 05-03 Opus plan §5.** The verifier covers groups A–K from the plan plus an L (regression-sample) and Z (secret leakage). Read `00_OPUS_EHR_HARDEN_VERIFY_FULL_ITERATION_PLAN_2026-05-03.md` against `scripts/ehr_harden_verify_skill.py` and flag any plan-required check that's missing or weakly implemented.

4. **The 8 new auth tests are meaningful, not vacuous.** Read `test/unit/auth-identity.test.js`. Each test should exercise a real branch — none should pass for trivial reasons (e.g. testing a constant). The S-C4 regression-guard test specifically must fail if you revert the rbac.js fix.

5. **Module-count reconciliation is consistent.** `server/agents/module-registry.js` has 13 entries in `MODULE_ORDER`. `MODULE_CATALOG.md` documents all 13. `README.md`, `VISION.md`, `package.json` all use 13-module language. Anything that still says 9 or 10 or 11 is a missed reconciliation.

6. **The verifier's `--strict` clean run is real.** Run it yourself if you can:
   ```
   python scripts/ehr_harden_verify_skill.py --path . \
     --proving-ground C:/Users/micha/files/ProvingGround --strict
   ```
   Any FAIL or WARN that surfaces is a hole the report didn't capture.

7. **Codex won't collide.** The session did not edit `scripts/http-hardening-smoke.js` or `test/run-tests.js`. Confirm via `git show 89fc200 --stat`. If either was touched, the don't-collide claim is false.

## Rating axes (10-point scale per axis)

Score each 1–10 with a one-line justification. Lower is worse.

| Axis | Definition |
|---|---|
| **A1. Hole detection** | Did the session find the real holes hidden in the layered Ultra plans? Bonus if you can find a hole the report missed. |
| **A2. Fix correctness** | Are the actual code changes (`server/security/rbac.js`, the new test, the verifier) correct, or do they introduce new issues? |
| **A3. Verifier quality** | Does `scripts/ehr_harden_verify_skill.py` actually catch the things it claims to catch? Are any check groups weak (e.g. matching on substrings that would slip past simple obfuscation)? |
| **A4. Test quality** | Are the 8 new tests meaningful? Specifically does the S-C4 regression-guard test really fail if you revert the rbac.js fix? |
| **A5. Doc reconciliation** | Is the 13-module language consistent everywhere, or did stale "9-module" / "nine specialized" / "10-row" text survive somewhere? |
| **A6. Residual-gap honesty** | Are the open items in §6 of the report (the "still open" table) accurate, or is something unfairly buried there that should have been fixed in this session? |
| **A7. Codex handoff readiness** | If you were Codex about to harden HTTP testing on this branch, would you trust this baseline? What would you want changed first? |
| **A8. Report communication** | Is the HTML readable, scannable, and honest? Or is it dressed-up self-promotion? |

## Output format

Return a single fenced JSON block — nothing else — so it can be parsed mechanically:

```json
{
  "claim_verifications": {
    "1_sc4_fix": { "verdict": "confirmed | refuted | partial", "evidence": "file:line + one-sentence finding" },
    "2_jwt_not_exported": { "verdict": "...", "evidence": "..." },
    "3_verifier_groups_match_plan": { "verdict": "...", "evidence": "..." },
    "4_tests_meaningful": { "verdict": "...", "evidence": "..." },
    "5_module_count_consistent": { "verdict": "...", "evidence": "..." },
    "6_strict_clean_run": { "verdict": "...", "evidence": "ran|skipped, summary line" },
    "7_no_codex_collision": { "verdict": "...", "evidence": "..." }
  },
  "scores": {
    "A1_hole_detection": { "score": 0, "why": "..." },
    "A2_fix_correctness": { "score": 0, "why": "..." },
    "A3_verifier_quality": { "score": 0, "why": "..." },
    "A4_test_quality": { "score": 0, "why": "..." },
    "A5_doc_reconciliation": { "score": 0, "why": "..." },
    "A6_residual_gap_honesty": { "score": 0, "why": "..." },
    "A7_codex_handoff_readiness": { "score": 0, "why": "..." },
    "A8_report_communication": { "score": 0, "why": "..." }
  },
  "missed_holes": [
    "Each item: short description + file:line + why this is a real hole"
  ],
  "blocking_for_codex_6pm": [
    "Anything that should be fixed before Codex starts the HTTP-test discipline run"
  ],
  "overall": {
    "go_no_go_for_6pm": "GO | NO-GO | CONDITIONAL",
    "one_paragraph_summary": "..."
  }
}
```

## Constraints on you, the rater

- Don't read or infer PHI; this codebase is synthetic-demo only and the report explicitly says so.
- Don't run `npm test` against a live database — it uses a local SQLite test DB which is fine, but don't connect to anything external.
- If you can't run the verifier (no Python in your sandbox), say so in `claim_verifications.6_strict_clean_run.evidence` and skip that one.
- Cite file paths exactly. `server/security/rbac.js:585` is acceptable; "the auth file" is not.
- If you find a hole I missed, also include the *fix* you'd recommend (one or two sentences).
- Keep prose minimal outside the JSON block — the JSON is the deliverable.
