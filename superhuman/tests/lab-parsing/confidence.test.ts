/**
 * lib/lab-parsing/confidence.ts (P1.8).
 *
 * This number is DISPLAY-ONLY signal for the human verifier — these tests
 * pin the arithmetic, not any clinical claim. The PDF/clear/mapped case is
 * pinned to exactly 0.95 because that IS today's (pre-P1.8) hardcoded
 * confidence for a mapped value — a regression there would silently
 * change what every existing verified lab result looked like in the
 * review queue.
 */
import { describe, it, expect } from 'vitest';
import {
  computeValueConfidence,
  computeOverallConfidence,
  resolveLegibility,
  SOURCE_BASE,
  LEGIBILITY_FACTOR,
  EXTRA_FACTOR,
  IMPLAUSIBLE_FACTOR,
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
  PLAUSIBLE_BANDS,
  type ParseSource,
  type Legibility
} from '../../lib/lab-parsing/confidence';

describe('computeValueConfidence — table-driven', () => {
  const cases: Array<{
    label: string;
    source: ParseSource;
    legibility: Legibility;
    key: string;
    value: number;
    mapped: boolean;
    expected: number;
  }> = [
    // Pinned: this is today's exact pre-P1.8 hardcoded value for a
    // mapped, PDF-sourced analyte — no regression allowed.
    { label: 'pdf+clear+mapped (no regression)', source: 'pdf', legibility: 'clear', key: 'hba1c_percent', value: 5.4, mapped: true, expected: 0.95 },
    { label: 'image+partial+mapped', source: 'image', legibility: 'partial', key: 'fasting_glucose_mgdl', value: 95, mapped: true, expected: Math.round(SOURCE_BASE.image * LEGIBILITY_FACTOR.partial * 100) / 100 },
    { label: 'image+poor+extra', source: 'image', legibility: 'poor', key: 'vitamin_d_ng_ml', value: 40, mapped: false, expected: Math.round(SOURCE_BASE.image * LEGIBILITY_FACTOR.poor * EXTRA_FACTOR * 100) / 100 },
    { label: 'pdf+clear+extra', source: 'pdf', legibility: 'clear', key: 'creatinine_mgdl', value: 0.9, mapped: false, expected: Math.round(SOURCE_BASE.pdf * EXTRA_FACTOR * 100) / 100 }
  ];

  for (const c of cases) {
    it(c.label, () => {
      const got = computeValueConfidence({
        source: c.source,
        legibility: c.legibility,
        key: c.key,
        value: c.value,
        mapped: c.mapped
      });
      expect(got).toBeCloseTo(c.expected, 2);
    });
  }

  it('an implausible HbA1c (45, way outside the 3.0-20.0 OCR-sanity band) roughly halves confidence', () => {
    const plausible = computeValueConfidence({
      source: 'pdf',
      legibility: 'clear',
      key: 'hba1c_percent',
      value: 5.4,
      mapped: true
    });
    const implausible = computeValueConfidence({
      source: 'pdf',
      legibility: 'clear',
      key: 'hba1c_percent',
      value: 45,
      mapped: true
    });
    // Loose precision (1dp, not 2dp): the exact product 0.95 * 0.5 = 0.475
    // sits on a floating-point/rounding boundary (Math.round can land
    // either side of *.5 depending on binary representation) — the
    // clinically meaningful assertion is "roughly halved", not the exact
    // rounding rule, which is pinned separately below.
    expect(implausible).toBeCloseTo(plausible * IMPLAUSIBLE_FACTOR, 1);
    expect(implausible).toBeLessThan(plausible);
    // Pin the exact rounded output so a change in the rounding strategy
    // is visible here rather than only surfacing as a flaky boundary test.
    expect(implausible).toBe(0.48);
  });

  it('a key with no defined band is always treated as plausible, regardless of magnitude', () => {
    expect(PLAUSIBLE_BANDS['not_a_real_key']).toBeUndefined();
    const normal = computeValueConfidence({
      source: 'pdf',
      legibility: 'clear',
      key: 'not_a_real_key',
      value: 5,
      mapped: true
    });
    const huge = computeValueConfidence({
      source: 'pdf',
      legibility: 'clear',
      key: 'not_a_real_key',
      value: 999999,
      mapped: true
    });
    expect(huge).toBe(normal);
  });

  it('uses the exact Stone Rule #6 bands for hba1c/fasting glucose/eGFR', () => {
    expect(PLAUSIBLE_BANDS.hba1c_percent).toEqual([3.0, 20.0]);
    expect(PLAUSIBLE_BANDS.fasting_glucose_mgdl).toEqual([20, 600]);
    expect(PLAUSIBLE_BANDS.egfr_ml_min).toEqual([0, 200]);
  });

  it('never returns below CONFIDENCE_FLOOR even for the worst combination', () => {
    // image + poor + extra + implausible — the worst legitimate combination.
    const worst = computeValueConfidence({
      source: 'image',
      legibility: 'poor',
      key: 'hba1c_percent',
      value: 999,
      mapped: false
    });
    expect(worst).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
  });

  it('never returns above CONFIDENCE_CEILING even for the best combination', () => {
    const best = computeValueConfidence({
      source: 'pdf',
      legibility: 'clear',
      key: 'hba1c_percent',
      value: 5.4,
      mapped: true
    });
    expect(best).toBeLessThanOrEqual(CONFIDENCE_CEILING);
    expect(best).toBe(0.95); // exactly the ceiling, not above it
  });
});

