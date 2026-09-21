/**
 * Guards Stone Rule #13 on the lab-parsing AI surface (P1.26(a), 2026-07-22).
 *
 * THE BUG: `lib/lab-parsing/prompt.ts:41` interpolated the uploaded
 * filename into the Claude user turn:
 *
 *     `Extract lab values from the attached report: ${fileName}`
 *
 * Uploaded filenames are routinely the patient's own name — the shape is
 * `SMT.<FIRSTNAME> <LASTNAME>.pdf` — so an unredacted identifier went to
 * Anthropic on every parse, continuously since 2026-05-12.
 *
 * `lib/ai/redact.ts` was never a defence here: `redactFreeText()` matches
 * email / phone / Aadhaar / ABHA / pincode and has NO name-detection
 * regex, and `lib/lab-parsing/*` never imported it anyway.
 *
 * These assertions fail if a filename — or any other identifier-shaped
 * value — is reintroduced into the lab-parsing prompt path.
 *
 * Static test: reads source, no DB, no network, runs everywhere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { buildLabUserPrompt } from '../../lib/lab-parsing/prompt';

const REPO = resolve(__dirname, '..', '..');

/*
 * Scanned surface: the two directories where AI prompts are actually
 * built. Anita and Karthik both asked for `lib/jobs/` to be included,
 * since that is where the leaked value originates. I tried it and backed
 * it out: `lib/jobs/` legitimately interpolates PHI into NON-AI outbound
 * text — `${firstName}` into a patient WhatsApp reminder
 * (send-appointment-reminder.ts:69) and `${patient.fullName}` into a
 * Google Calendar event summary (sync-calendar.ts:70). Both are intended
 * and neither is a Stone Rule #13 concern, which is specifically about
 * AI prompts. Flagging them would make this guard cry wolf, and a test
 * that cries wolf gets deleted.
 *
 * The real risk they named — "a prompt assembled in lib/jobs/ would
 * escape" — is covered instead by the separate assertion below that
 * lib/jobs/ never talks to the Anthropic SDK directly.
 */
const SCAN_DIRS = [join(REPO, 'lib', 'lab-parsing'), join(REPO, 'lib', 'ai')];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => walk(d)).map((f) => ({
  path: f,
  name: basename(f),
  src: readFileSync(f, 'utf8')
}));

/**
 * Identifier fragments that denote a caller-supplied, unredacted value.
 * If one of these is interpolated into a template literal inside the
 * lab-parsing prompt path, it is a PHI leak until proven otherwise.
 */
const PHI_IDENTIFIERS = [
  'fileName',
  'filename',
  'originalName',
  'patientName',
  'fullName',
  'firstName',
  'lastName',
  'phone',
  'email',
  'dob',
  'dateOfBirth',
  'address',
  'aadhaar',
  'abha'
];

describe('lab-parsing sends no PHI to Anthropic (Stone Rule #13, P1.26a)', () => {
  it('buildLabUserPrompt takes no arguments — nothing caller-supplied can reach this prompt', () => {
    // Arity 0 means there is nothing caller-supplied to interpolate.
    expect(buildLabUserPrompt.length).toBe(0);
  });

  it('the emitted prompt is a fixed string with no interpolation', () => {
    const prompt = buildLabUserPrompt();
    expect(prompt).toBe('Extract lab values from the attached report.');
    // Belt and braces: nothing that looks like a file extension or a
    // template placeholder survived into the emitted text.
    expect(prompt).not.toMatch(/\.(pdf|jpe?g|png)/i);
    expect(prompt).not.toMatch(/\$\{/);
  });

  it('no PHI-shaped identifier is interpolated in the AI-prompt surface', () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      file.src.split('\n').forEach((line, i) => {
        // Only template-literal interpolations can carry a runtime value
        // into a prompt string. Comments are ignored — this file and the
        // fixed prompt.ts both *discuss* the leak by name.
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;

        for (const ident of PHI_IDENTIFIERS) {
          const interpolation = new RegExp(`\\$\\{[^}]*\\b${ident}\\b[^}]*\\}`);
          if (interpolation.test(line)) {
            offenders.push(`${file.name}:${i + 1} — \${…${ident}…} in "${trimmed.slice(0, 90)}"`);
          }
        }
      });
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('lib/jobs never calls the Anthropic SDK directly — prompts stay in the scanned surface', () => {
    // The guard above only sweeps lib/lab-parsing + lib/ai. That is only
    // sufficient while prompt construction stays there. If a job ever
    // builds its own request, it would carry PHI past the sweep — so
    // fail here instead, and force the prompt back into a scanned dir.
    const jobFiles = walk(join(REPO, 'lib', 'jobs')).map((f) => ({
      name: basename(f),
      src: readFileSync(f, 'utf8')
    }));
    expect(jobFiles.length).toBeGreaterThan(0);

    // Covers the front door as well as the SDK (Anita, round 2): a job
    // importing `claudeMessage` from lib/ai/claude and building its own
    // user string is the same escape, without ever touching the SDK.
    // `extractLabValues` stays permitted — parse-lab-upload.ts:46 imports
    // it legitimately and its arity is guarded above.
    const offenders = jobFiles
      .filter((f) =>
        /@anthropic-ai\/sdk|messages\s*\.\s*create\s*\(|claudeMessage|['"][^'"]*ai\/claude['"]/.test(
          f.src
        )
      )
      .map((f) => `lib/jobs/${f.name} reaches an AI call surface directly — build the prompt in lib/ai or lib/lab-parsing so the PHI sweep covers it`);

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('extractLabValues does not accept a filename parameter', () => {
    const claude = FILES.find((f) => f.name === 'claude.ts');
    expect(claude, 'lib/lab-parsing/claude.ts not found — scan is misconfigured').toBeDefined();
    const sig = claude!.src.match(/export async function extractLabValues\(([^)]*)\)/);
    expect(sig, 'extractLabValues signature not found').not.toBeNull();
    const params = sig![1] ?? '';
    for (const ident of ['fileName', 'filename', 'originalName']) {
      expect(params, `extractLabValues must not take ${ident}`).not.toContain(ident);
    }
  });

  /*
   * POSITIVE CONTROLS — prove the detector still detects.
   *
   * Without these, a broken regex or an empty file scan would leave this
   * suite permanently green and inert. That is exactly how the original
   * leak, and INC-010 before it, survived.
   */
  describe('the detector still detects', () => {
    const scan = (line: string): boolean =>
      PHI_IDENTIFIERS.some((ident) =>
        new RegExp(`\\$\\{[^}]*\\b${ident}\\b[^}]*\\}`).test(line)
      );

    it('flags the exact line that shipped the leak', () => {
      expect(scan('  return `Extract lab values from the attached report: ${fileName}`;')).toBe(true);
    });

    it('flags a renamed variant', () => {
      expect(scan('const p = `Report for ${upload.originalName} follows`;')).toBe(true);
    });

    it('does not flag innocent interpolation', () => {
      expect(scan('const msg = `Parsed ${count} analytes in ${elapsedMs}ms`;')).toBe(false);
    });

    it('actually read the lab-parsing sources', () => {
      expect(FILES.length).toBeGreaterThanOrEqual(4); // named-file asserts below carry the real guarantee
      expect(FILES.map((f) => f.name)).toContain('prompt.ts');
      expect(FILES.map((f) => f.name)).toContain('claude.ts');
    });
  });
});
