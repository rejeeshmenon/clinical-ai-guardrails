/**
 * Stone Rule #60 execution proof — AI intake redaction.
 *
 *   npx tsx scripts/proof/redaction-glp1-contraindications.ts
 *
 * TWO defects, proven closed together, because fixing either one alone
 * breaks the other:
 *
 * PRIVACY (Anita, 2026-08-12) — the old denylist listed `full_name` and
 * missed `consent.digital_signature`, which is the patient's own typed
 * full name (the API verifies it equals `personal.full_name`), plus
 * `personal.referred_by` (a third party) and `personal.date_of_birth`.
 *
 * CLINICAL (Priya, 2026-08-13) — the FIRST attempt at a fix, a flat
 * allowlist of key names, deleted the entire GLP-1 contraindication
 * surface from `glp1.v1` payloads. Two schemas write to
 * `intake_forms.payload` and only one was considered; and `name` means a
 * person under `personal` but a DRUG under `medications[]`. It produced
 * `{ "medications": [{},{}] }` for a patient with MTC, pancreatitis and
 * pregnancy all `yes` — Claude would have drafted "Eligible", with 1991
 * tests green. Priya asked for this exact payload, re-run, with every
 * hard block shown present.
 *
 * No DB, no network.
 */
import { inputsToPromptText } from '../../lib/ai/redact';
import { classifyPath } from '../../lib/ai/intake-classification';

let failed = 0;
function check(ok: boolean, label: string, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? `\n         ${detail}` : ''}`);
  if (!ok) failed++;
}

/** Priya's payload: every CLAUDE.md §6 hard block set to `yes`. */
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
  notes: 'Reviewed in clinic.'
};

/** portal.v1 — the identifier-bearing shape. */
const PORTAL_INTAKE = {
  personal: {
    full_name: 'Priya Nair', date_of_birth: '1988-04-12', sex: 'F',
    phone_e164: '+919845012345', email: 'priya.nair@example.com',
    address_line1: '14 Marine Drive', city: 'Kochi', state: 'Kerala',
    pincode: '682031', referred_by: 'Dr Anand Menon'
  },
  vitals: {
    weight_kg: 84.5, height_cm: 161, current_medications: 'Metformin 500mg BD',
    medical_conditions: ['PCOS'], allergies: 'Sulfa drugs'
  },
  consent: {
    agreed: true, consent_text: 'x'.repeat(20000),
    digital_signature: 'Priya Nair', consent_version: '1.0'
  }
};

function prompt(intake: Record<string, unknown>): string {
  return inputsToPromptText({ patient: { ageYears: 41, sex: 'F' }, intake });
}

function main() {
  console.log('='.repeat(78));
  console.log('AI intake redaction — identifiers out, contraindications IN');
  console.log('='.repeat(78));

  // ---------- Part 1: glp1.v1 clinical completeness ----------
  const g = prompt(GLP1_INTAKE);
  console.log('\n  glp1.v1 — what Claude now receives:\n');
  console.log(g.split('INTAKE (clinical fields only):')[1]?.trimEnd());

  const HARD_BLOCKS = [
    'mtc', 'familyMtc', 'men2', 'pancreatitis', 'severeGastroparesis',
    'activeGallbladderDisease', 'type1Diabetes', 'pregnant', 'lactating',
    'planningWithin2Months'
  ];
  const missing = HARD_BLOCKS.filter((b) => !g.includes(b));
  console.log('');
  check(
    missing.length === 0,
    `all ${HARD_BLOCKS.length} CLAUDE.md §6 hard blocks reach the model`,
    missing.length ? `MISSING: ${missing.join(', ')}` : `${HARD_BLOCKS.length}/${HARD_BLOCKS.length} present`
  );
  check(
    g.includes('Warfarin') && g.includes('Insulin glargine'),
    'DRUG names survive — `medications[].name` is a drug, `personal.full_name` is a person'
  );
  check(!/"medications":\s*\[\s*\{\s*\}/.test(g), 'no content-free `medications: [{},{}]` (the old regression)');
  check(
    g.includes('severe vomiting, hospitalised'),
    'prior GLP-1 intolerance survives — it drives drug and dose selection and has no other backstop'
  );
  check(g.includes('weight_loss'), 'the NESTED goal object survives (flat-key allowlist flattened it away)');

  // ---------- Part 2: portal.v1 identifiers ----------
  const p = prompt(PORTAL_INTAKE);
  console.log('\n  portal.v1 — what Claude now receives:\n');
  console.log(p.split('INTAKE (clinical fields only):')[1]?.trimEnd());
  console.log('');
  for (const [label, needle] of [
    ['patient name (personal.full_name)', 'Priya Nair'],
    ['third party (personal.referred_by)', 'Dr Anand Menon'],
    ['date of birth', '1988-04-12'],
    ['phone', '+919845012345'],
    ['email', 'priya.nair@example.com'],
    ['address', '14 Marine Drive'],
    ['city', 'Kochi']
  ] as const) {
    check(!p.includes(needle), `withheld: ${label}`);
  }
  check(!p.includes('x'.repeat(100)), 'consent_text dropped — up to 20,000 chars off every call');
  check(
    p.includes('Metformin 500mg BD') && p.includes('PCOS'),
    'portal clinical content still intact'
  );

  // ---------- Part 3: the distinction that made this possible ----------
  console.log('\n  The path distinction a bare-key rule could not express:\n');
  for (const path of [
    'medications[].name', 'personal.full_name', 'history.mtc',
    'consent.digital_signature', 'personal.referred_by', 'history.someNewFlag'
  ]) {
    console.log(`    ${path.padEnd(30)} -> ${classifyPath(path)}`);
  }
  check(classifyPath('medications[].name') === 'allow', '`medications[].name` allowed (a drug)');
  check(classifyPath('personal.full_name') === 'omit', '`personal.full_name` omitted (a person)');
  check(
    classifyPath('history.someNewFlag') === 'withhold',
    'an unclassified path fails CLOSED — and is marked, so the model cannot assume absent'
  );

  console.log('');
  console.log('='.repeat(78));
  console.log(failed === 0 ? 'ALL PASS' : `${failed} CHECK(S) FAILED`);
  console.log('='.repeat(78));
  process.exit(failed === 0 ? 0 : 1);
}

main();
