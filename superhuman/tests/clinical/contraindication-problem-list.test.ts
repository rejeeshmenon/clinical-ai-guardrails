/**
 * Stone Rule #58 — structured problem-list contraindication matcher.
 *
 * Pure unit tests for matchProblemListContraindications + the v0 mapping. No DB:
 * the matcher is pure, so these run in CI without TEST_DATABASE_URL. The DB
 * merge + discrepancy detection (assessGlp1EligibilityForPatient) is exercised
 * separately; this file proves the safety-critical matching logic — including
 * the false-positive guards the gap analysis called out.
 */
import { describe, it, expect } from 'vitest';
import {
  GLP1_CONTRAINDICATIONS,
  matchProblemListContraindications,
  type ProblemListEntry
} from '../../lib/clinical/contraindication-mapping';

const entry = (
  over: Partial<ProblemListEntry> & { condition: string }
): ProblemListEntry => ({ status: 'active', ...over });

const codes = (e: ProblemListEntry) =>
  matchProblemListContraindications([e], 'glp1_agonist').map((f) => f.ruleCode);

describe('v0 mapping integrity', () => {
  it('has the expected hard + soft condition-rule counts and no duplicate codes', () => {
    const hard = GLP1_CONTRAINDICATIONS.filter((r) => r.level === 'hard_block');
    const soft = GLP1_CONTRAINDICATIONS.filter(
      (r) => r.level === 'soft_block_requires_override'
    );
    expect(hard.length).toBe(9); // + BMI<23 & eGFR<30 computed in the value path = 10 hard total
    expect(soft.length).toBe(3); // + BMI 23-25/low-waist computed = 4 soft total
    const all = GLP1_CONTRAINDICATIONS.map((r) => r.code);
    expect(new Set(all).size).toBe(all.length);
  });

  it('every rule applies to glp1_agonist and has at least one pattern', () => {
    for (const r of GLP1_CONTRAINDICATIONS) {
      expect(r.appliesToDrugs).toContain('glp1_agonist');
      expect(r.icd10Patterns.length + (r.conditionNamePatterns?.length ?? 0)).toBeGreaterThan(0);
    }
  });
});

describe('hard blocks — match by ICD-10 and by name', () => {
  const cases: Array<{ rule: string; icd10: string; name: string }> = [
    { rule: 'mtc_personal_history', icd10: 'Z85.850', name: 'Medullary thyroid carcinoma' },
    { rule: 'men2', icd10: 'E31.22', name: 'MEN-2 syndrome' },
    { rule: 'pancreatitis_history', icd10: 'K85.9', name: 'Chronic pancreatitis' },
    { rule: 'type1_diabetes', icd10: 'E10.9', name: 'Type 1 diabetes mellitus' },
    { rule: 'pregnancy_current', icd10: 'Z33.1', name: 'Pregnant (first trimester)' },
    { rule: 'severe_gastroparesis', icd10: 'K31.84', name: 'Severe gastroparesis' },
    { rule: 'active_gallbladder_disease', icd10: 'K80.20', name: 'Cholelithiasis' },
    { rule: 'severe_ckd', icd10: 'N18.5', name: 'CKD stage 5' },
    { rule: 'active_eating_disorder', icd10: 'F50.00', name: 'Anorexia nervosa' }
  ];

  for (const c of cases) {
    it(`${c.rule} fires (hard) by ICD-10 ${c.icd10}`, () => {
      const found = matchProblemListContraindications(
        [entry({ condition: 'x', icd10Code: c.icd10 })],
        'glp1_agonist'
      );
      const f = found.find((x) => x.ruleCode === c.rule);
      expect(f, `expected ${c.rule} from ${c.icd10}`).toBeTruthy();
      expect(f!.level).toBe('hard_block');
      expect(f!.matchedField).toBe('icd10');
    });

    it(`${c.rule} fires (hard) by name "${c.name}" with no ICD-10`, () => {
      const found = codes(entry({ condition: c.name, icd10Code: null }));
      expect(found, `expected ${c.rule} from name`).toContain(c.rule);
    });
  }
});

