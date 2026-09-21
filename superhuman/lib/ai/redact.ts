/**
 * PHI redaction — runs BEFORE any text is sent to the Claude API.
 *
 * Stone rule #13: minimal PHI in AI prompts. Strip name, phone, address,
 * email, Aadhaar, ABHA. Only clinical content (symptoms, vitals, labs,
 * medications) goes to the API.
 *
 * Approach:
 *   1. STRUCTURED redaction — caller passes a typed PromptInputs object
 *      with already-separated identity vs clinical fields. Identity fields
 *      are replaced with placeholders before serialization.
 *   2. PATTERN redaction — defense in depth. Regex sweep over the final
 *      string catches any 10-digit numbers, emails, Aadhaar (12-digit)
 *      that may have leaked through clinical text (e.g., a doctor pasted
 *      a patient phone into HPI).
 */

import { classifyPath, WITHHELD_MARKER } from './intake-classification';

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Aadhaar / ABHA require EXPLICIT separators so we don't catch unseparated
// phone numbers (which run-of-digits patterns would). Phones come second.
const AADHAAR_RE = /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g;                 // 4-4-4
const ABHA_RE    = /\b\d{2}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g;       // 2-4-4-4
const PHONE_RE   = /(?:\+\d{1,3}[\s-]?)?\b\d{10,12}\b/g;             // optional CC then 10-12 digits
const PINCODE_RE = /\b[1-9]\d{5}\b/g;                                // 6-digit

/**
 * Pattern-based redaction of free-text. Returns a redacted copy.
 */
export function redactFreeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(AADHAAR_RE, '[ID]')
    .replace(ABHA_RE, '[ID]')
    .replace(PHONE_RE, '[PHONE]')
    .replace(PINCODE_RE, '[PINCODE]');
}

/**
 * Structured redaction — caller indicates which fields are identity vs
 * clinical. Identity fields never appear in the output object.
 */
export interface PromptInputs {
  patient: {
    /**
     * Age in years (computed from DOB; do NOT pass DOB). Null when
     * the patient has no recorded DOB — the prompt renders "unknown"
     * rather than crashing.
     */
    ageYears: number | null;
    sex: 'M' | 'F' | 'O';
  };
  intake: Record<string, unknown>;
  vitals?: {
    weightKg?: number | null;
    heightCm?: number | null;
    bmi?: number | null;
    waistCm?: number | null;
    systolic?: number | null;
    diastolic?: number | null;
    heartRate?: number | null;
  };
  labs?: {
    hba1c?: number | null;
    egfr?: number | null;
    fastingGlucose?: number | null;
    fastingInsulin?: number | null;
    tsh?: number | null;
    totalChol?: number | null;
    ldl?: number | null;
    hdl?: number | null;
    triglycerides?: number | null;
    vitaminB12?: number | null;
    alt?: number | null;
    ast?: number | null;
  };
  /** Any additional free-text passed through redactFreeText() before reaching us */
  notes?: string;
}

