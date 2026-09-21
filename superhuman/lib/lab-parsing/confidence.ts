/**
 * Deterministic, explainable confidence scoring for staged lab-parse
 * results (P1.8).
 *
 * ============================================================================
 * THIS NUMBER IS DISPLAY-ONLY SIGNAL FOR THE HUMAN VERIFIER. IT GATES
 * NOTHING. It does not auto-accept, auto-commit, or suppress anything.
 * Stone Rule #39's mandatory human Verify click and the out-of-range hard
 * block in lib/lab-parsing/commit.ts are UNTOUCHED and remain the only
 * safety gates on this data. All this module does is stop the review
 * queue from stamping the same 0.95 on a crisp PDF and a blurry phone
 * photo of a lab report shot at an angle under a tubelight.
 * ============================================================================
 *
 * No model call, no I/O, no randomness — a pure function of inputs the
 * caller already has, so it is trivially unit-testable and cannot itself
 * introduce a network dependency into the parse job's hot path.
 *
 * The scoring model:
 *   confidence = SOURCE_BASE[source]
 *              * LEGIBILITY_FACTOR[legibility]
 *              * (mapped ? 1 : EXTRA_FACTOR)
 *              * (plausible ? 1 : IMPLAUSIBLE_FACTOR)
 *   clamped to [CONFIDENCE_FLOOR, CONFIDENCE_CEILING], rounded to 2dp.
 *
 * PLAUSIBLE_BANDS is an OCR-SANITY GATE, NOT A CLINICAL RANGE CHECK. It is
 * deliberately generous — wide enough to admit a genuinely sick patient's
 * real value, narrow enough to catch "the OCR/VLM dropped a decimal point"
 * (e.g. HbA1c read as 45 instead of 4.5). Where Stone Rule #6 already
 * names a physiological band for a value, this file uses exactly that
 * band (cited inline); other keys get a similarly generous band chosen
 * for this purpose. A key with no defined band is always treated as
 * plausible — silence here is not a claim that any value is safe, only
 * that this module has no OCR-sanity opinion about it.
 */

export type ParseSource = 'pdf' | 'image';
export type Legibility = 'clear' | 'partial' | 'poor';

/** Baseline confidence by capture modality — a crisp PDF text layer vs. a photograph. */
export const SOURCE_BASE: Record<ParseSource, number> = {
  pdf: 0.95,
  image: 0.78
};

/** Multiplier for how legible the model judged (or we defaulted) the source to be. */
export const LEGIBILITY_FACTOR: Record<Legibility, number> = {
  clear: 1.0,
  partial: 0.85,
  poor: 0.6
};

/** Analytes with no lab_results column (stored in lab_results.raw, not a typed field). */
export const EXTRA_FACTOR = 0.95;

/** Applied when a value falls outside its OCR-sanity band. */
export const IMPLAUSIBLE_FACTOR = 0.5;

/** Never claim total distrust — a human is always reviewing this either way. */
export const CONFIDENCE_FLOOR = 0.05;
/** Never claim certainty — this is a machine extraction, always subject to Verify. */
export const CONFIDENCE_CEILING = 0.95;

