import { describe, it, expect } from 'vitest';
import { redactFreeText, inputsToPromptText, ageInYears, type PromptInputs } from '../../lib/ai/redact';

describe('redactFreeText', () => {
  it('redacts a 10-digit Indian phone number', () => {
    expect(redactFreeText('Call patient at 9876543210 today')).not.toContain('9876543210');
    expect(redactFreeText('Call patient at 9876543210 today')).toMatch(/\[PHONE\]/);
  });

  it('redacts E.164 phone with leading +', () => {
    expect(redactFreeText('+919876543210 is the number')).toMatch(/\[PHONE\]/);
  });

  it('redacts emails', () => {
    expect(redactFreeText('email patient at jane@example.com')).toMatch(/\[EMAIL\]/);
    expect(redactFreeText('email patient at jane@example.com')).not.toContain('jane@example.com');
  });

  it('redacts Aadhaar (12-digit grouped 4-4-4)', () => {
    expect(redactFreeText('Aadhaar 1234 5678 9012')).toMatch(/\[ID\]/);
  });

  it('redacts Indian pincode (6 digits not starting with 0)', () => {
    expect(redactFreeText('lives at pincode 682001')).toMatch(/\[PINCODE\]/);
  });

  it('does NOT redact a 5-digit number (BMI / age / etc.)', () => {
    expect(redactFreeText('weight 78.5 height 172')).not.toMatch(/\[PHONE\]/);
  });

  it('preserves clinical text content', () => {
    const out = redactFreeText('HbA1c 7.2%, eGFR 88, BMI 27.5');
    expect(out).toContain('HbA1c 7.2%');
    expect(out).toContain('eGFR 88');
  });

  it('returns empty string for null/undefined', () => {
    expect(redactFreeText(null)).toBe('');
    expect(redactFreeText(undefined)).toBe('');
  });
});

describe('inputsToPromptText', () => {
  const baseInputs: PromptInputs = {
    patient: { ageYears: 42, sex: 'F' },
    intake: {
      goal: { primary: 'weight_loss' },
      // PHI keys that should be redacted by inputsToPromptText
      fullName: 'Anitha Pillai',
      phone: '+919876543210',
      email: 'anitha@example.com'
    },
    vitals: { weightKg: 78.5, heightCm: 172, bmi: 26.5 },
    labs: { hba1c: 7.2, egfr: 88 },
    notes: 'Patient phone is +919876543210 (should be stripped from notes too)'
  };

  it('NEVER includes patient name in the prompt body', () => {
    const text = inputsToPromptText(baseInputs);
    expect(text).not.toContain('Anitha');
    expect(text).not.toContain('Pillai');
  });

  it('NEVER includes phone in the prompt body', () => {
    const text = inputsToPromptText(baseInputs);
    expect(text).not.toContain('919876543210');
  });

  it('NEVER includes email in the prompt body', () => {
    const text = inputsToPromptText(baseInputs);
    expect(text).not.toContain('anitha@example.com');
  });

  it('redacts phone in free-text notes', () => {
    const text = inputsToPromptText(baseInputs);
    expect(text).toMatch(/\[PHONE\]/);
  });

  it('preserves clinical fields (vitals, labs, intake goal)', () => {
    const text = inputsToPromptText(baseInputs);
    expect(text).toContain('42 years');
    expect(text).toContain('hba1c: 7.2');
    expect(text).toContain('weight_loss');
  });
});

describe('ageInYears', () => {
  it('computes age from a Date instance', () => {
    const dob = new Date(Date.now() - 30 * 365.25 * 24 * 3600 * 1000);
    const age = ageInYears(dob);
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(29);
    expect(age!).toBeLessThanOrEqual(30);
  });

  it('handles ISO string DOB', () => {
    const age = ageInYears('1990-01-01');
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThan(30);
  });

  // Regression: pre-fix, ageInYears(null) crashed with
  // "Cannot read properties of null (reading 'getFullYear')" inside
  // every route that prescribed for a null-DOB patient (127 of 200
  // production patients on 2026-05-26). The function now returns null
  // and the Schedule H validator surfaces it as a clean 400.
  it('returns null for null DOB (no crash)', () => {
    expect(ageInYears(null)).toBeNull();
  });

  it('returns null for undefined DOB', () => {
    expect(ageInYears(undefined)).toBeNull();
  });

  it('returns null for an unparseable date string', () => {
    expect(ageInYears('not-a-date')).toBeNull();
    expect(ageInYears('')).toBeNull();
  });
});
