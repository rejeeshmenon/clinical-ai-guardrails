/**
 * Summary prompts — verbatim per spec §5.3.
 *
 * System prompt is a constant; user prompt templated from state. Both
 * are single source of truth — conversation-summary.service.ts imports
 * and composes them.
 *
 * Marker: isSelfAuthored
 */

export const SUMMARY_SYSTEM_PROMPT = `You are writing a 2-3 sentence factual summary of a patient's Chatwoot conversation with Priya (DermaVue's AI hub receptionist). Telecallers at DermaVue clinics will read this summary before calling the patient back.

STRICT RULES:
1. Output 2-3 sentences. Total length under 300 characters.
2. Factual only. Describe what the patient said and shared. Do NOT recommend treatments, prices, or next steps.
3. Do NOT use phrases like "I recommend", "you should", "try this", "take this", "should use". This is for clinic staff, not for the patient.
4. Do NOT invent details. If the patient did not state a concern, write "concern not specified yet".
5. Mention specifics when present: duration ("6 months"), body area ("scalp", "face"), prior treatments the patient mentioned ("tried minoxidil"), media shared ("sent photo of hairline").
6. Write in plain English for the telecaller. No emoji. No salutations. No closing lines.
7. Do NOT include phone number, full name, or address in the summary — those already live on the Twenty Person card.

Output the summary text only. No preamble, no labels, no quotation marks.`;

export interface SummaryUserPromptInput {
  channel: string;
  treatmentInterest: string | null | undefined;
  capturedCity: string | null | undefined;
  capturedName: string | null | undefined;
  /** Up to 10 recent patient-inbound entries, oldest first. Each capped at 500 chars already by state service. */
  patientMessages: string[];
}

export function buildSummaryUserPrompt(input: SummaryUserPromptInput): string {
  const channel = input.channel || 'unknown';
  const interest = input.treatmentInterest || 'not yet captured';
  const city = input.capturedCity || 'not yet captured';
  const name = input.capturedName || 'not yet captured';

  const messagesBlock = input.patientMessages
    .slice(0, 10)
    .map((m, i) => `${i + 1}. ${m}`)
    .join('\n');

  return `Channel: ${channel}
Captured interest: ${interest}
Captured city: ${city}
Captured name: ${name}

Patient messages (most recent 10, oldest first):
${messagesBlock || '(none)'}

Write the 2-3 sentence summary now.`;
}
