/**
 * Zod schema for the patient-portal intake submission.
 *
 * Step 1 — Personal:    full_name, dob, sex, mobile, email, address, …
 * Step 2 — Vitals:      weight, height, waist, hip, BP, conditions, allergies
 * Step 3 — (Labs handled out-of-band via /api/patient/labs/upload)
 * Step 4 — Lifestyle:   goal, activity_level, diet_type, source, notes, consent
 *
 * Stone Rule 7: BMI is computed server-side from weight/height using
 * Asian Indian thresholds. The client may calculate for display but the
 * canonical BMI lives in the DB-generated `vitals.bmi` column.
 *
 * Stone Rule 17: this schema does NOT accept a patient_id. The route
 * fixes patient_id from the session (Stone Rule 17 enforcement).
 */
import { z } from 'zod';
import { PatientEmailSchema } from './email-validation';

export const PINCODE_RE = /^[1-9][0-9]{5}$/;
const PHONE_E164 = /^\+[1-9][0-9]{6,14}$/;

export const PatientIntakeSubmissionSchema = z.object({
  personal: z.object({
    full_name: z.string().trim().min(2).max(120),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sex: z.enum(['M', 'F', 'O']),
    phone_e164: z.string().regex(PHONE_E164),
    // Anita 2026-08-12: imported from lib/patient-intake/email-validation.ts
    // so the client-side check (IntakeClient's emailStepError, the staff
    // registration gate) and this server-authoritative schema are
    // GUARANTEED identical — they call the same zod object, not two
    // regexes that happen to agree today.
    //
    // REQUIRED (2026-08-15): email is now server-enforced at intake, not just a
    // client gate — this schema is intake-only (not shared with the edit PATCH
    // or the /api/patients + /api/v1 integration paths, which stay lenient), so
    // a missing/blank email is rejected with a ZodError → 400 regardless of how
    // the request arrives. Mirrors the browser mandate from deploy #6.
    email: PatientEmailSchema,
    address_line1: z.string().max(200).optional().nullable(),
    city: z.string().max(80).optional().nullable(),
    state: z.string().max(80).optional().nullable(),
    pincode: z.string().regex(PINCODE_RE).optional().nullable(),
    referred_by: z.string().max(120).optional().nullable()
  }),
  vitals: z.object({
    weight_kg: z.number().min(20).max(400),
    height_cm: z.number().min(50).max(250),
    waist_cm: z.number().min(30).max(250).optional().nullable(),
    hip_cm: z.number().min(30).max(250).optional().nullable(),
    bp_systolic: z.number().int().min(50).max(260).optional().nullable(),
    bp_diastolic: z.number().int().min(30).max(180).optional().nullable(),
    current_medications: z.string().max(2000).optional().nullable(),
    medical_conditions: z.array(z.string().max(120)).max(40).default([]),
    allergies: z.string().max(2000).optional().nullable()
  }),
  lifestyle: z.object({
    goal: z.string().max(120),
    activity_level: z.string().max(80),
    diet_type: z.string().max(80),
    source: z.string().max(120).optional().nullable(),
    extra_notes: z.string().max(4000).optional().nullable()
  }),
  consent: z.object({
    agreed: z.literal(true),
    consent_text: z.string().min(40).max(20000),
    // Migration 0012 — typed-signature electronic consent (IT Act 2000
    // + Indian Evidence Act §65B). The signature is the patient's
    // typed full name; the API verifies it matches personal.full_name
    // (case-insensitive, trimmed).
    digital_signature: z.string().min(1).max(200),
    consent_version: z.string().max(20).default('1.0')
  })
});

export type PatientIntakeSubmission = z.infer<typeof PatientIntakeSubmissionSchema>;

/** Compute BMI (kg/m²) from weight_kg + height_cm. */
export function computeBmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}
