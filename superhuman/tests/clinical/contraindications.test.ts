import { describe, it, expect } from 'vitest';
import {
  evaluateGlp1Contraindications,
  isGlp1Permitted
} from '../../lib/clinical/contraindications';

describe('evaluateGlp1Contraindications — GLP-1 hard blocks', () => {
  it('returns empty when no contraindications present', () => {
    const flags = evaluateGlp1Contraindications({
      history: {},
      pregnancy: {},
      latest: { bmi: 28.0, egfr: 90 }
    });
    expect(flags).toEqual([]);
    expect(isGlp1Permitted({ latest: { bmi: 28.0, egfr: 90 } })).toBe(true);
  });

  it('blocks on personal MTC history', () => {
    const flags = evaluateGlp1Contraindications({ history: { mtc: true } });
    expect(flags.map((f) => f.code)).toContain('mtc_history');
  });

  it('blocks on FAMILY MTC history (not just personal)', () => {
    const flags = evaluateGlp1Contraindications({ history: { familyMtc: true } });
    expect(flags.map((f) => f.code)).toContain('mtc_history');
  });

  it('blocks on MEN-2', () => {
    const flags = evaluateGlp1Contraindications({ history: { men2: true } });
    expect(flags.map((f) => f.code)).toContain('men2');
  });

  it('blocks on pregnancy', () => {
    const flags = evaluateGlp1Contraindications({ pregnancy: { pregnant: true } });
    expect(flags.map((f) => f.code)).toContain('pregnant_or_lactating');
  });

  it('blocks on lactation', () => {
    const flags = evaluateGlp1Contraindications({ pregnancy: { lactating: true } });
    expect(flags.map((f) => f.code)).toContain('pregnant_or_lactating');
  });

  it('blocks on planning pregnancy within 2 months', () => {
    const flags = evaluateGlp1Contraindications({
      pregnancy: { planningWithin2Months: true }
    });
    expect(flags.map((f) => f.code)).toContain('pregnant_or_lactating');
  });

  it('blocks on prior pancreatitis', () => {
    const flags = evaluateGlp1Contraindications({ history: { pancreatitis: true } });
    expect(flags.map((f) => f.code)).toContain('pancreatitis_history');
  });

  it('blocks on severe gastroparesis', () => {
    const flags = evaluateGlp1Contraindications({
      history: { severeGastroparesis: true }
    });
    expect(flags.map((f) => f.code)).toContain('severe_gastroparesis');
  });

  it('blocks on eGFR < 30 ml/min/1.73m²', () => {
    const flags = evaluateGlp1Contraindications({ latest: { egfr: 25 } });
    expect(flags.map((f) => f.code)).toContain('egfr_too_low');
  });

  it('does NOT block on eGFR exactly at 30 (boundary)', () => {
    const flags = evaluateGlp1Contraindications({ latest: { egfr: 30 } });
    expect(flags.map((f) => f.code)).not.toContain('egfr_too_low');
  });

  it('blocks on active gallbladder disease', () => {
    const flags = evaluateGlp1Contraindications({
      history: { activeGallbladderDisease: true }
    });
    expect(flags.map((f) => f.code)).toContain('active_gallbladder_disease');
  });

  it('blocks on Type 1 diabetes', () => {
    const flags = evaluateGlp1Contraindications({ history: { type1Diabetes: true } });
    expect(flags.map((f) => f.code)).toContain('type1_diabetes');
  });

  it('blocks when BMI < 23 (Indian threshold, NOT WHO 25)', () => {
    const flags = evaluateGlp1Contraindications({ latest: { bmi: 22.5 } });
    expect(flags.map((f) => f.code)).toContain('bmi_below_indian_threshold');
  });

  it('does NOT block at BMI = 23 (boundary — Indian overweight)', () => {
    const flags = evaluateGlp1Contraindications({ latest: { bmi: 23.0 } });
    expect(flags.map((f) => f.code)).not.toContain('bmi_below_indian_threshold');
  });

  it('returns multiple codes when multiple blocks apply', () => {
    const flags = evaluateGlp1Contraindications({
      history: { mtc: true, pancreatitis: true },
      pregnancy: { pregnant: true },
      latest: { bmi: 22, egfr: 25 }
    });
    expect(flags.length).toBeGreaterThanOrEqual(5);
    expect(isGlp1Permitted({ latest: { bmi: 22, egfr: 25 } })).toBe(false);
  });
});