describe('R6 — true clinical criticals must not be scored as an OCR-sanity violation', () => {
  // Priya's exact probe values (2026-08-10 round-1 review): each is a
  // genuine, real-world clinical CRITICAL (acute pancreatitis, myxoedema,
  // fulminant hepatic failure, homozygous FH, etc.), not an OCR misread.
  // Under the pre-R6 bands every one of these scored the same 0.33 as a
  // genuine decimal-shift error — indistinguishable in the UI, and
  // actively nudging a verifier to dismiss the one result that must
  // contraindicate a GLP-1 prescription (CLAUDE.md §6).
  //
  // R11 (2026-08-10 round-2 review): AST=6200, triglycerides=4200 AND
  // TSH=210 are DELIBERATELY EXCLUDED from the "stays 0.95" table below.
  // All three exceed the REAL lab_results CHECK constraint their mapped
  // column enforces:
  //   - lab_results_ast_chk / _triglycerides_chk (migration 0016): 5000 / 2000.
  //     The round-2 brief asked for bands of [0,9999] / [10,9999] — that
  //     would have scored these "plausible" while still being unstorable,
  //     reproducing exactly the "reachable through storage layer" bug
  //     class this module exists to prevent. See confidence.ts's
  //     PLAUSIBLE_BANDS header for the full deviation note.
  //   - lab_results_tsh_chk (migration 0001, UNCHANGED since this
  //     system's very first migration): 0-100. TSH=210 has NEVER been
  //     storable in lab_results, at any point in this codebase's history
  //     — this is not a regression introduced by R6 or R11, it predates
  //     both. The round-2 brief's OWN instruction for this key —
  //     tsh_uiu_ml: [0,100] — is exactly the real CHECK, so implementing
  //     it precisely as asked (no deviation) still produces a TSH=210
  //     that scores implausible, contradicting the brief's separate claim
  //     that "her round-1 nine still score honestly". Executed and
  //     confirmed below; flagged rather than silently "fixed" by widening
  //     the band past what the column can hold.
  // All three are asserted as IMPLAUSIBLE below instead.
  const criticalCases: Array<{ key: string; value: number; label: string }> = [
    { key: 'lipase_u_l', value: 3200, label: 'lipase 3200 (acute pancreatitis, GLP-1 hard block)' },
    { key: 'amylase_u_l', value: 2400, label: 'amylase 2400' },
    { key: 'alt_u_l', value: 4800, label: 'ALT 4800 (fulminant hepatic failure)' },
    { key: 'wbc_thou_ul', value: 180, label: 'WBC 180' },
    { key: 'prolactin_ng_ml', value: 1800, label: 'prolactin 1800' },
    { key: 'ldl_mgdl', value: 620, label: 'LDL 620 (homozygous FH)' }
  ];

  for (const c of criticalCases) {
    it(`${c.label} is NOT penalised as implausible (pdf/clear/mapped stays 0.95)`, () => {
      const got = computeValueConfidence({
        source: 'pdf',
        legibility: 'clear',
        key: c.key,
        value: c.value,
        mapped: true
      });
      expect(got).toBe(0.95);
    });
  }

  it('AST=6200 now scores IMPLAUSIBLE — it exceeds lab_results_ast_chk (1-5000, migration 0016) and can never be committed regardless of band', () => {
    const got = computeValueConfidence({
      source: 'pdf',
      legibility: 'clear',
      key: 'ast_u_l',
      value: 6200,
      mapped: true
    });
    expect(got).toBeLessThan(0.95);
    expect(got).toBe(0.48); // 0.95 * IMPLAUSIBLE_FACTOR (0.5), rounded
  });

  it('triglycerides=4200 now scores IMPLAUSIBLE — it exceeds lab_results_triglycerides_chk (10-2000, migration 0016) and can never be committed regardless of band', () => {
    const got = computeValueConfidence({
      source: 'pdf',
      legibility: 'clear',
      key: 'triglycerides_mgdl',
      value: 4200,
      mapped: true
    });
    expect(got).toBeLessThan(0.95);
    expect(got).toBe(0.48);
  });

  it('TSH=210 now scores IMPLAUSIBLE — it exceeds lab_results_tsh_chk (0-100, migration 0001, unchanged since this system\'s first migration) and has never been storable', () => {
    const got = computeValueConfidence({
      source: 'pdf',
      legibility: 'clear',
      key: 'tsh_uiu_ml',
      value: 210,
      mapped: true
    });
    expect(got).toBeLessThan(0.95);
    expect(got).toBe(0.48);
  });

  it('Stone Rule #6 bands remain EXACTLY unchanged and still catch a genuine decimal-shift HbA1c=45', () => {
    expect(PLAUSIBLE_BANDS.hba1c_percent).toEqual([3.0, 20.0]);
    expect(PLAUSIBLE_BANDS.fasting_glucose_mgdl).toEqual([20, 600]);
    expect(PLAUSIBLE_BANDS.egfr_ml_min).toEqual([0, 200]);
    const implausibleHba1c = computeValueConfidence({
      source: 'pdf',
      legibility: 'clear',
      key: 'hba1c_percent',
      value: 45,
      mapped: true
    });
    expect(implausibleHba1c).toBeLessThan(0.95);
    expect(implausibleHba1c).toBe(0.48);
  });
});

