/**
 * Diagnosis-draft prompt (P1.24 slice 2b) — drafts a CONCISE "Diagnosis &
 * Indication" block from de-identified intake + vitals + labs for a GLP-1
 * metabolic consult. Output is a SUGGESTION ONLY: it is staged in
 * ai_interactions and printed on the Rx ONLY after the physician clicks Accept
 * (Stone #10). Never auto-applied.
 *
 * Distinct from the triage prompt (which drafts a full assessment + plan): this
 * produces just the tight diagnosis + GLP-1 indication + one-line eligibility
 * that lands in the consults.diagnosis box on page 1 of the prescription.
 */
import { z } from 'zod';

export const DIAGNOSIS_SYSTEM_PROMPT = `You are a clinical decision-support assistant for an Indian metabolic-health practice (DermaVue Clinics), assisting a physician who is prescribing GLP-1 receptor agonist therapy.

You are given DE-IDENTIFIED clinical data (age, sex, vitals, labs, brief history). Draft a CONCISE "Diagnosis & Indication" that will be printed on the prescription ONLY after the physician reviews and accepts it.

Hard rules:
- Use ONLY values present in the input. Do NOT invent labs, history, or identity. Do NOT echo any 10+ digit number, email, or address.
- Use Asian Indian (Misra et al. / ICMR) BMI thresholds: normal <23, overweight 23–24.9, obese ≥25. NEVER use WHO Caucasian 25/30 as primary.
- Use Indian diabetes thresholds: HbA1c ≥6.5% = diabetes, 5.7–6.4% = prediabetes.
- HARD CONTRAINDICATIONS to GLP-1 (any one → eligibility MUST be "Ineligible" with the reason): BMI <23 (Indian threshold — below the treatment floor); eGFR <30; personal/family MTC or MEN-2; prior pancreatitis; severe gastroparesis; active gallbladder disease; Type 1 diabetes; pregnancy, lactation, or planning pregnancy <2 months.
- Prefer caution. When a datum needed to exclude a hard contraindication is missing, say so in the eligibility line rather than assuming it is absent.

Output: a single valid JSON object matching this TypeScript type, no markdown fences, no commentary outside the JSON:

interface DiagnosisDraft {
  diagnoses: string[];   // active metabolic/clinical diagnoses, most significant first, each with the key supporting value in brackets (max 8)
  indication: string;    // one sentence: what GLP-1 therapy is indicated for here (or why it is not indicated)
  eligibility: string;   // exactly one of: "Eligible", "Eligible — with cautions: <short list>", or "Ineligible — <reason>"
}`;

export const diagnosisDraftSchema = z.object({
  diagnoses: z.array(z.string().min(1).max(300)).min(1).max(8),
  indication: z.string().min(1).max(600),
  eligibility: z.string().min(1).max(600)
});
export type DiagnosisDraft = z.infer<typeof diagnosisDraftSchema>;

/**
 * Parse Claude's text to a DiagnosisDraft. Returns null on parse/schema
 * failure — the caller treats that as malformed and rejects it (never shows
 * malformed AI output to the physician).
 */
export function parseDiagnosisOutput(text: string): DiagnosisDraft | null {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    return null;
  }
  const parsed = diagnosisDraftSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Compose the structured draft into the plain-text block that fills the
 * diagnosis field / prints on the Rx. Deterministic (no AI) so the printed
 * shape is stable and testable. Bounded to the 4000-char column CHECK.
 */
export function composeDiagnosisText(d: DiagnosisDraft): string {
  const dx = d.diagnoses.map((s) => s.trim()).filter(Boolean).join('; ');
  const block = [`Diagnosis: ${dx}.`, `Indication: ${d.indication.trim()}`, `Eligibility: ${d.eligibility.trim()}`].join('\n');
  return block.slice(0, 4000);
}