describe('soft blocks — require override', () => {
  const cases: Array<{ rule: string; icd10: string; name: string }> = [
    {
      rule: 'family_mtc_first_degree',
      icd10: 'Z80.828',
      name: 'Family history of medullary thyroid cancer'
    },
    { rule: 'diabetic_retinopathy', icd10: 'H35.00', name: 'Diabetic retinopathy' },
    {
      rule: 'prior_bariatric_surgery',
      icd10: 'Z98.84',
      name: 'Prior bariatric surgery (sleeve gastrectomy)'
    }
  ];
  for (const c of cases) {
    it(`${c.rule} fires (soft) by ICD-10 and by name`, () => {
      const byIcd = matchProblemListContraindications(
        [entry({ condition: 'x', icd10Code: c.icd10 })],
        'glp1_agonist'
      ).find((x) => x.ruleCode === c.rule);
      expect(byIcd?.level).toBe('soft_block_requires_override');
      expect(codes(entry({ condition: c.name }))).toContain(c.rule);
    });
  }
});

describe('status clearing — history persists, active-state clears', () => {
  it('history-based block (pancreatitis) STILL fires when status=resolved', () => {
    expect(codes(entry({ condition: 'Chronic pancreatitis', status: 'resolved' }))).toContain(
      'pancreatitis_history'
    );
  });

  it('history-based block STILL fires when inRemission=true', () => {
    expect(
      codes(entry({ condition: 'Type 1 diabetes', status: 'active', inRemission: true }))
    ).toContain('type1_diabetes');
  });

  it('active-state block (gallbladder) does NOT fire when status=resolved', () => {
    expect(
      codes(entry({ condition: 'Cholelithiasis', status: 'resolved' }))
    ).not.toContain('active_gallbladder_disease');
  });

  it('active-state block does NOT fire when inRemission=true', () => {
    expect(
      codes(entry({ condition: 'Anorexia nervosa', status: 'active', inRemission: true }))
    ).not.toContain('active_eating_disorder');
  });

  it('entered_in_error NEVER fires (even for history-based)', () => {
    expect(
      codes(entry({ condition: 'Medullary thyroid carcinoma', status: 'entered_in_error' }))
    ).toHaveLength(0);
  });

  it("'monitoring' status still blocks an active-state condition", () => {
    expect(
      codes(entry({ condition: 'Cholelithiasis', status: 'monitoring' }))
    ).toContain('active_gallbladder_disease');
  });
});

describe('false-positive guards (the gap analysis edge cases)', () => {
  it('"pancreatic cancer" / C25 does NOT match the pancreatitis rule', () => {
    expect(codes(entry({ condition: 'Pancreatic cancer', icd10Code: 'C25.9' }))).not.toContain(
      'pancreatitis_history'
    );
    expect(codes(entry({ condition: 'Pancreatic adenocarcinoma' }))).not.toContain(
      'pancreatitis_history'
    );
  });

  it('papillary thyroid carcinoma (C73, non-medullary) does NOT match MTC', () => {
    expect(
      codes(entry({ condition: 'Papillary thyroid carcinoma', icd10Code: 'C73' }))
    ).not.toContain('mtc_personal_history');
  });

  it('type 2 diabetes does NOT match the type-1 rule', () => {
    expect(codes(entry({ condition: 'Type 2 diabetes mellitus', icd10Code: 'E11.9' }))).not.toContain(
      'type1_diabetes'
    );
  });

  it('an unrelated condition (hypothyroidism) matches nothing', () => {
    expect(codes(entry({ condition: 'Hypothyroidism', icd10Code: 'E03.9' }))).toHaveLength(0);
  });
});

describe('matching mechanics', () => {
  it('ICD-10 takes precedence over name for matchedField', () => {
    const [f] = matchProblemListContraindications(
      [entry({ condition: 'Chronic pancreatitis', icd10Code: 'K85.9' })],
      'glp1_agonist'
    ).filter((x) => x.ruleCode === 'pancreatitis_history');
    expect(f?.matchedField).toBe('icd10');
  });

  it('carries the medical-history row id for the audit trail', () => {
    const [f] = matchProblemListContraindications(
      [entry({ id: 'mh-123', condition: 'MEN-2', icd10Code: 'E31.22' })],
      'glp1_agonist'
    );
    expect(f?.medicalHistoryId).toBe('mh-123');
  });

  it('does NOT fire for a non-GLP1 drug class', () => {
    expect(
      matchProblemListContraindications(
        [entry({ condition: 'Chronic pancreatitis' })],
        'biguanide'
      )
    ).toHaveLength(0);
  });

  it('matches multiple conditions across entries', () => {
    const found = matchProblemListContraindications(
      [
        entry({ condition: 'Chronic pancreatitis' }),
        entry({ condition: 'Prior bariatric surgery' })
      ],
      'glp1_agonist'
    ).map((f) => f.ruleCode);
    expect(found).toContain('pancreatitis_history');
    expect(found).toContain('prior_bariatric_surgery');
  });
});
