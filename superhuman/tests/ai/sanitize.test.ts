import { describe, it, expect } from 'vitest';
import { sanitizeAiResponse } from '../../lib/ai/sanitize';

describe('sanitizeAiResponse', () => {
  it('passes a clean clinical response', () => {
    const r = sanitizeAiResponse(
      'Recommend semaglutide 0.25mg weekly. Recheck HbA1c in 12 weeks.'
    );
    expect(r.ok).toBe(true);
    expect(r.flagged).toEqual([]);
  });

  it('FLAGS responses that contain a 10-digit number (potential phone leak)', () => {
    const r = sanitizeAiResponse(
      'Patient phone is 9876543210 — please contact for follow-up.'
    );
    expect(r.ok).toBe(false);
    expect(r.flagged).toContain('long_digit_run');
  });

  it('FLAGS Aadhaar pattern', () => {
    const r = sanitizeAiResponse('ID 1234 5678 9012 verified.');
    expect(r.ok).toBe(false);
    expect(r.flagged.some((f) => f.includes('aadhaar') || f.includes('long_digit_run'))).toBe(true);
  });

  it('FLAGS email addresses', () => {
    const r = sanitizeAiResponse('Contact reviewer@example.com for review.'); // fixture address changed for this extract
    expect(r.ok).toBe(false);
    expect(r.flagged).toContain('email');
  });

  it('returns a redacted version even when flagged (audit trail safety)', () => {
    const r = sanitizeAiResponse('Phone 9876543210, email a@b.com');
    expect(r.sanitized).not.toContain('9876543210');
    expect(r.sanitized).not.toContain('a@b.com');
  });

  it('does NOT flag short medical numbers (7.2, 88, etc.)', () => {
    const r = sanitizeAiResponse('HbA1c 7.2, eGFR 88, BMI 27.5');
    expect(r.ok).toBe(true);
  });
});
