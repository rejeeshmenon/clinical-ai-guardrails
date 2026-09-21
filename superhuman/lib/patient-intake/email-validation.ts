/**
 * Single source of truth for "does this look like an email" — shared by
 * every capture surface (patient self-intake, staff registration, and any
 * future one) AND the server-side Zod schemas that ultimately gate the
 * write.
 *
 * Anita 2026-08-12 executed the divergence between the old ad-hoc client
 * regex (`/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`) and the server's
 * `z.string().email()`: `a@-b.com`, `a@b..com`, `a"b@c.com` and a
 * script-tag payload all passed the old client check and were rejected by
 * the server — stranding the patient three steps later (past vitals,
 * labs, goals + consent + typed signature) with a generic "We couldn't
 * save your intake" error pointing at nothing. Reusing the exact same
 * zod call as the server removes the possibility of the two drifting
 * again; this is not a stricter rule, it is the SAME rule run twice.
 */
import { z } from 'zod';

export const PatientEmailSchema = z.string().email();

export function isValidPatientEmail(email: string): boolean {
  return PatientEmailSchema.safeParse(email).success;
}

/**
 * Hard-required email rule for the deliberate-capture surfaces — patient
 * self-intake and staff walk-in registration.
 *
 * Founder decision 2026-08-14: email is MANDATORY at capture. The earlier
 * "I don't have an email address" escape hatch is REMOVED on these two
 * surfaces, because coverage (3 of 202 today) only accrues if the ask can't
 * be skipped. Blank is blocked; a malformed shape is blocked with the exact
 * same server-side `z.string().email()` rule (no client/server drift —
 * Anita Concern 3). Still permissive on real-but-unusual addresses (long
 * TLDs, subdomains, plus/apostrophe local parts) — a false rejection of a
 * genuine address is its own harm.
 *
 * SCOPE OF ENFORCEMENT (updated 2026-08-15): the FORMAT rule is the exact
 * server-side `z.string().email()` — client and server can never disagree on
 * shape. PRESENCE is now SERVER-enforced on BOTH deliberate-capture surfaces:
 * patient self-intake (email is REQUIRED in `PatientIntakeSubmissionSchema`,
 * which is intake-only) and staff registration (a route-level `email_required`
 * 400 in `app/api/clinician/patients/register/route.ts`). A direct API call to
 * either can no longer omit email. The SHARED `patientInputSchema`
 * (`lib/clinical/validators.ts`) stays lenient BY DESIGN — it also serves the
 * demographics-edit PATCH and the `/api/patients` + `/api/v1/patients`
 * integration paths, which must keep creating/editing email-less records (the
 * 199 existing email-less patients, imports, walk-in leads). Do not "fix" it.
 *
 * Accepted operational consequence, recorded not re-litigated (see MEMORY.md):
 * a patient with genuinely no email can no longer be created through EITHER
 * human-facing surface — the earlier "register with staff help" fallback is
 * now CLOSED. An email-less record can still be created via the lenient
 * internal/integration path (`/api/patients`, `/api/v1/patients`); a
 * staff-override capturing an audited reason on the register route is the
 * care-access-safe pattern if the founder ever wants one (Priya flagged the
 * urgent-walk-in case; not built). Verification of the captured address before
 * it is TRUSTED to receive PHI is a separate downstream (send-side) concern —
 * mandatory capture alone does not make an address safe to send lab results to.
 *
 * Returns null when the field may proceed.
 */
export function requiredEmailError(email: string, missingMessage: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) {
    return missingMessage;
  }
  if (!isValidPatientEmail(trimmed)) {
    return 'That email address doesn’t look right — please check it.';
  }
  return null;
}

/**
 * Optional email rule for the edit-demographics modal (Stone Rule #37),
 * which is opened for ARBITRARY demographic edits — a phone-number typo fix,
 * a pincode correction — and must never force an email decision on an
 * unrelated save. Blank is allowed; a non-blank value is still held to the
 * same server-identical shape so a typo can't be saved. The modal guards
 * the destructive case (clearing a value the patient already had) with an
 * explicit confirm rather than a validation rule.
 *
 * Returns null when the field may proceed.
 */
export function optionalEmailError(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) {
    return null;
  }
  if (!isValidPatientEmail(trimmed)) {
    return 'That email address doesn’t look right — please check it.';
  }
  return null;
}

/**
 * The value to PERSIST for an email field: trimmed, or null when blank.
 *
 * Priya FAIL (2026-08-14, round 1): the validators above trim BEFORE
 * checking, but the submit sites were sending the raw value — so
 * `"a@b.com "` (a trailing space from mobile autofill/paste) passed the
 * client gate and was then rejected by the server's un-trimmed
 * `z.string().email()`, stranding the patient after the entire flow. This
 * is the single normalisation every submit site MUST use, so the value that
 * was validated is the value that is sent. Empty/whitespace collapses to
 * null (which the modal's destructive-clear guard then catches).
 */
export function normalizeEmailForSubmit(email: string): string | null {
  const trimmed = email.trim();
  return trimmed === '' ? null : trimmed;
}
