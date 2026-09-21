/**
 * P1.24 slice 2b — the diagnosis-draft prompt parser + composer.
 * Pure functions, no network. Guards the two traps: malformed AI output must
 * become null (never shown to the physician), and the composed text is stable
 * + bounded to the 4000-char column CHECK.
 */
import { describe, it, expect } from 'vitest';
import {
  parseDiagnosisOutput,
  composeDiagnosisText,
  type DiagnosisDraft
} from '../../lib/ai/prompts/diagnosis';

const valid: DiagnosisDraft = {
  diagnoses: ['Type 2 Diabetes Mellitus (HbA1c 7.9%)', 'Class III obesity (BMI 41.5)', 'MASLD (ALT 94)'],
  indication: 'GLP-1 therapy indicated for glycaemic control and weight management.',
  eligibility: 'Eligible — with cautions: gallstone status, uric acid.'
};

describe('parseDiagnosisOutput', () => {
  it('parses a valid JSON object', () => {
    expect(parseDiagnosisOutput(JSON.stringify(valid))).toEqual(valid);
  });
  it('tolerates ```json fences', () => {
    expect(parseDiagnosisOutput('```json\n' + JSON.stringify(valid) + '\n```')).toEqual(valid);
  });
  it('returns null on malformed JSON (never shows garbage to the physician)', () => {
    expect(parseDiagnosisOutput('not json at all')).toBeNull();
    expect(parseDiagnosisOutput('{"diagnoses": [')).toBeNull();
  });
  it('returns null when required fields are missing or wrong-typed', () => {
    expect(parseDiagnosisOutput(JSON.stringify({ diagnoses: [], indication: 'x', eligibility: 'y' }))).toBeNull(); // empty diagnoses
    expect(parseDiagnosisOutput(JSON.stringify({ diagnoses: ['a'], indication: 'x' }))).toBeNull(); // no eligibility
    expect(parseDiagnosisOutput(JSON.stringify({ diagnoses: 'a', indication: 'x', eligibility: 'y' }))).toBeNull(); // wrong type
  });
});

describe('composeDiagnosisText', () => {
  it('composes a stable Diagnosis / Indication / Eligibility block', () => {
    expect(composeDiagnosisText(valid)).toBe(
      'Diagnosis: Type 2 Diabetes Mellitus (HbA1c 7.9%); Class III obesity (BMI 41.5); MASLD (ALT 94).\n' +
        'Indication: GLP-1 therapy indicated for glycaemic control and weight management.\n' +
        'Eligibility: Eligible — with cautions: gallstone status, uric acid.'
    );
  });
  it('caps the composed text at the 4000-char DB CHECK bound', () => {
    const huge: DiagnosisDraft = {
      diagnoses: [Array(400).fill('x').join('')],
      indication: Array(4000).fill('y').join(''),
      eligibility: 'Eligible'
    };
    expect(composeDiagnosisText(huge).length).toBeLessThanOrEqual(4000);
  });
});
