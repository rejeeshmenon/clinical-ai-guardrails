/**
 * GLP-1 contraindication hard blocks.
 *
 * If ANY of these returns true, the consult workspace MUST disable the
 * "Generate Prescription" button with a clear explanation. This is the
 * regulatory + clinical safety floor; the physician's judgment beyond
 * that lives in the consult assessment/plan.
 *
 * Source list per CLAUDE.md § 6 and MEMORY.md.
 */
import { BMI_INDIAN, EGFR } from './thresholds';
import type { ContraindicationLevel } from './contraindication-mapping';

export type ContraindicationCode =
  | 'mtc_history'
  | 'men2'
  | 'pregnant_or_lactating'
  | 'pancreatitis_history'
  | 'severe_gastroparesis'
  | 'egfr_too_low'
  | 'active_gallbladder_disease'
  | 'type1_diabetes'
  | 'bmi_below_indian_threshold';

export interface Contraindication {
  code: ContraindicationCode;
  /** Human-readable explanation surfaced in the UI. */
  message: string;
}

export interface ContraindicationInput {
  /** From intake form */
  history?: {
    mtc?: boolean;
    familyMtc?: boolean;
    men2?: boolean;
    pancreatitis?: boolean;
    severeGastroparesis?: boolean;
    activeGallbladderDisease?: boolean;
    type1Diabetes?: boolean;
  };
  pregnancy?: {
    pregnant?: boolean;
    lactating?: boolean;
    planningWithin2Months?: boolean;
  };
  /** Latest clinical values */
  latest?: {
    bmi?: number | null;
    egfr?: number | null;
  };
}

export function evaluateGlp1Contraindications(
  input: ContraindicationInput
): Contraindication[] {
  const flags: Contraindication[] = [];
  const h = input.history ?? {};
  const p = input.pregnancy ?? {};
  const l = input.latest ?? {};

  if (h.mtc || h.familyMtc) {
    flags.push({
      code: 'mtc_history',
      message: 'Personal or family history of medullary thyroid carcinoma (MTC). GLP-1 receptor agonists are contraindicated.'
    });
  }
  if (h.men2) {
    flags.push({
      code: 'men2',
      message: 'Multiple Endocrine Neoplasia type 2 (MEN-2). GLP-1 receptor agonists are contraindicated.'
    });
  }
  if (p.pregnant || p.lactating || p.planningWithin2Months) {
    flags.push({
      code: 'pregnant_or_lactating',
      message: 'Pregnancy, lactation, or planning pregnancy within 2 months. GLP-1 receptor agonists are contraindicated.'
    });
  }
  if (h.pancreatitis) {
    flags.push({
      code: 'pancreatitis_history',
      message: 'Prior pancreatitis. GLP-1 receptor agonists are contraindicated.'
    });
  }
  if (h.severeGastroparesis) {
    flags.push({
      code: 'severe_gastroparesis',
      message: 'Severe gastroparesis. GLP-1 receptor agonists are contraindicated.'
    });
  }
  if (l.egfr != null && l.egfr < EGFR.GLP1_CONTRAINDICATION_MAX) {
    flags.push({
      code: 'egfr_too_low',
      message: `eGFR ${l.egfr} is below ${EGFR.GLP1_CONTRAINDICATION_MAX} ml/min/1.73m². GLP-1 receptor agonists are contraindicated.`
    });
  }
  if (h.activeGallbladderDisease) {
    flags.push({
      code: 'active_gallbladder_disease',
      message: 'Active gallbladder disease. GLP-1 receptor agonists are contraindicated until resolved.'
    });
  }
  if (h.type1Diabetes) {
    flags.push({
      code: 'type1_diabetes',
      message: 'Type 1 diabetes. GLP-1 receptor agonists are contraindicated.'
    });
  }
  if (l.bmi != null && l.bmi < BMI_INDIAN.GLP1_MIN_BMI) {
    flags.push({
      code: 'bmi_below_indian_threshold',
      message: `BMI ${l.bmi} is below the Indian threshold of ${BMI_INDIAN.GLP1_MIN_BMI}. Patient does not meet overweight criteria for GLP-1 therapy.`
    });
  }

  return flags;
}

export function isGlp1Permitted(input: ContraindicationInput): boolean {
  return evaluateGlp1Contraindications(input).length === 0;
}

// =====================================================================
// Stone Rule #58 — structured, multi-source contraindication findings.
//
// The legacy evaluateGlp1Contraindications() above returns only HARD blocks
// derived from the intake form + latest values. The richer model below adds
// the STRUCTURED PROBLEM LIST as a source and adds a SOFT-block level (which
// the prescribing route allows only with an explicit physician override +
// audit row). assessGlp1EligibilityForPatient() in glp1-eligibility.ts merges
// all sources into these findings.
// =====================================================================

export type ContraindicationSource = 'problem_list' | 'intake_form' | 'lab' | 'vitals';

export interface ContraindicationFinding {
  /** Rule code (problem-list) or legacy ContraindicationCode (intake/lab/vitals). */
  code: string;
  level: ContraindicationLevel;
  source: ContraindicationSource;
  /** Physician-facing prose. */
  message: string;
  /** Problem-list condition text, when source = 'problem_list'. */
  matchedCondition?: string;
  matchedField?: 'icd10' | 'condition_name' | 'intake' | 'lab' | 'vitals';
  /** patient_medical_history.id, when source = 'problem_list' (for the audit row). */
  medicalHistoryId?: string;
}

/** Attribute a legacy intake/lab/vitals contraindication code to its source. */
export function legacyContraindicationSource(
  code: ContraindicationCode
): ContraindicationSource {
  if (code === 'egfr_too_low') return 'lab';
  if (code === 'bmi_below_indian_threshold') return 'vitals';
  return 'intake_form';
}
