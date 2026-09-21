/**
 * What Claude may see of a patient's intake form, decided BY PATH.
 *
 * ---------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL (Anita, 2026-08-12)
 * ---------------------------------------------------------------------
 * `lib/ai/redact.ts` used to filter the intake payload with a denylist of
 * PHI-shaped key names. It listed `full_name` and missed every other place
 * a name is stored:
 *
 *   consent.digital_signature  the patient TYPES their own full name to
 *                              sign the consent (migration 0012); the API
 *                              verifies it equals personal.full_name.
 *   personal.referred_by       usually a THIRD PARTY's name.
 *   personal.date_of_birth     redact.ts's own docstring says "do NOT
 *                              pass DOB"; the denylist didn't enforce it.
 *
 * `redactFreeText` cannot cover this: it matches emails, phones, Aadhaar,
 * ABHA and pincodes and has NO name pattern, because names are not
 * pattern-matchable. The key filter is the sole defence, and a denylist is
 * the wrong shape for a sole defence — it fails OPEN.
 *
 * ---------------------------------------------------------------------
 * WHY BY PATH, AND NOT BY KEY NAME (Priya, 2026-08-13)
 * ---------------------------------------------------------------------
 * A first attempt used a flat allowlist of key names. Priya executed it
 * against a real `glp1.v1` payload with every GLP-1 hard block set to
 * `yes` and got:
 *
 *     INTAKE: { "medications": [ {}, {} ], "allergies": [ "Sulfa drugs" ] }
 *     16/16 clinical facts lost: mtc, familyMtc, men2, pancreatitis,
 *     severeGastroparesis, activeGallbladderDisease, type1Diabetes,
 *     pregnant, lactating, planningWithin2Months, Warfarin, ...
 *
 * Claude would have drafted "Eligible" for a pregnant patient with MTC.
 * Two reasons it failed, both structural:
 *
 *  1. TWO schemas write to `intake_forms.payload` — `portal.v1`
 *     (lib/patient-intake/schema.ts, patient-filled) and `glp1.v1`
 *     (lib/clinical/intake-glp1-v1.ts, clinician-filled). The AI routes
 *     read the latest row with NO schemaVersion filter, so either shape
 *     arrives. Only the first was accounted for.
 *  2. `name` means two different things. `personal.name` is a person;
 *     `medications[].name` is a DRUG. A bare-key rule cannot hold both,
 *     which is why every medication collapsed to `{}`.
 *
 * A path — `medications[].name` vs `personal.full_name` — carries the
 * context that makes the decision possible.
 *
 * ---------------------------------------------------------------------
 * THE THREE OUTCOMES
 * ---------------------------------------------------------------------
 *   ALLOW    the value passes (strings still go through redactFreeText)
 *   OMIT     dropped with no trace. For identifiers and for non-clinical
 *            noise. Anita's ruling: the prompt is persisted verbatim into
 *            `ai_interactions.prompt_redacted`, so a `[REDACTED]` marker
 *            would durably record "this patient had a referrer" in a
 *            clinician-readable table. Silence is more minimal.
 *   WITHHELD anything unclassified — rendered as "[WITHHELD]". Priya's
 *            ruling: DIAGNOSIS_SYSTEM_PROMPT tells the model to SAY SO
 *            when a datum needed to exclude a contraindication is
 *            missing, rather than assume it absent. Silent omission makes
 *            that instruction unreachable, so an unclassified CLINICAL
 *            field must be visibly missing, not invisibly gone.
 *
 * Unclassified therefore fails closed *and loudly*. `tests/ai/
 * intake-classification.test.ts` walks BOTH live zod schemas and fails
 * the build naming any path that is on neither list — so "unclassified"
 * is a transient state during development, never a shipped one.
 *
 * ---------------------------------------------------------------------
 * WHAT THE GUARD TEST DOES *NOT* DO (Anita, round 2 — read this before
 * weakening either half)
 * ---------------------------------------------------------------------
 * The guard does NOT provide the privacy property. That rests entirely on
 * the default-deny in `redactObject`, which is independent of the walk and
 * holds for every shape the walk cannot see. The guard protects CLINICAL
 * COMPLETENESS — it stops a real field silently becoming `[WITHHELD]`
 * when the diagnosis draft needs it. Its blind spots cost Priya's axis,
 * not Anita's.
 *
 * That distinction matters because the two rulings lean on each other:
 * marking unclassified fields is only acceptable BECAUSE the guard makes
 * "unclassified" a build-breaking transient state. A newly-added
 * identifier renders as `"aadhaar_number": "[WITHHELD]"` until someone
 * classifies it — recording that we hold one. Anita accepted that on the
 * explicit condition that the guard never becomes a warning, a
 * `console.warn`, or a skipped test. If it does, that ruling lapses.
 */

/**
 * Paths Claude may see. Exact leaf paths only — no subtree wildcards, so
 * a field added inside an allowed object is still unclassified and still
 * caught by the guard test.
 *
 * Array notation: an array OF SCALARS is classified by the array's own
 * path (`vitals.allergies`); an array OF OBJECTS classifies each property
 * (`medications[].name`).
 */
