/**
 * Stone Rule #13 + the clinical completeness of the AI prompt.
 *
 * TWO defects are pinned here, and the second is the one that nearly
 * shipped:
 *
 * 1. PRIVACY (Anita, 2026-08-12). The old denylist listed `full_name` and
 *    missed `consent.digital_signature` — the patient's own typed full
 *    name, which the API verifies EQUALS `personal.full_name` — plus
 *    `personal.referred_by` (a third party) and `personal.date_of_birth`.
 *    `redactFreeText` cannot help: no name pattern exists.
 *
 * 2. CLINICAL (Priya, 2026-08-13). The first fix — a flat allowlist of
 *    KEY NAMES — deleted the entire GLP-1 contraindication surface,
 *    because TWO schemas write to `intake_forms.payload` and only one was
 *    considered, and because `name` means "a person" in `personal` and
 *    "a drug" in `medications[]`. Executed against a payload with every
 *    hard block set to `yes`, it produced:
 *
 *        { "medications": [ {}, {} ], "allergies": [ "Sulfa drugs" ] }
 *
 *    Claude would have drafted "Eligible" for a pregnant patient with
 *    MTC — with 1991 tests green. A redactor that strips the medicine is
 *    not safer; it is broken.
 *
 * So every test below asserts BOTH directions at once: identifiers gone,
 * clinical facts intact.
 */
import { describe, it, expect } from 'vitest';
import { inputsToPromptText, type PromptInputs } from '../../lib/ai/redact';
import { ALLOWED_PATHS, OMITTED_PATHS, classifyPath } from '../../lib/ai/intake-classification';
import { PatientIntakeSubmissionSchema } from '../../lib/patient-intake/schema';
import { glp1IntakeSchema } from '../../lib/clinical/intake-glp1-v1';
import { z } from 'zod';

function promptFor(intake: Record<string, unknown>): string {
  const inputs: PromptInputs = { patient: { ageYears: 41, sex: 'F' }, intake };
  return inputsToPromptText(inputs);
}

/** portal.v1 — patient-filled, carries the identifiers. */
const PORTAL_INTAKE = {
  personal: {
    full_name: 'Priya Nair',
    date_of_birth: '1988-04-12',
    sex: 'F',
    phone_e164: '+919845012345',
    email: 'priya.nair@example.com',
    address_line1: '14 Marine Drive',
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682031',
    referred_by: 'Dr Anand Menon'
  },
  vitals: {
    weight_kg: 84.5, height_cm: 161, waist_cm: 98, hip_cm: 112,
    bp_systolic: 138, bp_diastolic: 88,
    current_medications: 'Metformin 500mg BD',
    medical_conditions: ['PCOS', 'Pre-diabetes'],
    allergies: 'Sulfa drugs'
  },
  lifestyle: {
    goal: 'Lose 10–20 kg', activity_level: 'Sedentary',
    diet_type: 'Vegetarian', source: 'Referred by a doctor',
    extra_notes: 'Works night shifts.'
  },
  consent: {
    agreed: true,
    consent_text: 'x'.repeat(500),
    digital_signature: 'Priya Nair',
    consent_version: '1.0'
  }
};

/** glp1.v1 — clinician-filled. EVERY hard block set. Priya's payload. */
const GLP1_INTAKE = {
  occupation: 'Night-shift nurse',
  livesWithSupport: 'yes',
  smoker: 'no',
  alcoholUnitsPerWeek: 2,
  exerciseDaysPerWeek: 1,
  sleepHoursPerNight: 5,
  history: {
    mtc: 'yes', familyMtc: 'yes', men2: 'yes', pancreatitis: 'yes',
    severeGastroparesis: 'yes', activeGallbladderDisease: 'yes',
    type1Diabetes: 'yes', type2Diabetes: 'yes', htn: 'yes',
    dyslipidemia: 'yes', cardiacHistory: 'yes', thyroidDisease: 'yes',
    polycysticOvarySyndrome: 'yes'
  },
  pregnancy: {
    pregnant: 'yes', lactating: 'yes', planningWithin2Months: 'yes',
    lastMenstrualPeriod: '2026-07-01'
  },
  medications: [
    { name: 'Warfarin', dose: '5mg', frequency: 'OD' },
    { name: 'Insulin glargine', dose: '18u', frequency: 'nocte' }
  ],
  allergies: ['Sulfa drugs', 'Penicillin'],
  prevGlp1: {
    used: 'yes', drug: 'Semaglutide', durationMonths: 3,
    discontinuedReason: 'severe vomiting, hospitalised'
  },
  goal: { primary: 'weight_loss', targetWeightKg: 68, timelineMonths: 9 },
  notes: 'Reviewed by Dr S Pillai in clinic.'
};

