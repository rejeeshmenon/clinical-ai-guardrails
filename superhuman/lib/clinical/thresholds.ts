/**
 * Clinical thresholds — Indian standards (Asian Indian / ICMR-INDIAB).
 *
 * Stone rule #7: NEVER use WHO Caucasian thresholds (25/30) as primary.
 *
 * Sources:
 *   - Misra A, et al. "Consensus statement for diagnosis of obesity,
 *     abdominal obesity and the metabolic syndrome for Asian Indians."
 *     J Assoc Physicians India 2009;57:163–170.
 *   - ICMR-INDIAB national prevalence survey
 *
 * These values are used in:
 *   - lib/clinical/validators.ts  (Zod schemas, range checks)
 *   - drizzle/migrations/0001_init.sql (DB CHECK constraints)
 *   - app/(clinician)/patients/[id]/vitals/page.tsx (UI badges)
 */

// =====================================================================
// BMI — Asian Indian thresholds
// =====================================================================
export const BMI_INDIAN = Object.freeze({
  UNDERWEIGHT_MAX: 18.4,
  NORMAL_MAX:      22.9,
  OVERWEIGHT_MAX:  24.9,
  // ≥25.0 = obese (Asian Indian)
  OBESE_MIN:       25.0,
  // GLP-1 contraindication: BMI <23 (per Indian threshold)
  GLP1_MIN_BMI:    23.0
} as const);

export type BmiCategory = 'underweight' | 'normal' | 'overweight' | 'obese';

export function bmiCategory(bmi: number): BmiCategory {
  // Asian Indian thresholds (Misra et al.):
  //   <18.5 underweight | 18.5–22.9 normal | 23.0–24.9 overweight | ≥25.0 obese
  if (bmi < 18.5) return 'underweight';
  if (bmi < 23.0) return 'normal';
  if (bmi < 25.0) return 'overweight';
  return 'obese';
}

/**
 * Compute BMI from height (cm) and weight (kg). Returns null if either
 * input is missing or non-positive. One decimal place to match the
 * vitals.bmi generated column rounding.
 */
export function computeBmi(heightCm: number | null | undefined, weightKg: number | null | undefined): number | null {
  if (heightCm == null || weightKg == null) return null;
  if (heightCm <= 0 || weightKg <= 0) return null;
  const meters = heightCm / 100;
  return Math.round((weightKg / (meters * meters)) * 10) / 10;
}

/**
 * Convenience: combine computeBmi + bmiCategory. Returns null if BMI
 * cannot be computed (missing height or weight).
 */
export function bmiCategoryFromVitals(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined
): { bmi: number; category: BmiCategory } | null {
  const bmi = computeBmi(heightCm, weightKg);
  if (bmi == null) return null;
  return { bmi, category: bmiCategory(bmi) };
}

// =====================================================================
// Waist circumference — abdominal obesity (Asian Indian)
// =====================================================================
export const WAIST_INDIAN = Object.freeze({
  MALE_OBESE_MIN:   90, // cm
  FEMALE_OBESE_MIN: 80  // cm
} as const);

// =====================================================================
// HbA1c
// =====================================================================
export const HBA1C = Object.freeze({
  NORMAL_MAX:       5.6,   // %
  PREDIABETES_MIN:  5.7,
  PREDIABETES_MAX:  6.4,
  DIABETES_MIN:     6.5,
  CRITICAL_MIN:     14.0,  // critical value — provider notification required
  PHYSIOLOGIC_MIN:  3.0,
  PHYSIOLOGIC_MAX:  20.0
} as const);

// =====================================================================
// eGFR (ml/min/1.73m²)
// =====================================================================
export const EGFR = Object.freeze({
  NORMAL_MIN:        90,
  MILD_MIN:          60,
  MODERATE_MIN:      30,
  SEVERE_MIN:        15,
  // GLP-1 contraindication: eGFR <30
  GLP1_CONTRAINDICATION_MAX: 30,
  CRITICAL_MAX:      15,   // critical value — provider notification
  PHYSIOLOGIC_MIN:   0,
  PHYSIOLOGIC_MAX:   200
} as const);

