/**
 * T6 — Phone-ask detector parity.
 *
 * After the v2.0 prompt rewrite, Priya's canonical phone-ask phrases
 * change to the Indian-girl-texting register (e.g., "ur number? team
 * will call"). This spec pins positive matches on the new phrasings
 * and a handful of v1 legacy phrasings that were appended for one
 * release cycle — plus negative regressions on non-phone-ask text
 * that must NOT trigger PHONE_ASK_EXHAUSTED.
 *
 * If this suite fails after future trims to phone-ask-detector.ts,
 * the two-strike escalation counter silently breaks — stop and fix.
 *
 * Marker: isSelfAuthored
 */

import { replyContainsPhoneAsk } from '../phone-ask-detector';

const POSITIVE_V2_CASES: string[] = [
  'ur number?',
  'ur number? team will call',
  'got it — ur number? aluva team will ring u today itself',
  'ningalude number tharamo? team vilikkum asap', // Manglish
  'ok, നിങ്ങളുടെ നമ്പർ തരാമോ? team will msg u', // Malayalam script
  'ungal en?', // Tanglish shorthand
  'number share pannunga? team call pannuvaanga', // Tanglish
  'sure, உங்கள் எண் please', // Tamil script
];

const POSITIVE_V1_LEGACY_CASES: string[] = [
  // v1 patterns retained for one release cycle.
  'a mobile number would help us confirm a slot',
  'oru mobile number tharamo?',
];

const NEGATIVE_CASES: string[] = [
  'what is your name?',
  'hello there',
  'thanks for the info',
  'doctor will confirm at consultation',
  'hydrafacial starts from ₹2,500',
];

describe('replyContainsPhoneAsk — positive v2.0 phrasings', () => {
  test.each(POSITIVE_V2_CASES)('matches v2.0 phrase: %s', (reply) => {
    expect(replyContainsPhoneAsk(reply)).toBe(true);
  });
});

describe('replyContainsPhoneAsk — positive v1 legacy phrasings (one release cycle)', () => {
  test.each(POSITIVE_V1_LEGACY_CASES)('still matches v1 phrase: %s', (reply) => {
    expect(replyContainsPhoneAsk(reply)).toBe(true);
  });
});

describe('replyContainsPhoneAsk — negative regressions', () => {
  test.each(NEGATIVE_CASES)('does NOT match non-phone-ask: %s', (reply) => {
    expect(replyContainsPhoneAsk(reply)).toBe(false);
  });

  test('empty string returns false', () => {
    expect(replyContainsPhoneAsk('')).toBe(false);
  });
});