describe('portal.v1 — identifiers withheld, clinical kept', () => {
  it('withholds every name-bearing field, including the ones the denylist missed', () => {
    const p = promptFor(PORTAL_INTAKE);
    for (const leaked of ['Priya Nair', 'Dr Anand Menon', '1988-04-12']) {
      expect(p, `LEAKED: ${leaked}`).not.toContain(leaked);
    }
  });

  it('withholds the identifiers the denylist did already catch', () => {
    const p = promptFor(PORTAL_INTAKE);
    for (const leaked of [
      '+919845012345', 'priya.nair@example.com', '14 Marine Drive',
      'Kochi', 'Kerala', '682031'
    ]) {
      expect(p, `LEAKED: ${leaked}`).not.toContain(leaked);
    }
  });

  it('drops the consent block whole — signature is a name, consent_text is boilerplate', () => {
    const p = promptFor(PORTAL_INTAKE);
    expect(p).not.toContain('digital_signature');
    expect(p).not.toContain('x'.repeat(100));
  });

  it('keeps every clinical value', () => {
    const p = promptFor(PORTAL_INTAKE);
    for (const kept of [
      '84.5', '161', '98', '112', '138', '88',
      'Metformin 500mg BD', 'PCOS', 'Pre-diabetes', 'Sulfa drugs',
      'Lose 10–20 kg', 'Sedentary', 'Vegetarian', 'Works night shifts.'
    ]) {
      expect(p, `clinical value lost: ${kept}`).toContain(kept);
    }
  });
});

