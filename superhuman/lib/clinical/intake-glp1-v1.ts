/**
 * GLP-1 intake form schema — version glp1.v1
 *
 * The schema_version is stored alongside the payload in `intake_forms`
 * so future schema changes (glp1.v2) can read old records without
 * data migration. Old records keep their original schema_version forever.
 *
 * Adapter for contraindication evaluation: see `intakeToContraindicationInput`.
 */
import { z } from 'zod';
import type { ContraindicationInput } from './contraindications';

export const GLP1_INTAKE_VERSION = 'glp1.v1';

const yesNo = z.union([z.literal('yes'), z.literal('no'), z.literal('unknown')]);

export const glp1IntakeSchema = z.object({
  // ---- Demographics & lifestyle ----
  occupation: z.string().min(1).max(120).optional(),
  livesWithSupport: yesNo.optional(),
  smoker: yesNo,
  alcoholUnitsPerWeek: z.number().min(0).max(200).optional(),
  exerciseDaysPerWeek: z.number().int().min(0).max(7).optional(),
  sleepHoursPerNight: z.number().min(0).max(16).optional(),

  // ---- Personal history (CRITICAL — drives contraindications) ----
  history: z.object({
    mtc: yesNo,
    familyMtc: yesNo,
    men2: yesNo,
    pancreatitis: yesNo,
    severeGastroparesis: yesNo,
    activeGallbladderDisease: yesNo,
    type1Diabetes: yesNo,
    type2Diabetes: yesNo,
    htn: yesNo,
    dyslipidemia: yesNo,
    cardiacHistory: yesNo,
    thyroidDisease: yesNo,
    polycysticOvarySyndrome: yesNo
  }),

  // ---- Pregnancy / lactation (female patients) ----
  pregnancy: z.object({
    pregnant: yesNo,
    lactating: yesNo,
    planningWithin2Months: yesNo,
    lastMenstrualPeriod: z.coerce.date().optional()
  }),

  // ---- Current medications ----
  medications: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        dose: z.string().max(80).optional(),
        frequency: z.string().max(80).optional()
      })
    )
    .max(50)
    .default([]),

  // ---- Drug allergies ----
  allergies: z.array(z.string().min(1).max(120)).max(50).default([]),

  // ---- GLP-1 specific ----
  prevGlp1: z.object({
    used: yesNo,
    drug: z.string().max(80).optional(),
    durationMonths: z.number().min(0).max(120).optional(),
    discontinuedReason: z.string().max(400).optional()
  }),

  // ---- Goals & expectations ----
  goal: z.object({
    primary: z.enum(['weight_loss', 'glycemic_control', 'metabolic_health', 'longevity']),
    targetWeightKg: z.number().min(20).max(300).optional(),
    timelineMonths: z.number().int().min(1).max(36).optional()
  }),

  // ---- Free-text notes (optional) ----
  notes: z.string().max(2000).optional()
});

export type Glp1Intake = z.infer<typeof glp1IntakeSchema>;

/**
 * Convert a Glp1Intake payload + latest BMI/eGFR into the input shape
 * `evaluateGlp1Contraindications` expects. Returns null if the intake
 * is missing critical fields (UI should refuse to finalize).
 */
export function intakeToContraindicationInput(
  intake: Glp1Intake,
  latest: { bmi?: number | null; egfr?: number | null } = {}
): ContraindicationInput {
  const isYes = (v: 'yes' | 'no' | 'unknown' | undefined) => v === 'yes';
  return {
    history: {
      mtc: isYes(intake.history.mtc),
      familyMtc: isYes(intake.history.familyMtc),
      men2: isYes(intake.history.men2),
      pancreatitis: isYes(intake.history.pancreatitis),
      severeGastroparesis: isYes(intake.history.severeGastroparesis),
      activeGallbladderDisease: isYes(intake.history.activeGallbladderDisease),
      type1Diabetes: isYes(intake.history.type1Diabetes)
    },
    pregnancy: {
      pregnant: isYes(intake.pregnancy.pregnant),
      lactating: isYes(intake.pregnancy.lactating),
      planningWithin2Months: isYes(intake.pregnancy.planningWithin2Months)
    },
    latest: {
      bmi: latest.bmi ?? null,
      egfr: latest.egfr ?? null
    }
  };
}
