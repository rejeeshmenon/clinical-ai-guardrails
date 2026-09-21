import { describe, it, expect } from 'vitest';
import {
  bmiCategory,
  flagCriticalLab,
  BMI_INDIAN,
  HBA1C,
  EGFR,
  FASTING_GLUCOSE
} from '../../lib/clinical/thresholds';

describe('bmiCategory — Asian Indian thresholds (Misra et al.)', () => {
  it('classifies underweight (<18.5)', () => {
    expect(bmiCategory(15.0)).toBe('underweight');
    expect(bmiCategory(18.4)).toBe('underweight');
    expect(bmiCategory(18.49)).toBe('underweight');
  });

  it('classifies normal (18.5–22.9)', () => {
    expect(bmiCategory(18.5)).toBe('normal');
    expect(bmiCategory(20.0)).toBe('normal');
    expect(bmiCategory(22.9)).toBe('normal');
  });

  it('classifies overweight (23.0–24.9) — Indian threshold, NOT WHO 25', () => {
    expect(bmiCategory(23.0)).toBe('overweight');
    expect(bmiCategory(24.0)).toBe('overweight');
    expect(bmiCategory(24.9)).toBe('overweight');
  });

  it('classifies obese (≥25.0) — Indian threshold, NOT WHO 30', () => {
    expect(bmiCategory(25.0)).toBe('obese');
    expect(bmiCategory(30.0)).toBe('obese');
    expect(bmiCategory(45.0)).toBe('obese');
  });

  it('uses 23.0 as the GLP-1 minimum BMI (Indian, not 25 WHO)', () => {
    expect(BMI_INDIAN.GLP1_MIN_BMI).toBe(23.0);
  });
});

describe('flagCriticalLab', () => {
  it('returns no flags for normal labs', () => {
    expect(flagCriticalLab({ hba1c: 6.0, egfr: 90, fastingGlucose: 95 })).toEqual([]);
  });

  it('flags HbA1c > 14% as critical', () => {
    const flags = flagCriticalLab({ hba1c: 14.5 });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.field).toBe('hba1c');
    expect(flags[0]?.value).toBe(14.5);
  });

  it('does NOT flag HbA1c at the boundary (14.0)', () => {
    expect(flagCriticalLab({ hba1c: 14.0 })).toEqual([]);
  });

  it('flags eGFR < 15 as critical', () => {
    const flags = flagCriticalLab({ egfr: 12 });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.field).toBe('egfr');
  });

  it('does NOT flag eGFR at the boundary (15.0)', () => {
    expect(flagCriticalLab({ egfr: 15 })).toEqual([]);
  });

  it('flags fasting glucose > 400 mg/dL as DKA-risk critical', () => {
    const flags = flagCriticalLab({ fastingGlucose: 450 });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.message).toContain('DKA');
  });

  it('flags fasting glucose < 40 mg/dL as severe hypoglycemia', () => {
    const flags = flagCriticalLab({ fastingGlucose: 35 });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.message).toContain('hypoglycemia');
  });

  it('returns multiple flags when multiple critical values present', () => {
    const flags = flagCriticalLab({ hba1c: 15, egfr: 10, fastingGlucose: 450 });
    expect(flags).toHaveLength(3);
  });

  it('uses Indian thresholds, not WHO Caucasian', () => {
    // Sanity: HbA1c diabetes threshold is 6.5%, not 7%
    expect(HBA1C.DIABETES_MIN).toBe(6.5);
    // eGFR severe-failure boundary is 15
    expect(EGFR.CRITICAL_MAX).toBe(15);
    // Fasting glucose diabetes threshold is 126 mg/dL
    expect(FASTING_GLUCOSE.DIABETES_MIN).toBe(126);
  });
});