describe('R11 — no PLAUSIBLE_BANDS ceiling may exceed what its column can store', () => {
  // Storage limits for every MAPPED PLAUSIBLE_BANDS key (i.e. one with a
  // real lab_results column per VALUE_MAPPING in lib/jobs/parse-lab-upload.ts),
  // hand-transcribed from the actual DDL so a future band edit that drifts
  // past storage capacity fails HERE instead of at a physician's Verify
  // click. Source of truth for each:
  //   - hba1c/fasting_glucose/egfr: drizzle/migrations/0001_init.sql
  //     (lab_results_hba1c_chk / _fasting_glucose_chk / — egfr has no
  //     migration-0001 CHECK by name but the same file's CHECK list; see
  //     Stone Rule #6 in CLAUDE.md, which these three mirror exactly).
  //   - tsh: drizzle/migrations/0001_init.sql, lab_results_tsh_chk (0-100).
  //   - fasting_insulin/triglycerides/total_chol/ldl/hdl/alt/ast:
  //     drizzle/migrations/0016_lab_results_physiologic_checks.sql.
  //   - vitamin_d/creatinine/uric_acid/hemoglobin:
  //     drizzle/migrations/0025_lab_results_analytes.sql.
  // EXTRA keys (ft3_pg_ml, ft4_ng_dl, wbc_thou_ul, platelets_thou_ul,
  // testosterone_ng_dl, lh_miu_ml, fsh_miu_ml, prolactin_ng_ml,
  // amylase_u_l, lipase_u_l) have NO lab_results column — Claude's
  // extraction for these lands only in lab_results.raw (JSONB, no CHECK)
  // — so they are intentionally NOT in this table; there is no storage
  // ceiling to violate.
  const MAPPED_STORAGE_LIMITS: Readonly<Record<string, { min: number; max: number; source: string }>> = {
    hba1c_percent: { min: 3.0, max: 20.0, source: '0001_init.sql lab_results_hba1c_chk' },
    fasting_glucose_mgdl: { min: 20, max: 600, source: '0001_init.sql lab_results_fasting_glucose_chk' },
    egfr_ml_min: { min: 0, max: 200, source: '0001_init.sql lab_results_egfr_chk' },
    tsh_uiu_ml: { min: 0, max: 100, source: '0001_init.sql lab_results_tsh_chk' },
    fasting_insulin_uiu_ml: { min: 0, max: 500, source: '0016 lab_results_fasting_insulin_chk' },
    triglycerides_mgdl: { min: 10, max: 2000, source: '0016 lab_results_triglycerides_chk' },
    total_cholesterol_mgdl: { min: 50, max: 1500, source: '0016 lab_results_total_chol_chk' },
    ldl_mgdl: { min: 10, max: 800, source: '0016 lab_results_ldl_chk' },
    hdl_mgdl: { min: 5, max: 300, source: '0016 lab_results_hdl_chk' },
    alt_u_l: { min: 1, max: 5000, source: '0016 lab_results_alt_chk' },
    ast_u_l: { min: 1, max: 5000, source: '0016 lab_results_ast_chk' },
    vitamin_d_ng_ml: { min: 0, max: 200, source: '0025 lab_results_vitamin_d_chk' },
    creatinine_mgdl: { min: 0, max: 30, source: '0025 lab_results_creatinine_chk' },
    uric_acid_mgdl: { min: 0, max: 30, source: '0025 lab_results_uric_acid_chk' },
    hemoglobin_g_dl: { min: 0, max: 30, source: '0025 lab_results_hemoglobin_chk' }
  };

  for (const [key, limit] of Object.entries(MAPPED_STORAGE_LIMITS)) {
    it(`${key}: PLAUSIBLE_BANDS max (${PLAUSIBLE_BANDS[key]?.[1]}) does not exceed ${limit.source} (max ${limit.max})`, () => {
      const band = PLAUSIBLE_BANDS[key];
      expect(band).toBeDefined();
      expect(band![1]).toBeLessThanOrEqual(limit.max);
      // Floor sanity too — a band floor BELOW the CHECK's floor would
      // mark a value "plausible" that the DB will also reject on the low
      // end (e.g. alt=0 fails `alt BETWEEN 1 AND 5000`).
      expect(band![0]).toBeGreaterThanOrEqual(limit.min);
    });
  }

  it('every MAPPED VALUE_MAPPING key from lib/jobs/parse-lab-upload.ts is covered by this storage-limit table', () => {
    // Pinned copy of VALUE_MAPPING's key list (mapped fields only) — a
    // literal import would need a Next-server-only chain; this list is
    // the contract this test enforces, not a derivation.
    const MAPPED_KEYS = [
      'hba1c_percent',
      'fasting_glucose_mgdl',
      'fasting_insulin_uiu_ml',
      'total_cholesterol_mgdl',
      'ldl_mgdl',
      'hdl_mgdl',
      'triglycerides_mgdl',
      'tsh_uiu_ml',
      'alt_u_l',
      'ast_u_l',
      'egfr_ml_min'
    ];
    for (const k of MAPPED_KEYS) {
      expect(Object.keys(MAPPED_STORAGE_LIMITS)).toContain(k);
    }
  });
});

describe('resolveLegibility', () => {
  it('defaults a PDF with no reported legibility to clear', () => {
    expect(resolveLegibility('pdf', null)).toBe('clear');
    expect(resolveLegibility('pdf', undefined)).toBe('clear');
  });

  it('defaults an image with no reported legibility to partial — never assumes clear', () => {
    expect(resolveLegibility('image', null)).toBe('partial');
    expect(resolveLegibility('image', undefined)).toBe('partial');
  });

  it('passes through a reported legibility for either source', () => {
    expect(resolveLegibility('pdf', 'poor')).toBe('poor');
    expect(resolveLegibility('image', 'clear')).toBe('clear');
  });
});

describe('computeOverallConfidence', () => {
  it('returns the minimum of the per-value confidences', () => {
    expect(computeOverallConfidence([0.95, 0.66, 0.44, 0.9], 0.5)).toBe(0.44);
  });

  it('returns the fallback when there are no per-value confidences', () => {
    expect(computeOverallConfidence([], 0.66)).toBe(0.66);
  });

  it('a single value returns itself', () => {
    expect(computeOverallConfidence([0.72], 0.5)).toBe(0.72);
  });
});
