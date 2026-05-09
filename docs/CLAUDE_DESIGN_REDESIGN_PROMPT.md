# Claude Design — Redesign Prompt for the Agentic EHR Frontend

**Date:** 2026-05-09
**Audience:** Claude Design (claude.ai design-project surface)
**Owner asking:** Michael Renner
**Source repo:** `C:\Users\micha\files\Clinical\EHR` (and the worktree `claude/lucid-mclaren-57925a`)
**This is a one-shot prompt** — paste it into Claude Design as the project brief.

---

## Context — what the EHR is

A synthetic-demo Agentic EHR built as a 13-module clinical workflow runtime (10 encounter + 3 patient-data governance modules; AWV module pending merge from main, after which it becomes 14). Stack: **React 18 + Vite + Tailwind** frontend, **Node.js / Express + SQLite** backend, **multi-agent AI runtime** with 9-13 specialized agents. Patient-facing surfaces include MediVault (patient-owned health vault), PatientLink (drafted communications), and a Patient App (portal/kiosk). The system runs SMART-on-FHIR, has FHIR R4 read/search/Bundle ingestion, and is HIPAA-aware (audit logging, PHI encryption at rest, RBAC, JWT auth, account lockout).

This is **never deployed with real PHI**. The brand line at the top of every screen reads `Synthetic EHR Demo | No PHI | Not for clinical use`.

The clinical model:
- **Tier 1** = patient-initiated or low-stakes (e.g., Patient App, Phone Triage)
- **Tier 2** = protocol-bounded (MA, CDS, Quality, Coding, PatientLink)
- **Tier 3** = clinical authority required (Physician, Scribe, Domain Logic, Orders, MediVault, AWV)

Tier 3 always gates on physician approval. The UI must make that gate visible — no Tier 3 output should "look done" before a clinician signs.

## Goal of the redesign

The current UI is functionally correct but visually utilitarian — it reads as a coding sandbox, not a clinical product. We want a redesign that:

1. **Looks clinical-grade.** Like an EHR a real practice would buy, not a demo.
2. **Surfaces the agent layer without hiding it.** The user must always know an AI agent drafted something and a physician owns the final word.
3. **Is voice-aware.** Dragon Medical / ambient voice routes a lot of input; the UI must be friendly to a clinician dictating instead of typing.
4. **Makes safety boundaries readable at a glance.** Tier 3 drafts must be visually distinct from signed records.
5. **Respects accessibility.** WCAG 2.1 AA at minimum. Many clinicians have age-related vision, color-blindness, or use screen magnifiers.

## What to deliver

Deliver a **design system + key screens** (not pixel-perfect comps for every screen). Specifically:

1. **Visual language** — color tokens (with semantic names: `tier-1`, `tier-2`, `tier-3`, `draft`, `signed`, `escalation`, `phi-protected`), typography scale, spacing rhythm, shadow / border tokens. Design for a 24″ desktop monitor first; tablet/laptop second; mobile last (clinicians review charts on desktop).
2. **Component library** — at minimum: header chrome with the synthetic-demo banner; encounter shell (left rail, main panel, right agent panel); SOAP note editor with draft/signed states; CDS suggestion card; Domain Logic dosing-proposal card with Tier 3 gate; orders table; coding sidebar; MediVault export modal; PatientLink message composer.
3. **Five hero screens** at desktop resolution showing the system in use:
   - Encounter (mid-visit, Scribe drafting + CDS firing)
   - Review/sign (physician approves SOAP note, dosing proposals visible)
   - Check-out (orders + coding + AWV components if present)
   - MediVault export (patient initiates, Tier 3 gate)
   - PatientLink message draft (outreach for a care gap)
4. **Voice-mode states** — show what the UI does while ambient capture is running, while a Dragon command is being heard, and while a transcript is being committed to a SOAP draft.
5. **Empty / loading / error states** — for every hero screen. Empty states must teach the workflow; error states must never blame the user.

## Constraints — non-negotiable

- **Synthetic banner persistent.** The text `Synthetic EHR Demo | No PHI | Not for clinical use` is always visible at the top of the viewport.
- **Tier 3 visual gate.** Any Tier 3 draft must carry a visible `Awaiting physician approval` indicator and a primary CTA that reads `Review & sign` or equivalent. Auto-execution is forbidden. The UI must communicate this — not just enforce it server-side.
- **No fake patient data.** Use names like `Test Patient A`, `Demo Encounter 2025-05-09`, `MRN MRN-26-100001`. No real-world names. Drug examples are fine (lisinopril, atorvastatin) since those are public knowledge.
- **PHI-protected fields are styled the same as cleartext.** Encryption is server-side; the UI must not "look encrypted" to the clinician.
- **No PHI in error messages or empty states.** Show the structure, not the data.
- **Keyboard-first.** Every primary action has a keyboard shortcut. Show shortcuts in a discoverable way (`?` opens a shortcut sheet).
- **WCAG 2.1 AA.** Color contrast ≥ 4.5:1 for body text, focus states visible, no information conveyed by color alone (Tier indicators must include a label or icon, not just hue).

## Anti-patterns to avoid

- Bright marketing gradients on clinical screens. Save those for the marketing site.
- "Magic AI" framing — no sparkle icons, no "AI-powered ✨" copy. Clinicians distrust it. Frame the agents as named tools (`Scribe drafted this. Physician will sign.`).
- Modal-stacked workflows. Clinicians live in the encounter view; pull-out panels and drawers > nested modals.
- Light-grey-on-white "ghost" buttons for primary actions. Primary CTAs must be high-contrast.
- "AI Confidence Score: 87%" badges. Confidence is a system signal, not a clinician-facing one.
- Unstructured chat boxes for clinical input. Structured fields with voice fallback, not free-text everywhere.

## Inputs / references

- `MODULE_CATALOG.md` — canonical module map and tier/handoff metadata (use this to drive any module-listing UI)
- `VISION.md` — the clinical workflow model and rationale; read it before starting
- `docs/MEDIVAULT_BOUNDARY.md` — the EHR-of-record vs vault-of-record split
- `00_CLAUDE_CODE_EHR_AUTOBETTER_PROMPT.md` — the visible-banner / no-PHI / synthetic-demo contract
- Current frontend: `src/pages/*.jsx` (EncounterPage, ReviewPage, CheckOutPage, MAPage, PatientPage, SchedulePage, DashboardPage)

## Output format

Deliver in the Claude Design canvas:

1. A short **decision log** at the top (what you chose and why; what you deferred).
2. **Tokens** as a copy-pasteable block (CSS custom properties or Tailwind config).
3. **Components** as named, isolated previews (one per name, with all states).
4. **Hero screens** at desktop resolution.
5. **Voice mode** as one annotated screen.
6. **Open questions for Michael** — three at most. We want decisions, not a long Q&A.

If you need a constraint clarified, **make a defensible default and flag it in the decision log** rather than blocking.
