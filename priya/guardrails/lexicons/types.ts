/**
 * Lexicon type definitions.
 *
 * Each lexicon file exports a LanguageLexicon — keyed by language tag
 * (ml / ta / manglish / tanglish / en) with arrays of named regex
 * patterns. Compiled ONCE at module load; the engine reuses them on
 * every evaluate() call.
 *
 * Pattern naming convention: snake_case describing the clinical or
 * semantic intent. The name (not the regex source) is what we log —
 * matched message text never appears in structured logs to preserve
 * PHI safety.
 *
 * Contribution model (for hub staff / domain experts):
 *   - Patterns are data, not code. Add a new entry to the appropriate
 *     language array — no engine changes required.
 *   - Prefer narrow patterns over broad ones. False positives here
 *     handoff otherwise-in-flight conversations.
 *
 * Marker: isSelfAuthored
 */

export type LexiconLanguage = 'ml' | 'ta' | 'manglish' | 'tanglish' | 'en';

export interface LexiconEntry {
  /** snake_case intent name — what gets logged when this hits. */
  name: string;
  /** Compiled regex. Use case-insensitive (i) for Latin-letter patterns. */
  pattern: RegExp;
}

export type LanguageLexicon = Partial<Record<LexiconLanguage, LexiconEntry[]>>;

/** Total pattern count across all language buckets — used by /health. */
export function countPatterns(lex: LanguageLexicon): number {
  let n = 0;
  for (const key of Object.keys(lex) as LexiconLanguage[]) {
    n += (lex[key] || []).length;
  }
  return n;
}

/** Pattern count per language — used by acceptance artefacts. */
export function countByLanguage(lex: LanguageLexicon): Record<LexiconLanguage, number> {
  return {
    ml: (lex.ml || []).length,
    ta: (lex.ta || []).length,
    manglish: (lex.manglish || []).length,
    tanglish: (lex.tanglish || []).length,
    en: (lex.en || []).length,
  };
}
