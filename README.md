# clinical-ai-guardrails

Guardrail, redaction, escalation and evaluation code extracted from two clinical systems that run in production for a seven-clinic dermatology and metabolic-health network in southern India, together with the tests that hold them in place and two demonstrations that run in under thirty seconds on a clean machine. Everything here is either code that was read from a production repository unchanged, or synthetic data written for this repository.

Author: Rejeesh Menon, MD (academic hospitalist; the systems below were designed, built and deployed by the author as a single developer working with AI coding tools). This repository exists to let reviewers read the safety-relevant parts of that work without access to the private repositories or to any patient data.

## What this is

Three production sources, one question: **how does a practicing physician constrain generative AI before its output reaches a medical record or a patient?**

| Source | In production since | What it does | What is extracted here |
|---|---|---|---|
| `superhuman/` | May 2026 | An EMR for a GLP-1 metabolic programme (about 335 patients). Claude drafts pre-consult summaries, triage assessments and the diagnosis block of prescriptions, and extracts 25 analytes from photographed lab reports. | PHI redaction by path, output sanitisation, the four prompts, Zod output schemas that reject on deviation, a deterministic confidence score for extracted labs, the Indian-threshold contraindication logic, and the tests for all of it. |
| `priya/` | April 2026 | A patient-facing assistant on Instagram and Messenger for the clinics. Claude Haiku holds the conversation; hand-off to a human is decided by code, never by the model. | The deterministic escalation engine and its six multilingual lexicons, the model-client design (pinned model, prompt caching, six-second timeout, circuit breaker), the PHI-scrubbing corpus logger, a grounded staff-facing summariser prompt, the rollout runbook with its physician shadow-review protocol and numeric exit gates, and the safety sections of the system prompt. |
| `shop/` | 2026 | A storefront whose ingredient monographs are generated from PubMed abstracts. | The generation script (hedged-language system prompt, "use only the abstracts above" grounding) and the monograph schema with its human-review gate. |

## What this is not

- **Not an ambient scribe.** There is no audio, no speech recognition and no encounter-transcript pipeline in either system. The nearest analogue to clinical documentation here is structured clinical data going into a model and a physician-reviewed text coming out.
- **Not an agent.** The EMR's operating contract describes an agentic layer with its own decision log; that layer is a written charter and is not implemented. There is no retrieval, no vector store and no tool use. Grounding is done by serialising database rows into the prompt.
- **Not a validated clinical evaluation.** There is no labelled test set and no accuracy claim for model output anywhere in the source systems. The tests here check deterministic code: redaction, schema rejection, thresholds, escalation. See Limitations.
- **Not runnable as an application.** Route handlers, database access and infrastructure were left out on purpose. Files that depend on them (`superhuman/lib/ai/claude.ts`, `superhuman/lib/lab-parsing/claude.ts`, `superhuman/lib/jobs/`, `priya/llm/`, `priya/observability/`) are included for reading and are excluded from the type-check.

## Run the demonstrations

```
npm install
npm run demo
```

`npm run demo:escalation` feeds fourteen synthetic patient messages (Malayalam and Tamil script, Manglish, Tanglish, English) through the production escalation engine and prints each decision, then the lexicon inventory. Two messages are printed as `GAP` because the engine does not escalate them; see Limitations, they are the point.

`npm run demo:redaction` is the EMR's own execution-proof script for its redaction layer. It renders what the model would receive for two intake shapes and asserts that all sixteen GLP-1 contraindication facts survive while every identifier is gone. No database, no network.

`npm test` runs 207 tests in 13 files (vitest). `npm run typecheck` runs `tsc` over the pure-TypeScript subset. `npm run demo:harness` runs the Priya repository's self-contained 33-case escalation harness, which mirrors the engine in plain JavaScript.

## Design decisions worth reading first

