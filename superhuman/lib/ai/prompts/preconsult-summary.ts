/**
 * Pre-consult summary prompt — Phase 15.I.
 *
 * Strictly 6-line output. Parsed deterministically. The previous
 * Phase 7 triage prompt produces JSON; this one is fixed-format text
 * that renders directly into the sidebar AI card.
 *
 * Indian reference ranges baked in (HOMA-IR corrected per 2026-05-10
 * clinical update: optimal <1.5, borderline 1.5–2.0, IR >2.0).
 *
 * Drugs and Magic Remedies Act 1954 compliance: never "obesity",
 * never "weight loss treatment". Use "metabolic health", "body
 * composition optimization", "GLP-1 metabolic therapy".
 */

export const PRECONSULT_SUMMARY_SYSTEM_PROMPT = `You are a senior internal medicine physician reviewing pre-consult data for a colleague at a metabolic health and longevity practice in India.

Generate a structured clinical summary using INDIAN reference ranges throughout:
- BMI (ICMR 2022): overweight ≥23, obese ≥25
- Waist circumference: male ≥90 cm, female ≥80 cm = abdominal obesity
- HbA1c: normal <5.7%, pre-diabetes 5.7–6.4%, T2DM ≥6.5%
- HOMA-IR: optimal <1.5, borderline 1.5–2.0, insulin resistant >2.0
- Vitamin D: deficient <20 ng/mL, insufficient 20–30, sufficient >30
- TSH: normal 0.35–4.5 mIU/L
- LDL: optimal <100, borderline 130–159, high ≥160 mg/dL
- ApoB: optimal <90, borderline 90–110, high ≥110 mg/dL
- eGFR <30 ml/min/1.73m² is a HARD GLP-1 contraindication
- BMI <23 is a HARD GLP-1 contraindication (Indian threshold)

Drugs and Magic Remedies Act 1954 compliance — NEVER use these terms:
"obesity treatment", "weight loss drug", "anti-obesity medication".
Instead use: "metabolic health", "body composition optimization",
"GLP-1 metabolic therapy", "longevity program".

Recommend ONLY DCGI-approved GLP-1 brand names: Mounjaro (tirzepatide),
Obeda / Sematrinity (semaglutide injectable), Rybelsus (semaglutide oral),
Victoza (liraglutide). Never compounded.

Output EXACTLY these 6 lines, in this order, no more, no less, no markdown,
no preamble, no closing remarks:

DIAGNOSIS: [comma-separated specific clinical diagnoses]
ELIGIBILITY: [QUALIFIED|NOT QUALIFIED|CONDITIONAL] — [one-sentence reason]
MEDICATION: [recommended GLP-1 with brand name and specific clinical reason]
FLAGS: [comma-separated abnormal values, format "label value unit ↑/↓"]
MISSING: [comma-separated missing labs or data gaps]
SUGGESTIONS: [comma-separated specific clinical actions for the consult]

If a section has nothing to say, write "—" for that line.`;

export interface PreconsultSummary {
  diagnosis: string;
  eligibility: string;
  medication: string;
  flags: string;
  missing: string;
  suggestions: string;
  /** Raw 6-line text exactly as Claude produced (post-sanitisation). */
  raw: string;
}

const FIELD_ORDER: Array<{ key: keyof Omit<PreconsultSummary, 'raw'>; label: string }> = [
  { key: 'diagnosis',   label: 'DIAGNOSIS' },
  { key: 'eligibility', label: 'ELIGIBILITY' },
  { key: 'medication',  label: 'MEDICATION' },
  { key: 'flags',       label: 'FLAGS' },
  { key: 'missing',     label: 'MISSING' },
  { key: 'suggestions', label: 'SUGGESTIONS' }
];

/**
 * Parse Claude's 6-line response. Returns null if the format doesn't
 * match (caller treats as malformed and rejects). Tolerant of extra
 * whitespace + leading "**bold**" markdown that some models slip in.
 */
export function parsePreconsultSummary(text: string): PreconsultSummary | null {
  const cleaned = text.replace(/\*\*/g, '').trim();
  const out: Partial<PreconsultSummary> = { raw: cleaned };
  for (const { key, label } of FIELD_ORDER) {
    // (^|\n) anchor lets us catch the label at line-starts only.
    const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]+)`, 'i');
    const m = cleaned.match(re);
    if (!m) return null;
    out[key] = m[1]!.trim();
  }
  return out as PreconsultSummary;
}

/**
 * Stitch a follow-up addendum onto the parsed summary. Pulls from the
 * most recent prior consult; values come from the database, not Claude.
 */
export interface FollowUpAddendum {
  previousMedicationLabel: string | null;
  previousSupplementsLabel: string | null;
  previousExerciseLabel: string | null;
  /** Lab deltas keyed by analyte label (e.g., "HbA1c"). */
  labDeltas: Array<{ label: string; prev: number | null; curr: number | null; direction: 'lower' | 'higher' }>;
}

export function formatFollowUpAddendum(a: FollowUpAddendum): string[] {
  const lines: string[] = [];
  if (a.previousMedicationLabel) lines.push(`PREV MEDICATION: ${a.previousMedicationLabel}`);
  if (a.previousSupplementsLabel) lines.push(`PREV SUPPLEMENTS: ${a.previousSupplementsLabel}`);
  if (a.previousExerciseLabel) lines.push(`PREV EXERCISE: ${a.previousExerciseLabel}`);
  if (a.labDeltas.length) {
    const parts: string[] = [];
    for (const d of a.labDeltas) {
      if (d.curr == null && d.prev == null) continue;
      const cur = d.curr ?? '—';
      const pr  = d.prev ?? '—';
      const arrow =
        d.curr != null && d.prev != null
          ? d.direction === 'lower'
            ? d.curr < d.prev ? '↓ better' : d.curr > d.prev ? '↑ worse' : '='
            : d.curr > d.prev ? '↑ better' : d.curr < d.prev ? '↓ worse' : '='
          : '';
      parts.push(`${d.label} ${pr}→${cur} ${arrow}`.trim());
    }
    if (parts.length) lines.push(`DELTAS: ${parts.join(', ')}`);
  }
  return lines;
}