// =====================================================================
// Fasting glucose (mg/dL)
// =====================================================================
export const FASTING_GLUCOSE = Object.freeze({
  NORMAL_MAX:       99,
  PREDIABETES_MIN:  100,
  PREDIABETES_MAX:  125,
  DIABETES_MIN:     126,
  CRITICAL_LOW:     40,
  CRITICAL_HIGH:    400,
  PHYSIOLOGIC_MIN:  20,
  PHYSIOLOGIC_MAX:  600
} as const);

// =====================================================================
// TSH (mIU/L)
// =====================================================================
export const TSH = Object.freeze({
  NORMAL_MIN:      0.5,
  NORMAL_MAX:      4.5,
  PHYSIOLOGIC_MIN: 0,
  PHYSIOLOGIC_MAX: 100
} as const);

// =====================================================================
// Fasting insulin (µIU/mL)
// =====================================================================
export const FASTING_INSULIN = Object.freeze({
  NORMAL_MIN: 3,
  NORMAL_MAX: 25
} as const);

// =====================================================================
// BP / vitals (boundary checks for input validation)
// =====================================================================
export const VITALS_LIMITS = Object.freeze({
  WEIGHT_KG_MIN: 20,
  WEIGHT_KG_MAX: 400,
  HEIGHT_CM_MIN: 50,
  HEIGHT_CM_MAX: 250,
  WAIST_CM_MIN:  30,
  WAIST_CM_MAX:  250,
  SYSTOLIC_MIN:  50,
  SYSTOLIC_MAX:  260,
  DIASTOLIC_MIN: 30,
  DIASTOLIC_MAX: 180,
  HR_MIN:        20,
  HR_MAX:        250
} as const);

// =====================================================================
// Critical value flagging — used by the consult workspace to surface
// values that warrant immediate physician attention.
// =====================================================================
export interface CriticalFlag {
  field: string;
  value: number;
  threshold: number;
  message: string;
}

export function flagCriticalLab(input: {
  hba1c?: number | null;
  egfr?: number | null;
  fastingGlucose?: number | null;
}): CriticalFlag[] {
  const flags: CriticalFlag[] = [];
  if (input.hba1c != null && input.hba1c > HBA1C.CRITICAL_MIN) {
    flags.push({
      field: 'hba1c',
      value: input.hba1c,
      threshold: HBA1C.CRITICAL_MIN,
      message: `HbA1c ${input.hba1c}% is critically high (>${HBA1C.CRITICAL_MIN}). Verify and notify physician.`
    });
  }
  if (input.egfr != null && input.egfr < EGFR.CRITICAL_MAX) {
    flags.push({
      field: 'egfr',
      value: input.egfr,
      threshold: EGFR.CRITICAL_MAX,
      message: `eGFR ${input.egfr} is critically low (<${EGFR.CRITICAL_MAX}). Possible kidney failure — urgent review.`
    });
  }
  if (input.fastingGlucose != null) {
    if (input.fastingGlucose > FASTING_GLUCOSE.CRITICAL_HIGH) {
      flags.push({
        field: 'fastingGlucose',
        value: input.fastingGlucose,
        threshold: FASTING_GLUCOSE.CRITICAL_HIGH,
        message: `Fasting glucose ${input.fastingGlucose} mg/dL is critically high (>${FASTING_GLUCOSE.CRITICAL_HIGH}). Likely DKA risk — urgent review.`
      });
    } else if (input.fastingGlucose < FASTING_GLUCOSE.CRITICAL_LOW) {
      flags.push({
        field: 'fastingGlucose',
        value: input.fastingGlucose,
        threshold: FASTING_GLUCOSE.CRITICAL_LOW,
        message: `Fasting glucose ${input.fastingGlucose} mg/dL is critically low (<${FASTING_GLUCOSE.CRITICAL_LOW}). Severe hypoglycemia — urgent review.`
      });
    }
  }
  return flags;
}