/**
 * OCR-sanity bands, keyed by the canonical Claude extraction key (see
 * lib/lab-parsing/schema.ts's `values` object). [min, max] inclusive.
 * Where Stone Rule #6 names a physiological band, that exact band is used
 * UNCHANGED (cited below — these are binding and the lab_results CHECK
 * constraints enforce them anyway); the rest are chosen generously for the
 * same "catch a dropped decimal point" purpose, not as clinical thresholds.
 *
 * R6 fix (Priya CONCERN, 2026-08-10 round-1 review): the non-Stone-Rule-#6
 * bands below were widened to true physiologic maxima after Priya measured
 * that the OLD bands scored genuine, real-world CRITICAL values at the
 * same 0.33 as an OCR misread — e.g. lipase 3200 (acute pancreatitis, a
 * CLAUDE.md §6 GLP-1 hard block), TSH 210 (myxoedema), ALT 4800 (fulminant
 * hepatic failure). Once R1 renders the confidence chip, a "33%" badge on
 * a genuine pancreatitis lipase actively nudges the verifier to DISMISS
 * the one result that must contraindicate the drug — the opposite of what
 * this module exists to do.
 *
 * R11 fix (Priya BLOCKER, 2026-08-10 round-2 review): R6 over-corrected.
 * `ft4_ng_dl: [0,20]` swallowed its own ×10 decimal-shift range (reference
 * 0.8-1.8, so 8-18 — the exact shifted-decimal zone — read as "plausible");
 * `ft3_pg_ml: [0,50]` had the identical defect (reference 2.3-4.2, ×10 =
 * 23-42, fully in-band). Worse, several bands now exceeded what the
 * `lab_results` columns they feed can physically store — a value that
 * scores "plausible" here but trips the column's own CHECK constraint at
 * Verify time (lib/lab-parsing/commit.ts) reproduces exactly the bug this
 * module exists to prevent (a false-reassuring badge on an unreachable
 * value). This fix ceilings every MAPPED key (one with a real lab_results
 * column — see VALUE_MAPPING in lib/jobs/parse-lab-upload.ts) at the
 * LESSER of (a) a true physiologic maximum and (b) that column's own CHECK
 * constraint, both cited inline below. EXTRA keys (no lab_results column —
 * they only ever land in lab_results.raw, an unconstrained JSONB) are
 * capped on physiologic grounds alone.
 *
 * TWO DEVIATIONS FROM THE ROUND-2 REVIEW BRIEF, BOTH BY DESIGN, BOTH
 * FLAGGED TO THE FOUNDER (evidence in the commit / PR notes):
 *   - alt_u_l / ast_u_l: the brief specified [0,9999]. The REAL CHECK
 *     constraint (migration 0016, `lab_results_alt_chk` / `_ast_chk`) caps
 *     both at 5000, not 9999 — [0,9999] would exceed storage and
 *     reintroduce the exact "reachable through storage layer" bug the
 *     brief's own TSH 210 example was written to close. Capped to [1,5000]
 *     (floor 1 also matches the CHECK's own floor) instead.
 *   - triglycerides_mgdl: the brief specified [10,9999]. The REAL CHECK
 *     (migration 0016, `lab_results_triglycerides_chk`) caps triglycerides
 *     at 2000, not 9999. Capped to [10,2000] instead.
 *   ONE CONSEQUENCE, EXECUTED AND CONFIRMED (not assumed): Priya's own
 *   round-1 probe values AST=6200 and triglycerides=4200 now score as
 *   IMPLAUSIBLE rather than "honest" (0.95), because BOTH values exceed
 *   what `lab_results` can store regardless of what this module says — a
 *   genuine AST=6200 or TG=4200 report can never be committed via
 *   lib/lab-parsing/commit.ts under the CURRENT schema. Flagging a value
 *   the database will hard-reject is the more honest behaviour of the
 *   two available; "fixing" the arithmetic to match the brief's literal
 *   numbers would have shipped a UI that claims high confidence in a value
 *   Verify can never actually save. Widening the underlying CHECK
 *   constraints to accommodate genuine extreme values (chylomicronemia can
 *   report triglycerides >4000 mg/dL) is a legitimate follow-up but is a
 *   migration, and migrations are out of scope for this fix.
 *
 *   A THIRD, DIFFERENT-SHAPED FINDING (not a deviation — the round-2 brief's
 *   own literal instruction for this key, tsh_uiu_ml: [0,100], IS the real
 *   CHECK): Priya's round-1 probe value TSH=210 also now scores implausible.
 *   `lab_results_tsh_chk` has been 0-100 since migration 0001 — this
 *   codebase's FIRST migration — so TSH=210 has never been storable, at any
 *   point in this system's history, independent of R6 or this fix. The
 *   brief's separate claim that "her round-1 nine still score honestly"
 *   does not hold for this one; executed and confirmed in
 *   tests/lab-parsing/confidence.test.ts rather than silently patched by
 *   widening the band past the column's own limit.
 *
 * TWO CATEGORIES, EXPLICIT:
 *   - STONE RULE #6 BANDS (hba1c_percent, fasting_glucose_mgdl,
 *     egfr_ml_min): DO NOT WIDEN. These are the CLAUDE.md-mandated
 *     clinical ranges, unchanged by this fix.
 *   - EVERYTHING ELSE: ceilinged per-key at min(physiologic max, storage
 *     max) — see the inline citation on every mapped key below.
 */