export const ALLOWED_PATHS: ReadonlySet<string> = new Set([
  // ===================== portal.v1 (patient-filled) =====================
  // The only demographic the model needs. Age arrives separately and
  // pre-computed as PromptInputs.patient.ageYears — never the DOB.
  'personal.sex',

  'vitals.weight_kg',
  'vitals.height_cm',
  'vitals.waist_cm',
  'vitals.hip_cm',
  'vitals.bp_systolic',
  'vitals.bp_diastolic',
  'vitals.current_medications',
  'vitals.medical_conditions',
  'vitals.allergies',

  'lifestyle.goal',
  'lifestyle.activity_level',
  'lifestyle.diet_type',
  'lifestyle.extra_notes',

  // ================= glp1.v1 (clinician-filled, top-level) ==============
  // Shift work is metabolically load-bearing in this programme; free text
  // still passes through redactFreeText for phone/email/Aadhaar patterns.
  'occupation',
  'livesWithSupport',
  'smoker',
  'alcoholUnitsPerWeek',
  'exerciseDaysPerWeek',
  'sleepHoursPerNight',

  // The contraindication surface. Every one of these is a CLAUDE.md §6
  // hard block or a comorbidity the draft reasons from. Losing any of
  // them is the defect that made this rewrite necessary.
  'history.mtc',
  'history.familyMtc',
  'history.men2',
  'history.pancreatitis',
  'history.severeGastroparesis',
  'history.activeGallbladderDisease',
  'history.type1Diabetes',
  'history.type2Diabetes',
  'history.htn',
  'history.dyslipidemia',
  'history.cardiacHistory',
  'history.thyroidDisease',
  'history.polycysticOvarySyndrome',

  'pregnancy.pregnant',
  'pregnancy.lactating',
  'pregnancy.planningWithin2Months',
  // Clinical timing, not an identifier — unlike DOB it does not pin a
  // person, and gestational-window reasoning needs it.
  'pregnancy.lastMenstrualPeriod',

  // DRUG names, not people. This is the distinction a bare-key rule
  // could not express.
  'medications[].name',
  'medications[].dose',
  'medications[].frequency',

  'allergies',

  'prevGlp1.used',
  'prevGlp1.drug',
  'prevGlp1.durationMonths',
  // "severe vomiting, hospitalised" — directly drives drug and dose
  // selection, and has no deterministic backstop anywhere else.
  'prevGlp1.discontinuedReason',

  'goal.primary',
  'goal.targetWeightKg',
  'goal.timelineMonths',

  'notes'
]);

/**
 * Paths dropped WITHOUT a marker.
 *
 * Two kinds, both of which the model has no use for and neither of which
 * should leave a trace in the persisted prompt:
 *   - direct and quasi identifiers
 *   - non-clinical bookkeeping (the consent block)
 *
 * Prefix semantics: listing `consent` omits everything beneath it.
 */
export const OMITTED_PATHS: ReadonlySet<string> = new Set([
  'personal.full_name',
  // Age reaches the model pre-computed; the DOB itself never does.
  'personal.date_of_birth',
  'personal.phone_e164',
  'personal.email',
  'personal.address_line1',
  // Quasi-identifiers. Locality plus a metabolic condition re-identifies
  // inside a 7-clinic Kerala/TN catchment, and regional dietary context
  // is population-level — it belongs in the system prompt, not in a
  // per-patient payload. Priya concurred.
  'personal.city',
  'personal.state',
  'personal.pincode',
  // A third party's name. Not even our data principal.
  'personal.referred_by',
  // Marketing attribution ("Instagram", "Referred by a doctor") — no
  // clinical content, and the referral variant names a person.
  'lifestyle.source',
  // The whole consent block. `digital_signature` IS the patient's name —
  // that is what makes it a signature — and `consent_text` is up to
  // 20,000 characters of legal boilerplate on every single call.
  'consent'
]);

export type Classification = 'allow' | 'omit' | 'withhold';

/**
 * Classify one path. `omit` wins on any ancestor match so a whole block
 * (`consent`) can be dropped with one entry; `allow` requires an exact
 * leaf match so nothing new slips in under an approved parent.
 */
export function classifyPath(path: string): Classification {
  if (ALLOWED_PATHS.has(path)) return 'allow';
  /*
   * Ancestor-prefix check for omission, e.g. `consent.digital_signature`.
   *
   * The trailing `[]` is stripped per segment (Anita LOW, round 2): before
   * this, `personal.referred_by` classified `omit` but
   * `personal.referred_by[]` classified `withhold`, so an omitted array of
   * objects rendered as `[{n:"[WITHHELD]"},{n:"[WITHHELD]"}]` — no value
   * leaked, but the persisted prompt durably recorded "this patient had
   * two referrers", which is precisely the disclosure the omit-over-marker
   * ruling exists to prevent. Same for a `consent[]` shape, which would
   * have walked rather than dropped a 20,000-character block.
   */
  const segments = path.split('.').map((s) => (s.endsWith('[]') ? s.slice(0, -2) : s));
  for (let i = segments.length; i > 0; i--) {
    if (OMITTED_PATHS.has(segments.slice(0, i).join('.'))) return 'omit';
  }
  return 'withhold';
}

/** Rendered in place of an unclassified clinical field. */
export const WITHHELD_MARKER = '[WITHHELD]';
