import { describe, expect, it } from 'vitest';
import { labExtractionSchema } from '../../lib/lab-parsing/schema';

const VALID = {
  report_date: '2026-05-01',
  lab_name: 'Redcliffe Labs',
  patient_name_on_report: 'Test Patient',
  values: {
    hba1c_percent: 6.4,
    fasting_glucose_mgdl: 98,
    fasting_insulin_uiu_ml: 12,
    triglycerides_mgdl: 145,
    ldl_mgdl: 120,
    hdl_mgdl: 42,
    total_cholesterol_mgdl: 195,
    vitamin_d_ng_ml: 22,
    tsh_uiu_ml: 2.1,
    ft3_pg_ml: null,
    ft4_ng_dl: null,
    creatinine_mgdl: 0.9,
    egfr_ml_min: 102,
    alt_u_l: 28,
    ast_u_l: 22,
    uric_acid_mgdl: 5.4,
    hemoglobin_g_dl: 13.5,
    wbc_thou_ul: 6.8,
    platelets_thou_ul: 240,
    testosterone_ng_dl: null,
    lh_miu_ml: null,
    fsh_miu_ml: null,
    prolactin_ng_ml: null,
    amylase_u_l: null,
    lipase_u_l: null
  },
  reference_ranges_noted: true,
  flags: ['HbA1c H'],
  raw_text_excerpt: 'COMPREHENSIVE METABOLIC PANEL — Redcliffe Labs ...'
};

describe('labExtractionSchema', () => {
  it('accepts a valid payload', () => {
    expect(() => labExtractionSchema.parse(VALID)).not.toThrow();
  });

  it('rejects malformed report_date', () => {
    expect(() =>
      labExtractionSchema.parse({ ...VALID, report_date: '01/05/2026' })
    ).toThrow();
  });

  it('rejects string numeric values (Stone Rule: numbers must be numbers)', () => {
    expect(() =>
      labExtractionSchema.parse({
        ...VALID,
        values: { ...VALID.values, hba1c_percent: '6.4' }
      })
    ).toThrow();
  });

  it('accepts all values null (lab report with no recognised values)', () => {
    const allNull = {
      ...VALID,
      values: Object.fromEntries(
        Object.keys(VALID.values).map((k) => [k, null])
      )
    };
    expect(() => labExtractionSchema.parse(allNull)).not.toThrow();
  });

  it('rejects flags array > 50 entries', () => {
    const tooMany = {
      ...VALID,
      flags: Array.from({ length: 51 }, (_, i) => `flag${i}`)
    };
    expect(() => labExtractionSchema.parse(tooMany)).toThrow();
  });

  it('caps raw_text_excerpt at 400 chars', () => {
    const tooLong = { ...VALID, raw_text_excerpt: 'x'.repeat(401) };
    expect(() => labExtractionSchema.parse(tooLong)).toThrow();
  });
});