export const PLAUSIBLE_BANDS: Readonly<Record<string, readonly [number, number]>> = {
  // Stone Rule #6: HbA1c 3.0-20.0% (critical >14). DO NOT WIDEN.
  hba1c_percent: [3.0, 20.0],
  // Stone Rule #6: fasting glucose 20-600 mg/dL (critical >400 / <40). DO NOT WIDEN.
  fasting_glucose_mgdl: [20, 600],
  // Stone Rule #6: eGFR 0-200 mL/min (critical <15). DO NOT WIDEN.
  egfr_ml_min: [0, 200],

  // --- MAPPED keys (real lab_results column — ceiling = min(physiologic, CHECK)) ---
  // lab_results_fasting_insulin_chk (migration 0016): 0-500.
  fasting_insulin_uiu_ml: [0, 500],
  // lab_results_triglycerides_chk (migration 0016): 10-2000. R11: the
  // round-2 brief asked for 9999 — see the header deviation note above.
  triglycerides_mgdl: [10, 2000],
  // lab_results_ldl_chk (migration 0016): 10-800.
  ldl_mgdl: [10, 800],
  // lab_results_hdl_chk (migration 0016): 5-300. 200 (extreme high-HDL,
  // migration 0016's own physiologic estimate) is already ≤ 300 — no
  // change needed, cited here for completeness of the storage audit.
  hdl_mgdl: [5, 200],
  // lab_results_total_chol_chk (migration 0016): 50-1500.
  total_cholesterol_mgdl: [50, 1500],
  // lab_results_vitamin_d_chk (migration 0025): 0-200. R11 revert — R6's
  // widen to 400 swallowed nearly the whole nmol/L scale (Priya's
  // unit-crop probe) and exceeded the CHECK.
  vitamin_d_ng_ml: [0, 200],
  // lab_results_tsh_chk (migration 0001): 0-100. R11 revert — R6's widen
  // to 500 exceeded the CHECK; a TSH=210 scored "plausible" here but was
  // hard-rejected by commit.ts (the bug this fix closes).
  tsh_uiu_ml: [0, 100],
  // lab_results_alt_chk (migration 0016): 1-5000. R11 CORRECTED — see the
  // header deviation note (brief asked for 9999, which exceeds storage).
  alt_u_l: [1, 5000],
  // lab_results_ast_chk (migration 0016): 1-5000. R11 CORRECTED — same
  // deviation as alt_u_l.
  ast_u_l: [1, 5000],

  // --- EXTRA keys (no lab_results column — physiologic ceiling only; the
  //     JSONB `raw` column they land in carries no CHECK constraint) ---
  // R11 revert — physiologic max ~7-8 ng/dL; R6's widen to 20 covered its
  // own ×10 decimal-shift zone (reference 0.8-1.8 → shifted 8-18, fully
  // inside [0,20]), giving zero detection power for that misread class.
  ft4_ng_dl: [0, 8],
  // R11 revert — physiologic max ~30 pg/mL; same defect as ft4 (reference
  // 2.3-4.2 → shifted 23-42, fully inside the old [0,50]).
  ft3_pg_ml: [0, 30],
  // R11 revert (Priya: scope creep into a safety table, never part of her
  // round-1 finding). lab_results_creatinine_chk (migration 0025) allows
  // up to 30; 20 is the tighter physiologic ceiling she asked for.
  creatinine_mgdl: [0.1, 20],
  // R11 revert (same scope-creep note). lab_results_uric_acid_chk
  // (migration 0025) allows up to 30; 25 is the tighter physiologic
  // ceiling she asked for.
  uric_acid_mgdl: [0.5, 25],
  hemoglobin_g_dl: [2, 25],
  wbc_thou_ul: [0.1, 500],
  platelets_thou_ul: [1, 2000],
  testosterone_ng_dl: [0, 3000],
  lh_miu_ml: [0, 200],
  fsh_miu_ml: [0, 200],
  prolactin_ng_ml: [0, 5000],
  amylase_u_l: [0, 20000],
  lipase_u_l: [0, 20000]
};

/**
 * When the model didn't report legibility (older pg-boss items predating
 * the P1.7b prompt change, or a schema-optional gap), default a PDF to
 * 'clear' — the pre-P1.7b assumption, unchanged — and default an image to
 * 'partial'. Never assume a photo was clear: the whole point of this
 * module is that photos are not PDFs.
 */
export function resolveLegibility(
  source: ParseSource,
  reported: Legibility | null | undefined
): Legibility {
  if (reported) return reported;
  return source === 'image' ? 'partial' : 'clear';
}

function clampRound(n: number): number {
  const clamped = Math.min(CONFIDENCE_CEILING, Math.max(CONFIDENCE_FLOOR, n));
  return Math.round(clamped * 100) / 100;
}

/**
 * Confidence for ONE extracted value.
 *
 * `key` is the canonical Claude extraction key (e.g. 'hba1c_percent') —
 * looked up in PLAUSIBLE_BANDS for the OCR-sanity check. A key with no
 * defined band is always treated as plausible.
 */
export function computeValueConfidence(a: {
  source: ParseSource;
  legibility: Legibility;
  key: string;
  value: number;
  mapped: boolean;
}): number {
  const band = PLAUSIBLE_BANDS[a.key];
  const plausible = !band || (a.value >= band[0] && a.value <= band[1]);
  const raw =
    SOURCE_BASE[a.source] *
    LEGIBILITY_FACTOR[a.legibility] *
    (a.mapped ? 1 : EXTRA_FACTOR) *
    (plausible ? 1 : IMPLAUSIBLE_FACTOR);
  return clampRound(raw);
}

/**
 * Overall confidence for a staged report = the MINIMUM of its per-value
 * confidences — a report is only as trustworthy as its least legible
 * value. `fallback` is used when there are no per-value confidences at
 * all (nothing was extracted).
 */
export function computeOverallConfidence(perValue: number[], fallback: number): number {
  if (perValue.length === 0) return fallback;
  return Math.min(...perValue);
}
