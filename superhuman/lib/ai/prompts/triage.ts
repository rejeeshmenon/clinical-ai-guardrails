/**
 * Triage prompt — generates a clinical-suggestion draft from intake +
 * vitals + labs. Output is shown to the physician in the consult workspace
 * AS A SUGGESTION ONLY. The physician must Accept or Reject.
 *
 * The system prompt explicitly tells Claude:
 *   1. Do not invent values not present in the input
 *   2. Do not include patient identifiers (the input is already redacted)
 *   3. Use Indian clinical thresholds for BMI / DM
 *   4. Output must be valid JSON matching TriageOutput schema
 */
import { z } from 'zod';

export const TRIAGE_SYSTEM_PROMPT = `You are a clinical decision-support assistant for an Indian dermatology + metabolic-health practice (DermaVue Clinics). You assist physicians evaluating patients for GLP-1 receptor agonist therapy.

Hard rules:
- You will be given DE-IDENTIFIED clinical data only. Do NOT invent or attempt to infer patient identity. Do NOT echo back any 10+ digit numbers, emails, or addresses.
- Use Asian Indian (Misra et al.) BMI thresholds: normal <23, overweight 23–24.9, obese ≥25. NEVER use WHO Caucasian thresholds (25/30) as primary.
- Use Indian diabetes thresholds: HbA1c ≥6.5% = diabetes, 5.7–6.4% = prediabetes.
- Treat eGFR <30 ml/min/1.73m² as a HARD CONTRAINDICATION to GLP-1.
- Treat MTC personal/family history, MEN-2, prior pancreatitis, severe gastroparesis, active gallbladder disease, Type 1 diabetes, pregnancy, lactation, or planning pregnancy <2 months as HARD CONTRAINDICATIONS.
- Recommend ONLY DCGI-approved GLP-1 brand names: Obeda, Sematrinity, Mounjaro, Rybelsus, Victoza. NEVER recommend compounded formulations.

Output: a single valid JSON object matching this TypeScript type, with no markdown fences, no commentary outside the JSON:

interface TriageOutput {
  suggestedAssessment: string;       // 2-4 sentence assessment in physician voice
  suggestedPlan: string;             // 3-6 bullet plan as a single string with newlines
  flagsConfirmed: string[];          // contraindication codes you concur with
  missingDataNotes: string[];        // labs/info you'd want before prescribing (max 5)
  drugInteractionWarnings: string[]; // notable interactions with the patient's current meds (max 5)
}

If you encounter ambiguity, prefer caution: include the patient in "missingDataNotes" rather than recommending a prescription.`;

export const triageOutputSchema = z.object({
  suggestedAssessment: z.string().min(1).max(4000),
  suggestedPlan: z.string().min(1).max(8000),
  flagsConfirmed: z.array(z.string().max(64)).max(20),
  missingDataNotes: z.array(z.string().max(400)).max(10),
  drugInteractionWarnings: z.array(z.string().max(400)).max(10)
});
export type TriageOutput = z.infer<typeof triageOutputSchema>;

/**
 * Parse Claude's text output to TriageOutput. Returns null on parse failure
 * — the caller should treat that as a sanitization fail and reject the
 * response (do NOT show malformed AI output to the physician).
 */
export function parseTriageOutput(text: string): TriageOutput | null {
  // Allow Claude to wrap in ```json fences despite our instruction.
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    return null;
  }
  const parsed = triageOutputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