describe('glp1.v1 — the contraindication surface must survive intact', () => {
  /*
   * THE REGRESSION TEST. Every one of these was deleted by the flat-key
   * allowlist. If this fails, the AI is reasoning about GLP-1 eligibility
   * blind to a hard block.
   */
  it('keeps all thirteen history flags', () => {
    const p = promptFor(GLP1_INTAKE);
    for (const key of Object.keys(GLP1_INTAKE.history)) {
      expect(p, `contraindication flag LOST: history.${key}`).toContain(key);
    }
  });

  it('keeps the pregnancy block — there is no other source of pregnancy status', () => {
    const p = promptFor(GLP1_INTAKE);
    for (const key of ['pregnant', 'lactating', 'planningWithin2Months']) {
      expect(p, `LOST: pregnancy.${key}`).toContain(key);
    }
  });

  it('keeps DRUG names — `name` under medications is not a person', () => {
    const p = promptFor(GLP1_INTAKE);
    expect(p).toContain('Warfarin');
    expect(p).toContain('Insulin glargine');
    expect(p).toContain('5mg');
    // and never the content-free `[{},{}]` the flat allowlist produced
    expect(p).not.toMatch(/"medications":\s*\[\s*\{\s*\}/);
  });

  it('keeps prior GLP-1 history including why it was stopped', () => {
    const p = promptFor(GLP1_INTAKE);
    expect(p).toContain('Semaglutide');
    expect(p).toContain('severe vomiting, hospitalised');
  });

  it('keeps the nested goal object that the flat allowlist flattened away', () => {
    expect(promptFor(GLP1_INTAKE)).toContain('weight_loss');
  });

  it('keeps lifestyle scalars and clinician notes', () => {
    const p = promptFor(GLP1_INTAKE);
    for (const kept of ['Night-shift nurse', 'smoker', 'Penicillin']) {
      expect(p, `LOST: ${kept}`).toContain(kept);
    }
  });
});

describe('fails closed, and loudly', () => {
  it('an unclassified scalar is WITHHELD, not passed', () => {
    const p = promptFor({ personal: { emergency_contact_name: 'Suresh Nair' } });
    expect(p).not.toContain('Suresh Nair');
    expect(p).toContain('[WITHHELD]');
  });

  /*
   * Anita BLOCKER 1: array elements have no key, so the previous
   * implementation returned them through the scalar branch with NO
   * classification — `referred_by: ['Dr Anand Menon']` leaked verbatim,
   * one of the three keys the fix existed to close.
   */
  it('an array under an OMITTED key does not leak (arrays used to fail open)', () => {
    const p = promptFor({ personal: { referred_by: ['Dr Anand Menon', 'Dr S Pillai'] } });
    expect(p).not.toContain('Dr Anand Menon');
    expect(p).not.toContain('Dr S Pillai');
  });

  it('an array under an UNCLASSIFIED key does not leak either', () => {
    const p = promptFor({ personal: { aliases: ['Priya Nair'], previous_physicians: ['Dr Menon'] } });
    expect(p).not.toContain('Priya Nair');
    expect(p).not.toContain('Dr Menon');
  });

  it('marks unclassified rather than omitting, so the model cannot assume absent', () => {
    // DIAGNOSIS_SYSTEM_PROMPT tells the model to SAY SO when a datum it
    // needs is missing. Silent omission makes that unreachable.
    expect(promptFor({ history: { someNewHardBlock: 'yes' } })).toContain('[WITHHELD]');
  });

  it('still pattern-sweeps allowed free text (defence in depth)', () => {
    const p = promptFor({ notes: 'Call her on 9845012345 or a@b.com' });
    expect(p).not.toContain('9845012345');
    expect(p).not.toContain('a@b.com');
    expect(p).toContain('[PHONE]');
    expect(p).toContain('[EMAIL]');
  });

  /*
   * Anita HIGH (round 2). `.` and `[]` are our path separators, but a JSON
   * key may legally contain them — so a key named literally
   * `"medications[].name"` would match ALLOWED_PATHS and pass verbatim.
   * Not reachable today (all three writers zod-parse, and strip-mode drops
   * unknown keys) but the premise of this filter is an untrusted payload.
   */
  it('a forged dotted/bracketed key cannot impersonate an allowed path', () => {
    for (const forged of ['medications[].name', 'vitals.weight_kg', 'history.mtc']) {
      const p = promptFor({ [forged]: 'Priya Nair' });
      expect(p, `forged key "${forged}" leaked its value`).not.toContain('Priya Nair');
    }
  });

  /*
   * Anita LOW (round 2). An omitted array-of-objects used to render as
   * [{n:"[WITHHELD]"},{n:"[WITHHELD]"}] — no value, but the persisted
   * prompt durably recorded "this patient had two referrers", which is
   * exactly what the omit-over-marker ruling exists to prevent.
   */
  it('an omitted array discloses no count', () => {
    const p = promptFor({ personal: { referred_by: [{ n: 'Dr A' }, { n: 'Dr B' }] } });
    expect(p).not.toContain('referred_by');
    expect(p).not.toContain('WITHHELD');
  });
});

describe('clinical faithfulness of the filtered payload', () => {
  /*
   * Priya M1 (round 2). `medications` and `allergies` are `.default([])`,
   * so `[]` is an affirmative "reconciliation done, none found" — NOT
   * absence. Dropping it made NKDA indistinguishable from "allergy history
   * never taken", on the majority of patients, in the one prompt
   * instructed to caveat on missing data.
   */
  it('preserves an empty clinical array — NKDA is a finding, not a silence', () => {
    const p = promptFor({ medications: [], allergies: [], smoker: 'no' });
    expect(p).toContain('"medications": []');
    expect(p).toContain('"allergies": []');
  });

  /*
   * Priya M2 (round 2). `Object.entries(new Date())` is `[]`, so a Date
   * fell through the object branch and vanished with neither value nor
   * marker — breaking the invariant that an ALLOWED field always appears.
   * `pregnancy.lastMenstrualPeriod` is `z.coerce.date()` and
   * app/api/intake/route.ts persists the zod-PARSED object.
   */
  it('an allowed Date survives instead of vanishing silently', () => {
    const p = promptFor({
      pregnancy: { pregnant: 'yes', lastMenstrualPeriod: new Date('2026-07-01T00:00:00Z') }
    });
    expect(p).toContain('lastMenstrualPeriod');
    expect(p).toContain('2026');
  });
});

/**
 * THE GUARD. Walks BOTH live schemas — the single-schema version of this
 * is what let the glp1.v1 regression through with green CI.
 */
function leafPaths(schema: z.ZodTypeAny, prefix = ''): string[] {
  // Unwrap the wrappers zod puts around optional/nullable/default/effects.
  let s: z.ZodTypeAny = schema;
  for (let i = 0; i < 10; i++) {
    const def = (s as unknown as { _def?: Record<string, unknown> })._def;
    if (!def) break;
    const inner = (def.innerType ?? def.schema ?? def.type) as z.ZodTypeAny | undefined;
    if (inner && typeof inner === 'object' && '_def' in inner) {
      // ZodArray's element lives on `type`; mark the path and continue.
      if ((def as { typeName?: string }).typeName === 'ZodArray') {
        const elemIsObject = (inner as unknown as { shape?: unknown }).shape !== undefined;
        return leafPaths(inner, elemIsObject ? `${prefix}[]` : prefix);
      }
      s = inner;
      continue;
    }
    break;
  }
  const shape = (s as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (!shape) {
    /*
     * Priya round 2: silently returning `prefix` for an unrecognised
     * wrapper is how the walk's path can diverge from the runtime path —
     * `z.array(z.object().optional())` emitting `meds.name` while
     * redactObject uses `meds[].name`. The dev then classifies a path
     * that is never asked about, CI goes green, and the real field
     * renders `[WITHHELD]`. That is a milder cousin of the regression
     * this whole rewrite exists to close, so refuse rather than guess.
     *
     * Known terminal types are fine; anything structural is not.
     */
    const def = (s as unknown as { _def?: { typeName?: string; options?: z.ZodTypeAny[] } })._def;
    const typeName = def?.typeName ?? 'unknown';
    /*
     * A union of PRIMITIVES is a leaf, not a container — `glp1.v1`'s
     * `yesNo` is `z.union([literal,literal,literal])` and behaves exactly
     * like an enum. Only a union whose options carry a `shape` is
     * structurally ambiguous, because then the walk would have to pick
     * which branch's paths to emit.
     */
    const unionOfObjects =
      (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') &&
      (def?.options ?? []).some(
        (o) => (o as unknown as { shape?: unknown }).shape !== undefined
      );
    const STRUCTURAL = ['ZodRecord', 'ZodIntersection', 'ZodPipeline', 'ZodLazy', 'ZodTuple'];
    if (unionOfObjects || STRUCTURAL.includes(typeName)) {
      throw new Error(
        `leafPaths cannot walk ${typeName} at "${prefix}". Teach it that shape before ` +
          `adding one to an intake schema — otherwise the guard reports a path the ` +
          `redactor never asks about, and a real clinical field silently becomes [WITHHELD].`
      );
    }
    return [prefix];
  }
  return Object.entries(shape).flatMap(([k, v]) =>
    leafPaths(v, prefix ? `${prefix}.${k}` : k)
  );
}

describe('classification guard — every key in EVERY live schema is decided', () => {
  const schemas: Array<[string, z.ZodTypeAny]> = [
    ['portal.v1', PatientIntakeSubmissionSchema as unknown as z.ZodTypeAny],
    ['glp1.v1', glp1IntakeSchema as unknown as z.ZodTypeAny]
  ];

  for (const [name, schema] of schemas) {
    it(`${name}: no unclassified path`, () => {
      const paths = leafPaths(schema).filter((p) => p.length > 0);
      expect(paths.length, `walk of ${name} found nothing — the walk is broken`).toBeGreaterThan(5);

      const unclassified = paths.filter((p) => classifyPath(p) === 'withhold');
      expect(
        unclassified,
        `Unclassified ${name} path(s). Decide in lib/ai/intake-classification.ts ` +
          `whether Claude may see each, then add to ALLOWED_PATHS or OMITTED_PATHS: ` +
          unclassified.join(', ')
      ).toEqual([]);
    });
  }

  it('the two lists never contradict each other', () => {
    const both = [...ALLOWED_PATHS].filter((p) => OMITTED_PATHS.has(p));
    expect(both, `classified both ways: ${both.join(', ')}`).toEqual([]);
  });
});
