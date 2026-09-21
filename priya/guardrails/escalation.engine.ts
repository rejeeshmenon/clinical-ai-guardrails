/**
 * Escalation engine — deterministic pure function.
 *
 * Called AFTER Priya's LLM reply has posted (never instead of it).
 * The LLM handles conversational deflection per priya.prompt.ts;
 * this engine is the system-level handoff decision floor. Lexicon-based,
 * not model-based — we never rely on the LLM to decide whether to
 * escalate.
 *
 * Precedence (first-match-wins):
 *   1. SYMPTOM             — safety first
 *   2. IMAGE_RECEIVED      — also safety (state-based, not lexicon)
 *   3. EXPLICIT_HUMAN      — patient agency
 *   4. FRUSTRATION         — de-escalation
 *   5. INSURANCE_LEGAL     — specialist domain
 *   6. DRUG_QUERY          — compliance
 *   7. PRICING_NEGOTIATION — human judgment
 *   8. PHONE_ASK_EXHAUSTED — state-based (two-strike)
 *   9. TURN_COUNT_EXCEEDED — state-based
 *
 * Scan strategy: scan ALL language buckets in each lexicon (not just
 * state.language's bucket). Cost of missing a SYMPTOM in a mixed-language
 * message is higher than the few extra microseconds of regex work.
 *
 * PHI safety: matched message text is NEVER returned. Only the lexicon
 * name, pattern name (snake_case intent), and detected language. Logs
 * the same — never the regex source, never the patient's words.
 *
 * Marker: isSelfAuthored
 */

import { PriyaState } from '../state/state.interface';
import { SYMPTOM_LEXICON } from './lexicons/symptoms.lexicon';
import { FRUSTRATION_LEXICON } from './lexicons/frustration.lexicon';
import { DRUG_NAMES_LEXICON } from './lexicons/drug-names.lexicon';
import { HUMAN_REQUEST_LEXICON } from './lexicons/human-request.lexicon';
import { INSURANCE_LEGAL_LEXICON } from './lexicons/insurance-legal.lexicon';
import { PRICING_NEGOTIATION_LEXICON } from './lexicons/pricing-negotiation.lexicon';
import {
  LanguageLexicon,
  LexiconEntry,
  LexiconLanguage,
} from './lexicons/types';

export type HandoffReason =
  | 'SYMPTOM'
  | 'IMAGE_RECEIVED'
  | 'EXPLICIT_HUMAN'
  | 'FRUSTRATION'
  | 'INSURANCE_LEGAL'
  | 'DRUG_QUERY'
  | 'PRICING_NEGOTIATION'
  | 'PHONE_ASK_EXHAUSTED'
  | 'TURN_COUNT_EXCEEDED'
  // Priya phone-capture short-circuit (2026-07-13). This is a SUCCESS
  // terminal state (phone captured → hand off to human), NOT a failure/
  // safety handoff. It is NEVER produced by evaluate() below — the
  // short-circuit gate in ai-agent.service.ts asserts it directly so the
  // handoff runs through the proven label→pending→hub-team side-effects.
  | 'PHONE_CAPTURED';

export const LABEL_BY_REASON: Record<HandoffReason, string> = {
  SYMPTOM: 'priya-handoff-symptom',
  IMAGE_RECEIVED: 'priya-handoff-image',
  EXPLICIT_HUMAN: 'priya-handoff-human-request',
  FRUSTRATION: 'priya-handoff-frustration',
  INSURANCE_LEGAL: 'priya-handoff-insurance',
  DRUG_QUERY: 'priya-handoff-drug-query',
  PRICING_NEGOTIATION: 'priya-handoff-pricing',
  PHONE_ASK_EXHAUSTED: 'priya-handoff-phone-ask-exhausted',
  TURN_COUNT_EXCEEDED: 'priya-handoff-turn-count',
  // Phone-capture short-circuit reuses the LIVE telecaller-pickup label
  // (`priya-qualified`, 122/30d) so short-circuited leads surface in the
  // exact same Chatwoot label view as chat-qualified ones.
  PHONE_CAPTURED: 'priya-qualified',
};

export interface EscalationContext {
  /** True if the inbound patient turn included an image attachment. */
  hadImage?: boolean;
  /** Override for PRIYA_MAX_TURNS (default 10). */
  maxTurns?: number;
  /** Override for phone-ask strike threshold (default 2). */
  phoneAskMax?: number;
}

export interface EscalationDecision {
  escalate: boolean;
  reason?: HandoffReason;
  label?: string;
  matchedLexicon?: string;
  matchedPattern?: string;
  matchedLanguage?: LexiconLanguage | 'state';
}

interface LexiconBinding {
  name: string;
  lexicon: LanguageLexicon;
  reason: HandoffReason;
}

/**
 * Lexicon binding ORDER defines precedence for lexicon-backed reasons.
 * State-based reasons (IMAGE, PHONE_ASK_EXHAUSTED, TURN_COUNT) are
 * interleaved in `evaluate` per user-specified order.
 */
const LEXICON_BINDINGS: LexiconBinding[] = [
  { name: 'symptoms',             lexicon: SYMPTOM_LEXICON,             reason: 'SYMPTOM' },
  // IMAGE_RECEIVED slot (handled inline in evaluate — state-based)
  { name: 'human-request',        lexicon: HUMAN_REQUEST_LEXICON,       reason: 'EXPLICIT_HUMAN' },
  { name: 'frustration',          lexicon: FRUSTRATION_LEXICON,         reason: 'FRUSTRATION' },
  { name: 'insurance-legal',      lexicon: INSURANCE_LEGAL_LEXICON,     reason: 'INSURANCE_LEGAL' },
  { name: 'drug-names',           lexicon: DRUG_NAMES_LEXICON,          reason: 'DRUG_QUERY' },
  { name: 'pricing-negotiation',  lexicon: PRICING_NEGOTIATION_LEXICON, reason: 'PRICING_NEGOTIATION' },
];

