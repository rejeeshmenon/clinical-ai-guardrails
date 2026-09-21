# Operating rules that govern AI output in the EMR (excerpt)

The EMR's operating contract is a numbered set of invariants the codebase and its review process are held to. The six that bear on model output and clinical validation are reproduced verbatim below; the file they come from also covers migrations, security, deployment and multi-tenancy and is not published.

## Clinical validation

**#6. ALL LAB VALUES RANGE-CHECKED BEFORE STORAGE.** Zod schemas reject physiologically impossible values. Critical values notify the provider. Thresholds: HbA1c 3.0 to 20.0% (critical >14); eGFR 0 to 200 (critical <15); fasting glucose 20 to 600 (critical >400 / <40); BMI 10 to 80.

**#7. INDIAN CLINICAL THRESHOLDS, ALWAYS.** BMI: Normal <23, Overweight >=23, Obese >=25 (Misra / ICMR-INDIAB). Hardcoded as named constants in `lib/clinical/thresholds.ts`. NEVER use WHO Caucasian 25/30 as primary. Waist: M >=90 cm / F >=80 cm. HbA1c: prediabetes 5.7 to 6.4%, diabetes >=6.5%.

## AI output handling

**#10. AI OUTPUT NEVER AUTO-APPLIES TO CLINICAL FIELDS.** Every Claude-generated summary lives in `ai_interactions` with `confirmed_by_clinician_id = NULL`. Shown in a visually distinct "AI Suggestion" pane. Physician clicks Accept: `confirmed_by + confirmed_at` set, text flows into `consults / prescriptions`. Auto-apply FORBIDDEN.

**#11. EVERY AI-ASSISTED RECORD IS FLAGGED.** Accepted suggestion: consult row has `ai_assisted = TRUE, ai_model, ai_reviewed_by, ai_review_timestamp`. Rx PDF footer: "Prepared with AI assistance and reviewed by Dr. [Name]."

**#12. AI IS FAIL-CLOSED FOR CLINICAL PATHS.** Anthropic API down / >10s / errors: Rx flow continues with physician-authored notes. "AI Suggestion" pane shows: "AI unavailable, proceed with manual review". No retry loop. Log to audit_log `action='ai_service_unavailable'`.

**#13. MINIMAL PHI IN AI PROMPTS.** Before sending: name, phone, address, email and Aadhaar are removed. Only clinical content goes to Anthropic. Post-response: reject any output with 10-digit numbers / email / Aadhaar patterns. Module: `lib/ai/redact.ts`.

## Where each rule is enforced in this extract

| Rule | Code | Test |
|---|---|---|
| #6 | `lib/lab-parsing/schema.ts` (Zod bounds), `lib/lab-parsing/confidence.ts` (OCR-sanity bands, display only) | `tests/lab-parsing/schema.test.ts`, `confidence.test.ts` |
| #7 | `lib/clinical/thresholds.ts`, `lib/clinical/contraindications.ts` | `tests/clinical/thresholds.test.ts`, `contraindications.test.ts` |
| #10, #11 | Not in this extract (route handlers and database constraints); described in the README | |
| #12 | `lib/ai/claude.ts` (10 s timeout, no retries, typed `ClaudeUnavailableError`) | |
| #13 | `lib/ai/redact.ts`, `lib/ai/intake-classification.ts`, `lib/ai/sanitize.ts` | `tests/ai/redact.test.ts`, `intake-classification.test.ts`, `sanitize.test.ts`; `scripts/proof/redaction-glp1-contraindications.ts` |

Rule #13's original wording said identifiers are replaced by markers such as `[PATIENT]`. The implementation later moved to path-based omission with no marker for identifiers (see the header of `intake-classification.ts` for why a marker itself was judged a disclosure); the rule text above is quoted as written.
