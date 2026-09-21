/**
 * Phone-ask detector — reverse-matches Priya's REPLY against the
 * phone-ask scripts baked into priya.prompt.ts.
 *
 * The orchestrator calls this AFTER sendReply succeeds. A truthy
 * result increments state.phoneAskCount in the end-of-handler mutate.
 * Two cumulative matches without state.patientPhone → next turn's
 * escalation engine returns PHONE_ASK_EXHAUSTED.
 *
 * v2.0 patterns (canonical): "ur number?" / "ur number? team will call" /
 * Manglish "ningalude number tharamo" / Malayalam-script equivalent /
 * Tanglish "ungal en?" / "number share pannunga" / Tamil-script form.
 * v1 patterns are appended for one release cycle as cheap insurance
 * during history replays — they will be removed once the v2 rollout
 * is stable.
 *
 * Marker: isSelfAuthored
 */

const PHONE_ASK_PATTERNS: RegExp[] = [
  // ── v2.0 patterns (canonical — 2026-04-24 rewrite) ──

  // English — canonical "ur number" optional question mark
  /\bur\s+number\b\??/i,
  // "number ... team/staff will call/ring/msg"
  /\bnumber\b.*\b(team|staff)\b.*\b(will\s+)?(call|ring|msg)\b/i,

  // Manglish — "ningalude number tharamo"
  /\bningalude\s+number\s+tharamo\b/i,
  // Malayalam-Unicode form of "ningalude number tharamo"
  // നിങ്ങളുടെ നമ്പർ തരാമോ
  /നിങ്ങളുടെ\s+(നമ്പർ|number)\s+തരാമോ/,

  // Tanglish — "ungal en?"
  /\bungal\s+en\b\??/i,
  // Tanglish — "number share pannunga"
  /\bnumber\s+share\s+pannunga\b/i,
  // Tamil-Unicode form of "ungal en?"
  // உங்கள் எண்
  /உங்கள்\s+எண்/,

  // ── v1 patterns (appended for one release cycle — replay insurance) ──

  // English variants ("mobile number would help" / "shall I have our specialist")
  /\bmobile\s+number\s+would\s+help\b/i,
  /\bshall\s+I\s+have\s+(our|the)\s+specialist\s+call\b/i,
  /\bwould\s+you\s+like\s+our\s+specialist\s+to\s+call\b/i,
  /\ba\s+mobile\s+number\s+would\s+help\s+(us|me)?\b/i,

  // Manglish v1
  /\boru\s+mobile\s+number\s+tharamo\b/i,
  /\bmobile\s+number\s+tharamo\b/i,
  /\bnjangalude\s+specialist\b/i, // "our specialist ... mobile number tharamo"

  // Malayalam script v1 — matches "mobile number തരാമോ"
  /mobile\s+number\s+തരാമോ/,
  /specialist\s+call\s+ചെയ്ത്/,

  // Tamil script v1 — "mobile number குடுக்க"
  /mobile\s+number\s+(?:குடுக்க|கொடுக்க)/,
  /specialist\s+directly\s+call\s+பண்ண/,

  // Tanglish v1
  /\bungal\s+mobile\s+number\s+kudunga\b/i,
  /\boru\s+mobile\s+number\s+kudunga\b/i,
];

export function replyContainsPhoneAsk(reply: string): boolean {
  if (!reply) return false;
  return PHONE_ASK_PATTERNS.some((p) => p.test(reply));
}

/** Test-only introspection for the harness. */
export function _phoneAskPatterns(): RegExp[] {
  return [...PHONE_ASK_PATTERNS];
}