/** Convert an inputs object to a deterministic, PHI-free prompt body. */
export function inputsToPromptText(inputs: PromptInputs): string {
  const lines: string[] = [];
  lines.push('PATIENT (de-identified):');
  lines.push(
    `  Age: ${
      inputs.patient.ageYears != null ? `${inputs.patient.ageYears} years` : 'unknown (DOB not recorded)'
    }`
  );
  lines.push(`  Sex: ${inputs.patient.sex}`);
  if (inputs.vitals) {
    lines.push('VITALS:');
    for (const [k, v] of Object.entries(inputs.vitals)) {
      if (v != null) lines.push(`  ${k}: ${v}`);
    }
  }
  if (inputs.labs) {
    lines.push('LABS:');
    for (const [k, v] of Object.entries(inputs.labs)) {
      if (v != null) lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push('INTAKE (clinical fields only):');
  lines.push(JSON.stringify(redactObject(inputs.intake, '') ?? {}, null, 2));
  if (inputs.notes) {
    lines.push('NOTES:');
    lines.push(redactFreeText(inputs.notes));
  }
  return lines.join('\n');
}

/**
 * Filter an intake payload to what Claude may see, deciding BY PATH.
 *
 * See lib/ai/intake-classification.ts for the full rationale — briefly:
 * the previous denylist missed `consent.digital_signature` (the patient's
 * typed full name), and a flat key allowlist that replaced it deleted the
 * entire GLP-1 contraindication surface from `glp1.v1` payloads because
 * `name` cannot mean both "a person" and "a drug". A path can.
 *
 * Traversal rules:
 *   - objects   descend, extending the path with `.key`
 *   - arrays    of OBJECTS extend the path with `[]` (so `medications[].name`);
 *               of SCALARS the elements inherit the array's own path
 *               (so `vitals.allergies` classifies its strings)
 *   - leaves    classified by their full path
 *
 * An omitted leaf disappears; an unclassified one renders as
 * `[WITHHELD]` so the model can tell "collected but not shown" from
 * "never asked", which DIAGNOSIS_SYSTEM_PROMPT explicitly depends on.
 * Allowed strings still pass through `redactFreeText`.
 */
function redactObject(obj: unknown, path = ''): unknown {
  // ---- leaf ----
  // A non-plain object (Date, Map, class instance) is a LEAF, not something
  // to traverse. Priya M2 (round 2): `Object.entries(new Date())` is `[]`,
  // so a Date fell through the object branch and vanished with neither a
  // value nor a marker — breaking the invariant that an ALLOWED clinical
  // field always appears. `glp1IntakeSchema.pregnancy.lastMenstrualPeriod`
  // is `z.coerce.date()`, and `app/api/intake/route.ts` persists the
  // zod-PARSED object, so that shape exists in this codebase today.
  const isPlainTraversable =
    obj !== null &&
    typeof obj === 'object' &&
    (Array.isArray(obj) || Object.getPrototypeOf(obj) === Object.prototype || Object.getPrototypeOf(obj) === null);

  if (!isPlainTraversable) {
    const verdict = classifyPath(path);
    if (verdict === 'omit') return undefined;
    if (verdict === 'withhold') return WITHHELD_MARKER;
    if (typeof obj === 'string') return redactFreeText(obj);
    // Render a Date (or similar) as a string rather than dropping it.
    return obj !== null && typeof obj === 'object' ? redactFreeText(String(obj)) : obj;
  }

  // ---- array ----
  if (Array.isArray(obj)) {
    /*
     * An EMPTY input array is preserved (Priya M1, round 2). `medications`
     * and `allergies` are `.default([])`, so `[]` is an affirmative
     * "reconciliation done, none found" — dropping it made NKDA
     * indistinguishable from "allergy history never taken", on the
     * majority of patients, in the one prompt instructed to caveat on
     * missing data. An array that merely FILTERED down to nothing is a
     * different fact and still disappears.
     */
    if (obj.length === 0) {
      return classifyPath(path) === 'omit' ? undefined : [];
    }
    const mapped = obj
      .map((el) => {
        const isObjectEl =
          el !== null && typeof el === 'object' && !Array.isArray(el) &&
          Object.getPrototypeOf(el) === Object.prototype;
        // Object elements get `[]` so their properties are addressable;
        // scalar elements are classified by the array's own path.
        return redactObject(el, isObjectEl ? `${path}[]` : path);
      })
      .filter((el) => el !== undefined)
      // An object element that emptied out carries no information but
      // still implies a count the model may reason from (Priya NIT:
      // `medications: [{}, {}]`). Drop those.
      .filter((el) => !(el !== null && typeof el === 'object' && Object.keys(el).length === 0));
    return mapped.length > 0 ? mapped : undefined;
  }

  // ---- object ----
  // A whole block can be dropped by one entry (e.g. `consent`), which
  // also stops us walking 20,000 characters of consent text.
  if (path && classifyPath(path) === 'omit') return undefined;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    /*
     * PATH FORGERY (Anita HIGH, round 2). `.` and `[]` are our path
     * separators, but a JSON key may legally contain them — so a key named
     * literally `"medications[].name"` or `"vitals.weight_kg"` would match
     * ALLOWED_PATHS and pass through VERBATIM, unredacted.
     *
     * Not reachable today: all three writers of `intake_forms.payload`
     * zod-`.parse()` and insert the parsed object, and zod strip-mode drops
     * unknown keys. But the consumers read the latest row with no
     * schemaVersion filter, so a legacy row, an import, or a future
     * raw-JSON writer would reopen it — and this filter's whole premise is
     * that the payload is untrusted. Such a key is unclassifiable by
     * construction, so it is withheld.
     */
    if (k.includes('.') || k.includes('[')) {
      out[k] = WITHHELD_MARKER;
      continue;
    }
    const childPath = path ? `${path}.${k}` : k;
    const child = redactObject(v, childPath);
    if (child !== undefined) out[k] = child;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * ---------------------------------------------------------------------
 * INC-012 — safe rendering of a caught error for a log line.
 * ---------------------------------------------------------------------
 *
 * Despite this module's name it is also the general log-redaction module,
 * not only the AI-prompt one: `lib/jobs/boss.ts`, `lib/auth/middleware.ts`
 * and `lib/patient-auth/middleware.ts` already import `redactFreeText`
 * from here for exactly this purpose. `redactPgError` generalises that
 * established pattern instead of starting a second module that would
 * drift from these regexes.
 *
 * THE LEAK: `console.error('...:', err)` passes the error OBJECT to
 * Node, which renders it with `util.inspect` — printing every enumerable
 * property. A postgres.js / pg error carries the offending value in
 * `detail`, NOT in `message`:
 *
 *   message: 'duplicate key value violates unique constraint
 *             "patients_phone_e164_key"'        <- no PHI
 *   detail:  'Key (phone_e164)=(+919845012345) already exists.'  <- PHI
 *
 * So the raw object reaches the log with a patient's phone number in it,
 * in plaintext, forever. Stone Rule #16.
 *
 * WHAT THIS KEEPS (deliberately — Karthik): `code`, `constraint`,
 * `table`, `schema`, `routine`, `severity` and the error name are the
 * fields an operator actually needs to diagnose a failure at 2am. None
 * of them can carry patient data — they are catalog identifiers. A
 * redaction wrapper that flattened everything to "[error]" would trade a
 * privacy bug for an outage-diagnosis bug, so it is not what this does.
 *
 * WHAT THIS DROPS: `where`, `hint`, `internalQuery`, `query` and any
 * other free-form field, because each can echo a literal from the
 * statement. They are not redacted and re-emitted — they are omitted.
 *
 * TWO PASSES, deliberately (Anita — "the regex must handle every
 * `Key (col)=(value)` shape"):
 *   1. STRUCTURAL — blank the value inside `Key (cols)=(value)` while
 *      keeping the column names, which are schema facts and useful.
 *   2. PATTERN — run the whole assembled line through `redactFreeText`
 *      regardless. This is the guarantee. Postgres does not escape `)`
 *      inside a value, so no structural regex can be provably total; the
 *      pattern sweep is what makes a miss non-fatal rather than a leak.
 */

/**
 * `Key (a, b)=(v1, v2)` → capture the column list and the value list.
 *
 * The value group is GREEDY on purpose. Postgres does not escape `)`
 * inside a value, so `Key (full_name)=(Priya (Sunitha) Menon) already
 * exists.` is a legal detail string. A lazy `(.*?)` stops at the first
 * `)` that is followed by a separator — here the one after `Sunitha` —
 * and leaves `Menon` in the log. That fragment is a patient NAME, and
 * `redactFreeText` has no name pattern (it cannot have one), so pass 2
 * would not catch it either. Verified empirically before this was
 * changed, not assumed.
 *
 * Greedy takes the LAST `)` followed by a separator, which is the true
 * end of the value. If a message ever contained two `Key (...)=(...)`
 * segments, greedy would swallow the span between them — that
 * over-redacts, which is the fail-safe direction.
 */
const PG_KEY_VALUE_RE = /Key\s*\(([^)]*)\)=\(([\s\S]*)\)(?=[\s.,;]|$)/g;

/**
 * `DETAIL: Failing row contains (9f1c, Priya Menon, 1984-03-02, Kochi, …)`
 *
 * Postgres emits this for NOT NULL (23502), CHECK (23514), partition and
 * exclusion violations. It has NO `Key (` prefix, so the rule above never
 * fires — and it dumps EVERY COLUMN of the row, which is strictly worse
 * than the single-value case. `redactFreeText` has no name, DOB or city
 * pattern, so the pattern sweep cannot save it either.
 *
 * Found by Anita in review by executing the module rather than reading it;
 * the original 12 test cases did not include this shape.
 */
const PG_FAILING_ROW_RE = /Failing row contains\s*\(([\s\S]*)\)(?=[\s.,;]|$)/g;

/**
 * DEFAULT-DENY BACKSTOP for `detail`.
 *
 * Every PHI-bearing DETAIL shape Postgres produces puts the values inside
 * parentheses. Rather than enumerate shapes forever and lose a race with
 * the next one, we blank the contents of ANY parenthesis group left in
 * `detail` after the specific rules above have run — those rules go first
 * precisely so the useful column names in `Key (col)=…` survive.
 *
 * The specific rules run FIRST and rewrite the column list into SQUARE
 * brackets — `Key [phone_e164]=([REDACTED])` — precisely so this blanket
 * rule cannot eat it. Column names are schema facts and are the thing an
 * operator needs; values are the thing that must never survive. (First
 * attempt used round brackets and this rule blanked the column names too,
 * while a comment claimed they survived.)
 */
const PG_ANY_PAREN_RE = /\(([^()]{1,})\)/g;

/**
 * Fields that are catalog identifiers on a REAL postgres error.
 *
 * The previous comment here read "cannot carry patient data" and the code
 * trusted it, pushing these values raw — bypassing `scrubField`, the
 * pattern sweep, the length cap and the newline flatten. That assertion is
 * true of a postgres error and FALSE of any other object carrying the same
 * property names, which is what `redactPgError(err: unknown)` accepts.
 * Executed leaks (Anita, round 3): `constraint=<email> table=<name>`; a
 * newline in `constraint` forging an entire log line; an unbounded
 * `routine` flooding an unrotated log file.
 *
 * So the invariant is now ENFORCED rather than assumed — see
 * `PG_IDENTIFIER_RE`.
 */
const PG_SAFE_FIELDS = ['code', 'constraint', 'table', 'schema', 'routine', 'severity'] as const;

/**
 * What a catalog identifier can actually look like: unquoted-identifier
 * characters, SQLSTATE digits, or a severity word, bounded by postgres's
 * own NAMEDATALEN limit of 63.
 *
 * Chosen over running these fields through `scrubField`, which was the
 * suggested fix but is not sufficient: `redactFreeText` has no name
 * pattern — this module says so in three separate comments — so
 * `table=Anita Krishnan` survives it intact. A shape whitelist refuses the
 * name outright, and every real diagnostic value passes unchanged
 * (`23505`, `patients_phone_e164_key`, `patients`, `public`,
 * `ExecConstraints`, `ERROR` — all verified in the execution proof).
 *
 * A refused value is reported as `[UNSAFE]` rather than omitted: the
 * operator learns the field was present and rejected, which is diagnostic
 * information that carries no content.
 */
const PG_IDENTIFIER_RE = /^[A-Za-z0-9_$.]{1,63}$/;

/**
 * A run of 7+ digits. The shape whitelist above admits pure-digit strings,
 * so a 10-digit phone or a 12-digit Aadhaar dropped into one of the six
 * catalog fields (`table=9845012345`) would otherwise emit RAW — the very
 * shape `redactFreeText`'s PHONE_RE catches, but these six fields bypass
 * that sweep by design. A real SQLSTATE is 5 digits and every genuine
 * identifier is alphanumeric, so rejecting 7+ consecutive digits costs no
 * diagnostic value. A timestamp-suffixed index name would over-redact to
 * `[UNSAFE]`, which is the fail-safe direction. (Anita, Stage 5.)
 */
const PG_LONG_DIGIT_RUN_RE = /\d{7,}/;

/** `null` when the value is not shaped like a safe catalog identifier. */
function safeCatalogValue(v: string | number): string | null {
  const s = String(v);
  if (!PG_IDENTIFIER_RE.test(s)) return null;
  if (PG_LONG_DIGIT_RUN_RE.test(s)) return null;
  return s;
}

/**
 * `message` and `detail` are truncated INDEPENDENTLY. Joining them and
 * truncating the result meant a long `message` (a Zod dump, an Anthropic
 * error body) evicted `detail` entirely — and `detail` is the field that
 * names the constraint that actually blew up. Karthik, review 2026-07-22.
 */
const MAX_FIELD_CHARS = 200;
/** Frames are file/line/function only. Enough to locate; not a novel. */
const MAX_STACK_FRAMES = 8;
/**
 * Hard ceiling on the frame string. Eight frames of deeply-nested
 * node_modules paths can run to ~900 chars on their own, so the frame
 * count alone does not bound the line. One error must never be able to
 * flood a log file that has no rotation configured.
 */
const MAX_STACK_CHARS = 500;

/**
 * Render any caught value as a single-line, PHI-free string suitable for
 * `console.error`. NEVER pass the raw error object to a logger; pass the
 * result of this instead.
 */
export function redactPgError(err: unknown): string {
  const parts: string[] = [];

  if (err instanceof Error) {
    parts.push(err.name || 'Error');
  } else if (err === null || err === undefined) {
    return `<${String(err)}>`;
  } else if (typeof err !== 'object') {
    // A thrown string/number can itself be PHI (e.g. `throw phone`).
    return scrubField(String(err));
  } else {
    parts.push('NonError');
  }

  const rec = err as Record<string, unknown>;
  for (const f of PG_SAFE_FIELDS) {
    const v = rec[f];
    if (typeof v === 'string' || typeof v === 'number') {
      parts.push(`${f}=${safeCatalogValue(v) ?? '[UNSAFE]'}`);
    }
  }

  const rawMessage = typeof rec['message'] === 'string' ? (rec['message'] as string) : '';
  const rawDetail = typeof rec['detail'] === 'string' ? (rec['detail'] as string) : '';

  const msg = scrubField(rawMessage);
  const detail = scrubField(rawDetail, true);
  if (msg) parts.push(`msg=${JSON.stringify(msg)}`);
  if (detail) parts.push(`detail=${JSON.stringify(detail)}`);

  // STACK FRAMES ARE KEPT. A JS stack frame is file, line, column and
  // function name — it carries no data values, so there is no PHI in it,
  // and dropping it traded a privacy bug for an outage-diagnosis bug.
  // It matters most at the sites that do NOT rethrow into pg-boss (the
  // worker boot handler, the DLQ audit catch, the spawned PDF child, the
  // non-fatal enqueue catch): those swallow or exit, so this line is the
  // only record that will ever exist. Karthik, review 2026-07-22.
  //
  // Frame 0 of `.stack` is `Name: message`, which CAN carry PHI — so it
  // is dropped and only `at …` frames are kept.
  //
  // HOW THE MESSAGE IS SEPARATED FROM THE FRAMES — and why the obvious
  // way is wrong. The round-2 fix anchored on the first line matching
  // `/^\s*at\s/`. That prefix is DATA-CONTROLLED: a message containing
  //
  //     lab OCR failed:
  //     at row 3: <name> | <phone> | <email> | <aadhaar>
  //
  // makes its own continuation line the "first frame", and the whole line
  // — including the name, which `redactFreeText` cannot detect because it
  // has no name pattern — is copied verbatim into `stack=`. Executed and
  // observed 2026-07-30 while fixing the A-2 harness: the name appeared in
  // BOTH `msg=` and `stack=`, and the harness graded itself PASS.
  //
  // So the message is now removed BY CONSTRUCTION rather than by guessing
  // where it ends. `err.stack` begins with exactly `${name}: ${message}`,
  // and we hold both, so we slice that prefix off. Nothing the message
  // contains can survive, whatever it is shaped like.
  if (err instanceof Error && typeof err.stack === 'string') {
    const header = `${err.name}: ${err.message}`;
    const framesOnly = err.stack.startsWith(header)
      ? err.stack.slice(header.length)
      : err.stack;
    const lines = framesOnly.split(/\r?\n/);
    // SECOND, INDEPENDENT FILTER — a real frame carries a `:line:col`
    // position and prose does not.
    //
    // Both are required, and a regression test proves it. Stripping the
    // header alone leaves prose that is NOT part of `err.message`: code
    // may reassign `.stack` wholesale (`e.stack = 'Error: boom\nat row 3:
    // injected prose\n    at Object.h (/srv/app/x.ts:22:48)'`), where the
    // header strips cleanly and the injected line still survives. The
    // position filter alone is likewise insufficient, because a message
    // line can be shaped to carry a fake `:1:1`. Applying both leaves no
    // route in that does not also make the frame unusable as prose.
    //
    // Cost: the positionless frames V8 emits for internals
    // (`at new Promise (<anonymous>)`). They carry no location and no
    // data, so nothing diagnostic is lost.
    const frames = lines
      .map((l) => l.trim())
      .filter((l) => /^at\s/.test(l))
      .filter((l) => /:\d+:\d+\)?$/.test(l))
      .slice(0, MAX_STACK_FRAMES)
      .join(' | ')
      .slice(0, MAX_STACK_CHARS);
    // Pattern sweep applies here too — a function name can be built from
    // data (`at Object.handler_9845012345`).
    //
    // ...but `redactFreeText`'s PHONE_RE needs a word boundary, and `_` IS
    // a word character, so `handler_9845012345` slips straight through it.
    // The Stage-4.5 execution proof caught this; the round-2 fix had only
    // handled the multi-line-message half of the finding. Inside a stack
    // frame a run of 10+ digits is never legitimate — line and column
    // numbers are short — so scrub them unconditionally here, BEFORE the
    // normal sweep. Narrow to this field on purpose: widening the global
    // PHONE_RE to ignore word boundaries would change redaction behaviour
    // for every caller of redactFreeText.
    if (frames) {
      const deGlued = frames.replace(/\d{10,}/g, '[PHONE]');
      parts.push(`stack=${JSON.stringify(redactFreeText(deGlued))}`);
    }
  }

  // One level of `cause`. Node wraps freely (`new Error(msg, { cause })`)
  // and without this the root cause is invisible — e.g. a Vultr 403 and
  // a 20s timeout both surfacing as "signature could not be read".
  // One level only: deep chains would defeat the length cap.
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== null) {
    parts.push(`cause=(${redactPgErrorShallow(cause)})`);
  }

  return parts.join(' ');
}

/**
 * Structural pass, then pattern pass, then flatten to ONE line.
 *
 * Flattening matters operationally: pg messages embed `"` constantly and
 * can contain newlines, so an unescaped interpolation produced multi-line
 * pm2 entries that broke one-line-per-event grep and log shipping. The
 * caller wraps the result in JSON.stringify, which escapes both.
 */
function scrubField(raw: string, denyParens = false): string {
  if (!raw) return '';
  let out = raw
    .replace(PG_KEY_VALUE_RE, 'Key [$1]=([REDACTED])')
    .replace(PG_FAILING_ROW_RE, 'Failing row contains ([REDACTED])');
  // Only for `detail`. `message` legitimately contains parenthesised
  // prose that carries no values, and blanking it there would cost
  // diagnosability for nothing.
  if (denyParens) out = out.replace(PG_ANY_PAREN_RE, (m, inner: string) =>
    inner === 'REDACTED' ? m : '([REDACTED])'
  );
  return redactFreeText(out).replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_CHARS);
}

