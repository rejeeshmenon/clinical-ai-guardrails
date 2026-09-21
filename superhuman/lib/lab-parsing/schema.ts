import { z } from 'zod';

/** Zod schema mirroring the JSON shape the Claude prompt asks for. */
export const labExtractionSchema = z.object({
  report_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  lab_name: z.string().max(200).nullable(),
  // PHI-minimisation (Anita): patient_name_on_report and raw_text_excerpt
  // were removed from the Claude prompt in Phase 22 PR-3 (Stone Rule #39
  // sub-rule: AI-staging tables MUST NOT contain literal source-document
  // text in any column returned to the API surface). Both fields are
  // kept optional + nullable here so the schema remains backward
  // compatible with any in-flight queue items from before the prompt
  // change; new responses won't include them. The parse job writes null.
  patient_name_on_report: z.string().max(200).nullable().optional(),
  // P1.7b: how legible the source was overall — only meaningful for photo
  // uploads (a scanned/printed PDF is always effectively 'clear'). Optional
  // + nullable for the same backward-compatibility reason as
  // patient_name_on_report above: in-flight pg-boss items predating this
  // prompt change won't return it. lib/lab-parsing/confidence.ts's
  // resolveLegibility() supplies a source-aware default when absent.
  legibility: z.enum(['clear', 'partial', 'poor']).nullable().optional(),
  values: z.object({
    hba1c_percent: z.number().nullable(),
    fasting_glucose_mgdl: z.number().nullable(),
    fasting_insulin_uiu_ml: z.number().nullable(),
    triglycerides_mgdl: z.number().nullable(),
    ldl_mgdl: z.number().nullable(),
    hdl_mgdl: z.number().nullable(),
    total_cholesterol_mgdl: z.number().nullable(),
    vitamin_d_ng_ml: z.number().nullable(),
    tsh_uiu_ml: z.number().nullable(),
    ft3_pg_ml: z.number().nullable(),
    ft4_ng_dl: z.number().nullable(),
    creatinine_mgdl: z.number().nullable(),
    egfr_ml_min: z.number().nullable(),
    alt_u_l: z.number().nullable(),
    ast_u_l: z.number().nullable(),
    uric_acid_mgdl: z.number().nullable(),
    hemoglobin_g_dl: z.number().nullable(),
    wbc_thou_ul: z.number().nullable(),
    platelets_thou_ul: z.number().nullable(),
    testosterone_ng_dl: z.number().nullable(),
    lh_miu_ml: z.number().nullable(),
    fsh_miu_ml: z.number().nullable(),
    prolactin_ng_ml: z.number().nullable(),
    amylase_u_l: z.number().nullable(),
    lipase_u_l: z.number().nullable()
  }),
  // P1.9 unit guard: the unit string the model actually READ for each value
  // it returned, keyed by the same field name (or null when it couldn't read
  // one). The parse job compares this to the canonical unit and refuses to
  // auto-commit a value whose reported unit differs (e.g. Vitamin D in
  // nmol/L vs the canonical ng/mL). Optional + nullable for backward
  // compatibility with in-flight pg-boss items that predate this field.
  value_units: z.record(z.string(), z.string().max(20).nullable()).optional(),
  reference_ranges_noted: z.boolean(),
  flags: z.array(z.string().max(200)).max(50),
  raw_text_excerpt: z.string().max(400).optional()
});

export type LabExtraction = z.infer<typeof labExtractionSchema>;
export type LabExtractedValues = LabExtraction['values'];
