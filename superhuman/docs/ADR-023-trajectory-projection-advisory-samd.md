# ADR-023 — The GLP-1 weight-trajectory projection is advisory-only, non-diagnostic, and must not influence prescribing logic

- **Status:** Accepted, 2026-08-08
- **Decision owner:** Dr. Rejeesh M. Menon (physician-founder)
- **Adjudicated by:** Priya — clinical data, and Anita — security & privacy / regulatory
- **Relates to:** Stone Rules #10 (AI never auto-applies to clinical fields),
  #39 (AI-lab parsing is assistive, not authoritative), #55 (agent never
  auto-writes a clinical field), #58 (CDS reads the structured record);
  model `SHTM-v1.0` (`docs/strategic/2026-08-06-superhuman-glp1-trajectory-reference.md`);
  the render+generate slice (PR #119).
- **Supersedes:** nothing. **Superseded by:** nothing.

> **Numbering note.** ADR-022 (prescriber-readiness gate) was the highest
> assigned, so this is **ADR-023**. ADR numbers have collided twice before
> (ADR-021 drafted as ADR-014, ADR-022 circulated as ADR-015) because
> MEMORY.md's DECISIONS LOG is append-only and reserves early numbers.
> Confirmed 023 is free against `docs/adr/` and the DECISIONS LOG before merge.

---

## Context

`SHTM-v1.0` computes a three-band (Conservative / Expected / Ambitious)
12-month weight + body-composition **projection** for a patient on injectable
semaglutide (Obeda / Sematrinity) or tirzepatide (Mounjaro), India-calibrated,
and — as of PR #119 — prints it as one page on the prescription PDF and stores
it in the append-only `patient_projections` table.

A patient-facing numeric forecast of a clinical outcome, printed on a Schedule H
document, sits close to the regulatory line for **Software as a Medical Device
(SaMD)**. India's CDSCO regulates SaMD; the Digital Information Security in
Healthcare Act posture and the DMR Act 1954 constrain what may be claimed. The
projection is decision-*support* and patient-*education* — it is emphatically
not a diagnosis, not a dosing recommendation, and not a device that decides
anything. That distinction must be true in code, not merely in intent, and it
must be recorded so a future contributor cannot quietly wire the projection into
a decision path without re-opening this question.

The failure mode this ADR exists to prevent: someone, reasonably, reads a stored
`patient_projections` row (or the `TrajectoryResult` in memory) and uses its
`status` / band / floor to gate a dose, flag a contraindication, or auto-message
a patient — turning an advisory education artifact into an unvalidated clinical
decision engine, without a regulatory opinion and without anyone noticing.

## Decision

**The trajectory projection is advisory-only, non-diagnostic, and SaMD-adjacent.
It is patient-education plus physician-reference material. It MUST NOT influence
prescribing, dosing, contraindication, eligibility, or any other clinical-decision
logic. No projection value — band, headline, floor, `status`, or
muscle-protection index — may feed a dosing or safety decision until a CDSCO
regulatory opinion explicitly permits it.**

Concretely, the following invariants hold and are the enforcement of this
decision:

1. **The projection never auto-applies to a clinical field (Stone #10/#55).**
   It is computed at Rx-generate time, drawn on the PDF, and stored — it is never
   written into `consults`, `prescriptions`, `vitals`, or `lab_results`, and the
   physician's Generate click is the recorded advisory approval (audit row names
   the actor).

2. **`patient_projections` is structurally walled off from clinical logic.**
   There is no foreign key *from* `prescriptions` or any CDS table *into* it; the
   app role holds `GRANT SELECT, INSERT` only; and no contraindication /
   eligibility / dosing module reads it. `lib/clinical/contraindications.ts`,
   `lib/clinical/glp1-eligibility.ts`, and the Rx dose-exactness spine do not and
   must not import from the projection store. A reviewer treats any such new read
   as a veto until this ADR is superseded.

3. **The chart omits rather than fabricates.** No target maintenance dose, an
   unresolved drug, or any compute error yields *no chart* — never a wrong number
   on a Schedule H document (the omit-not-fabricate gate, `lib/pdf/reportlab/trajectory.ts`).

4. **The projection fails open on the advisory, fails safe on the number.** An
   advisory-projection failure never blocks a prescription; a bad or missing
   input never draws a fabricated projection.

5. **The document says what it is.** The page carries "A guide, not a guarantee,"
   the "individual results vary" and "month-12 is not your ceiling" caveats, the
   "projected" labelling on the muscle track, and the calibration cue — so a
   patient reads it as an expectation, never a promise or a diagnosis.

6. **Structured-record honesty (Stone #58).** Diabetes status feeding the
   projection is read from `patient_medical_history`, not an intake boolean, and
   an unverified status is not asserted on the page (the "non-diabetic" label is
   printed only when affirmatively known).

## Consent

A projected trajectory *printed for the patient on their own prescription* is
**treatment-adjacent patient education** and is covered by the consent to
treatment. Any **secondary use** of the same stored projection data — cohort
analysis, model training, benchmarking, or any use beyond producing this
patient's own advisory document — requires **separable, purpose-specific
consent** recorded against the patient's consent ledger (the P1.13
consent-purpose stub, when built). The `patient_projections` store today carries
no consent-purpose linkage; wiring that linkage is a precondition for any
secondary use and is tracked, not yet built.

## Regulatory gate

**Before any projection value is permitted to influence a clinical decision** —
dosing, contraindication, eligibility, escalation, or an auto-generated
patient-facing clinical message — a **CDSCO regulatory opinion** on the SaMD
classification of that specific use MUST be obtained and recorded (as a new ADR
superseding this one). Until then the projection remains advisory education and
physician reference only. "It would be clinically useful" is not sufficient
grounds to cross this line; the regulatory opinion is.

## Consequences

- **Positive.** The regulatory posture is explicit and enforced by structure
  (no FK, least-privilege grant, no clinical-module import), so the advisory /
  device boundary cannot be crossed silently. A future contributor who tries to
  gate a dose on a projection hits a reviewer veto that points here.
- **Negative / accepted.** The projection cannot be used for genuinely useful
  automation (e.g. auto-flagging non-responders to the physician) until the
  recalibration + notify work lands *and* — if that automation feeds a clinical
  decision — a CDSCO opinion is obtained. That deferral is deliberate: an
  unvalidated forecast must not drive care.
- **Follow-ups (tracked, not part of this ADR).** The recalibration-on-weigh-in
  job (advisory status only, no auto-message — Stone #55) and the P1.13
  consent-purpose linkage for any secondary use.