1. **Escalation is decided by code, after the reply, never by the model.** `priya/guardrails/escalation.engine.ts` is a pure function over six lexicons in five language buckets and four state fields, with a fixed precedence (symptoms first) and a latch: once a human is assigned, the assistant is silent for the life of the conversation. Matched message text is never returned or logged; only the lexicon name, the pattern name and the language.
2. **Redaction classifies by path, not by key name.** `superhuman/lib/ai/intake-classification.ts` exists because two earlier designs failed in opposite directions, and its header records both: a denylist that failed open on the field where a patient types their own name to sign a consent form, then an allowlist of key names that silently deleted all sixteen contraindication facts because `name` is a person under `personal` and a drug under `medications[]`. Unclassified paths render as `[WITHHELD]` so the model is told a fact is missing rather than allowed to assume it absent, and a test walks both intake schemas and fails the build on any unclassified path.
3. **Model output is parsed or rejected; it is never repaired.** `superhuman/lib/ai/prompts/*.ts` pair each prompt with a Zod schema; `parse...Output()` returns `null` on any deviation and the caller shows nothing. `superhuman/lib/ai/sanitize.ts` rejects any output containing a 10-digit run, an Aadhaar shape or an e-mail address, as a defence against prompt injection through patient-authored text.
4. **Confidence is displayed, never used.** `superhuman/lib/lab-parsing/confidence.ts` is a deterministic function of capture source, legibility and an OCR-sanity band, capped at 0.95 and floored at 0.05. Its header says what it is for and what it must never do. The band table records two review rounds in which the bands were wrong in opposite directions (genuine critical values scored like misreads; a widened band swallowed its own decimal-shift zone).
5. **Fail closed.** `superhuman/lib/ai/claude.ts`: ten-second timeout, no retries, a typed `ClaudeUnavailableError`; the interface shows "AI unavailable, proceed with manual review" with no retry control.
6. **An advisory model is kept out of clinical decisions by a written boundary.** `superhuman/docs/ADR-023-trajectory-projection-advisory-samd.md` is the author's own regulatory decision that a weight-trajectory projection is advisory-only and must not influence prescribing, dosing or eligibility until a regulator says otherwise, with the failure mode named.
7. **Rollout is gated by a physician, then by numbers.** `priya/docs/priya-runbook.md`: 48 hours of shadow mode in which the assistant's reply is posted as a private note the patient never sees, a physician review of at least thirty exchanges against five pre-registered veto criteria, then seven-day exit gates (qualification rate, infrastructure-handoff share, circuit trips, p95 latency, zero policy violations in the QA sample). `priya/docs/priya-hr-gate.md` records one retrospective validation of a suppression rule against a known set: 948 conversations, 22 of 22 known cases matched, 0 patients affected.
8. **Prompts are versioned artefacts.** Each Priya prompt version is an immutable file; the header of the current one records why each change was made and, in two cases, the production conversation that motivated it. `priya/prompts/priya.prompt.excerpt.md` reproduces the header, the ten hard rules and the escalation table.

## Layout

```
demo/                       escalation-demo.ts
superhuman/lib/ai/          claude.ts, redact.ts, intake-classification.ts, sanitize.ts, prompts/
superhuman/lib/lab-parsing/ prompt.ts, schema.ts, confidence.ts, claude.ts*, prepare-image.ts*
superhuman/lib/clinical/    thresholds.ts, contraindications.ts, contraindication-mapping.ts, drug-catalog.ts, intake-glp1-v1.ts
superhuman/lib/jobs/        parse-lab-upload.ts*
superhuman/tests/           ai/, lab-parsing/, clinical/
superhuman/scripts/proof/   redaction-glp1-contraindications.ts
superhuman/docs/            ADR-023, ai-output-handling-rules.md
priya/guardrails/           escalation.engine.ts, phone-ask-detector.ts, lexicons/, __tests__/
priya/llm/                  anthropic.provider.ts*, anthropic-circuit-breaker.ts*
priya/observability/        corpus-logger.service.ts*
priya/summary/              summary.prompt.ts
priya/prompts/              priya.prompt.excerpt.md
priya/docs/                 priya-runbook.md, priya-hr-gate.md, priya-ops-queries.sql, priya-ci-gates.yml
priya/scripts/              run-priya-escalation-tests.mjs
shop/                       generate_ingredient_profiles.py, ingredient-schema.json
```
Files marked `*` depend on runtime packages or infrastructure that are not installed here; they are included for reading and excluded from the type-check.

Three files were altered when copied, each noted in place: `priya/state/state.interface.ts` is reduced to the four fields the engine reads, `priya/prompts/priya.prompt.excerpt.md` is an excerpt, and one fixture e-mail address in `superhuman/tests/ai/sanitize.test.ts` was replaced with an `example.com` address. Everything else is byte-for-byte the production file as of 21 September 2026.

## Limitations

- **The deterministic escalation floor has no self-harm lexicon.** The suicide and self-harm trigger lives in the model's escalation table. `npm run demo:escalation` shows a self-harm disclosure passing the floor. The first change this repository argues for is a self-harm lexicon with Malayalam and Tamil variants, ranked above symptoms in precedence.
- **Symptom patterns are word-order sensitive.** "spreading rash" escalates; "the rash is spreading" does not. A token-set rule would close this at some cost in precision. That cost is measurable against the corpus log and should be measured, not guessed.
- **There is no evaluation of model output quality.** Neither system has a labelled set, a claim-level support taxonomy or an omission measure. Priya's exit gates measure operations (qualification, latency, infrastructure faults) and a physician's veto review, not the model's accuracy. The EMR's `lab_parse_results.corrected_values` column captures every physician correction to an extraction, which is the raw material for such an evaluation, but it has not been analysed.
- **The physician shadow review is documented, not instrumented.** The runbook prescribes it and the status records say it was done; the review artefacts are narrative, not a dataset.
- **Single author, single reviewer.** The clinical thresholds, the lexicons and the prompts were written and reviewed by one physician. The "four-engineer adversarial review" named in the source repositories is a structured self-review with AI assistance, not four people.
- **Scale is small.** About 335 patients in the EMR; on the order of a hundred qualified conversations a month for Priya. Nothing here is powered for a clinical-performance claim.
- **Indian regulatory context.** Thresholds follow Misra / ICMR-INDIAB; drug lists follow DCGI approval; the Drugs and Magic Remedies Act shapes the prompts' wording. These are the right constraints for the systems' setting and would need re-deriving elsewhere.

## Reproducing this extract

The source repositories are private. The extraction was done by copying named files, running a secret scanner and a PHI scanner (with a private name list) over the result and over the git history, and initialising a fresh history. See `SECURITY.md`.

## License

To be decided by the author before publication; until then, all rights reserved.