/** `cause` rendering — no stack, no recursion, so the line stays bounded. */
function redactPgErrorShallow(err: unknown): string {
  if (err === null || err === undefined) return String(err);
  if (typeof err !== 'object') return scrubField(String(err));
  const rec = err as Record<string, unknown>;
  const bits: string[] = [];
  if (err instanceof Error) bits.push(err.name || 'Error');
  // Same enforcement as `redactPgError`. This site was NOT named in the
  // round-3 finding, which cited only the primary loop — but `cause` is
  // rendered here, so PHI in `cause.table` leaked by exactly the same
  // mechanism. Verified by execution (case 4 of the A-1 proof).
  for (const f of PG_SAFE_FIELDS) {
    const v = rec[f];
    if (typeof v === 'string' || typeof v === 'number') {
      bits.push(`${f}=${safeCatalogValue(v) ?? '[UNSAFE]'}`);
    }
  }
  const m = scrubField(typeof rec['message'] === 'string' ? (rec['message'] as string) : '');
  if (m) bits.push(`msg=${JSON.stringify(m)}`);
  return bits.join(' ');
}

/**
 * Compute age in whole years from a date-of-birth value.
 *
 * Returns `null` when DOB is missing or unparseable — the previous
 * version crashed with `Cannot read properties of null (reading
 * 'getFullYear')` because the `as unknown as string` cast at the call
 * sites passed `null` through silently (route_error logs 2026-05-24,
 * 2026-05-25). 127 of 200 production patients have NULL date_of_birth.
 *
 * Schedule H gating happens in lib/rx/schedule-h.ts — a `null` here
 * surfaces as a clear "Patient age is required" validation error
 * before the PDF render is reached.
 */
export function ageInYears(
  dob: Date | string | null | undefined
): number | null {
  if (dob == null) return null;
  const d = typeof dob === 'string' ? new Date(dob) : dob;
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}
