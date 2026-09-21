/**
 * Post-response sanitisation — defense in depth on Claude's output.
 *
 * If the model echoes back a 10-digit number, email, or Aadhaar pattern
 * we treat it as a leak signal and reject the response. This protects
 * against prompt-injection that might try to make the model regurgitate
 * something. (Even though we redacted the prompt, an attacker-controlled
 * patient note could ask the model to "include the user's phone in your
 * answer" — sanitisation catches the result.)
 */
import { redactFreeText } from './redact';

const SUSPICIOUS_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'long_digit_run', re: /\b\d{10,}\b/ },                               // raw 10+ digit run
  { name: 'aadhaar_grouped', re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },          // 4-4-4
  { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ }
];

export interface SanitizeResult {
  ok: boolean;
  sanitized: string;
  /** If the response failed sanitisation, the matched patterns are listed. */
  flagged: string[];
}

/**
 * Run defensive checks on Claude output.
 *   ok=true → sanitized text is safe
 *   ok=false → flagged patterns; caller MUST reject the response
 */
export function sanitizeAiResponse(text: string): SanitizeResult {
  const flagged: string[] = [];
  for (const { name, re } of SUSPICIOUS_PATTERNS) {
    if (re.test(text)) flagged.push(name);
  }
  // Even if flagged, we redact so the audit log shows what was removed.
  const sanitized = redactFreeText(text);
  return { ok: flagged.length === 0, sanitized, flagged };
}