const LANG_ORDER: LexiconLanguage[] = ['ml', 'ta', 'manglish', 'tanglish', 'en'];

function scanLexicon(
  message: string,
  lex: LanguageLexicon,
): { entry: LexiconEntry; language: LexiconLanguage } | null {
  for (const lang of LANG_ORDER) {
    const entries = lex[lang] || [];
    for (const entry of entries) {
      if (entry.pattern.test(message)) {
        return { entry, language: lang };
      }
    }
  }
  return null;
}

function decide(
  reason: HandoffReason,
  lexiconName: string,
  patternName: string,
  language: LexiconLanguage | 'state',
): EscalationDecision {
  return {
    escalate: true,
    reason,
    label: LABEL_BY_REASON[reason],
    matchedLexicon: lexiconName,
    matchedPattern: patternName,
    matchedLanguage: language,
  };
}

/**
 * Evaluate escalation. `state` must be the PriyaState AT ENTRY of the
 * current turn — i.e., phoneAskCount / turnCount reflect PREVIOUS-turn
 * saves. The orchestrator increments these after the reply + escalation
 * decision, in the single end-of-handler state.mutate.
 */
export function evaluate(
  message: string,
  state: Pick<
    PriyaState,
    'phoneAskCount' | 'turnCount' | 'patientPhone' | 'humanAssigned'
  >,
  context: EscalationContext = {},
): EscalationDecision {
  // Structural guarantee: never evaluate after Priya is already silent.
  if (state.humanAssigned) return { escalate: false };

  const msg = message || '';
  const maxTurns = context.maxTurns ?? 10;
  const phoneAskMax = context.phoneAskMax ?? 2;

  // 1. SYMPTOM (highest priority — safety)
  const symptomHit = scanLexicon(msg, SYMPTOM_LEXICON);
  if (symptomHit) {
    return decide(
      'SYMPTOM',
      'symptoms',
      symptomHit.entry.name,
      symptomHit.language,
    );
  }

  // 2. IMAGE_RECEIVED (also safety — state-based)
  if (context.hadImage) {
    return decide('IMAGE_RECEIVED', 'image-hook', 'image_attachment_present', 'state');
  }

  // 3-7. Lexicon-backed reasons in precedence order.
  for (const binding of LEXICON_BINDINGS) {
    if (binding.reason === 'SYMPTOM') continue; // already checked
    const hit = scanLexicon(msg, binding.lexicon);
    if (hit) {
      return decide(
        binding.reason,
        binding.name,
        hit.entry.name,
        hit.language,
      );
    }
  }

  // 8. PHONE_ASK_EXHAUSTED — two-strike counter, phone still not captured.
  if (state.phoneAskCount >= phoneAskMax && !state.patientPhone) {
    return decide(
      'PHONE_ASK_EXHAUSTED',
      'state-counter',
      `phone_ask_count_gte_${phoneAskMax}`,
      'state',
    );
  }

  // 9. TURN_COUNT_EXCEEDED — engagement without conversion.
  if (state.turnCount > maxTurns && !state.patientPhone) {
    return decide(
      'TURN_COUNT_EXCEEDED',
      'state-counter',
      `turn_count_gt_${maxTurns}`,
      'state',
    );
  }

  return { escalate: false };
}

/**
 * Introspection helper — exposes the lexicon registry for the /health
 * endpoint and acceptance-test artefact (a).
 *
 * `reason` is a union of the real HandoffReason codes plus the
 * `'state-only'` sentinel for rules that aren't backed by a lexicon
 * (image attachment hook, phone-ask / turn-count state counters). The
 * row type is named so TypeScript keeps the union on `out` instead of
 * narrowing to HandoffReason from the first `map` result.
 */
export type LexiconSummaryRow = {
  name: string;
  reason: HandoffReason | 'state-only';
  byLanguage: Record<LexiconLanguage, number>;
  total: number;
};

export function getLexiconSummary(): LexiconSummaryRow[] {
  const out: LexiconSummaryRow[] = LEXICON_BINDINGS.map((b) => {
    const byLang: Record<LexiconLanguage, number> = {
      ml: (b.lexicon.ml || []).length,
      ta: (b.lexicon.ta || []).length,
      manglish: (b.lexicon.manglish || []).length,
      tanglish: (b.lexicon.tanglish || []).length,
      en: (b.lexicon.en || []).length,
    };
    return {
      name: b.name,
      reason: b.reason,
      byLanguage: byLang,
      total:
        byLang.ml + byLang.ta + byLang.manglish + byLang.tanglish + byLang.en,
    };
  });
  // Add state-only entries for completeness.
  out.push({
    name: 'image-hook',
    reason: 'state-only',
    byLanguage: { ml: 0, ta: 0, manglish: 0, tanglish: 0, en: 0 },
    total: 0,
  });
  out.push({
    name: 'state-counter',
    reason: 'state-only',
    byLanguage: { ml: 0, ta: 0, manglish: 0, tanglish: 0, en: 0 },
    total: 0,
  });
  return out;
}
