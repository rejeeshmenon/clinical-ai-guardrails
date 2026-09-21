import { describe, it, expect } from 'vitest';
import {
  glp1IntakeSchema,
  intakeToContraindicationInput,
  GLP1_INTAKE_VERSION
} from '../../lib/clinical/intake-glp1-v1';
import { evaluateGlp1Contraindications } from '../../lib/clinical/contraindications';

describe('glp1IntakeSchema', () => {
  it('accepts a minimal intake', () => {
    const r = glp1IntakeSchema.safeParse({
      smoker: 'no',
      history: {
        mtc: 'no', familyMtc: 'no', men2: 'no', pancreatitis: 'no',
        severeGastroparesis: 'no', activeGallbladderDisease: 'no',
        type1Diabetes: 'no', type2Diabetes: 'yes', htn: 'no',
        dyslipidemia: 'no', cardiacHistory: 'no', thyroidDisease: 'no',
        polycysticOvarySyndrome: 'no'
      },
      pregnancy: { pregnant: 'no', lactating: 'no', planningWithin2Months: 'no' },
      prevGlp1: { used: 'no' },
      goal: { primary: 'weight_loss' }
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown yes/no values', () => {
    const r = glp1IntakeSchema.safeParse({
      smoker: 'sometimes',
      history: {
        mtc: 'no', familyMtc: 'no', men2: 'no', pancreatitis: 'no',
        severeGastroparesis: 'no', activeGallbladderDisease: 'no',
        type1Diabetes: 'no', type2Diabetes: 'no', htn: 'no',
        dyslipidemia: 'no', cardiacHistory: 'no', thyroidDisease: 'no',
        polycysticOvarySyndrome: 'no'
      },
      pregnancy: { pregnant: 'no', lactating: 'no', planningWithin2Months: 'no' },
      prevGlp1: { used: 'no' },
      goal: { primary: 'weight_loss' }
    });
    expect(r.success).toBe(false);
  });

  it('schema version constant matches', () => {
    expect(GLP1_INTAKE_VERSION).toBe('glp1.v1');
  });
});

describe('intakeToContraindicationInput', () => {
  const baseIntake = {
    smoker: 'no' as const,
    history: {
      mtc: 'yes' as const, familyMtc: 'no' as const, men2: 'no' as const,
      pancreatitis: 'no' as const, severeGastroparesis: 'no' as const,
      activeGallbladderDisease: 'no' as const, type1Diabetes: 'no' as const,
      type2Diabetes: 'no' as const, htn: 'no' as const,
      dyslipidemia: 'no' as const, cardiacHistory: 'no' as const,
      thyroidDisease: 'no' as const, polycysticOvarySyndrome: 'no' as const
    },
    pregnancy: {
      pregnant: 'no' as const,
      lactating: 'no' as const,
      planningWithin2Months: 'no' as const
    },
    prevGlp1: { used: 'no' as const },
    goal: { primary: 'weight_loss' as const },
    medications: [],
    allergies: []
  };

  it('translates yes → boolean true for contraindication eval', () => {
    const input = intakeToContraindicationInput(baseIntake, { bmi: 28, egfr: 90 });
    expect(input.history?.mtc).toBe(true);
    expect(input.history?.familyMtc).toBe(false);
  });

  it('flag pipeline detects MTC contraindication from intake', () => {
    const input = intakeToContraindicationInput(baseIntake, { bmi: 28, egfr: 90 });
    const flags = evaluateGlp1Contraindications(input);
    expect(flags.map((f) => f.code)).toContain('mtc_history');
  });

  it('treats "unknown" as false (clinically correct — no positive answer = no flag)', () => {
    const intake = {
      ...baseIntake,
      history: { ...baseIntake.history, mtc: 'unknown' as const }
    };
    const input = intakeToContraindicationInput(intake, { bmi: 28, egfr: 90 });
    expect(input.history?.mtc).toBe(false);
  });
});
