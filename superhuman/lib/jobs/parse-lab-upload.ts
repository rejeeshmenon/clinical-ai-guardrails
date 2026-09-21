/**
 * pg-boss job: parse a patient lab upload via Claude Sonnet 4.5.
 *
 * Phase 22 PR-3 / Stone Rule #39 — AI lab parsing is ASSISTIVE, not
 * authoritative. This job no longer writes to lab_results directly.
 * Instead, it inserts one row into lab_parse_results with
 * status='pending_review'. A physician or dietitian must click Verify
 * in the patient drawer (or chart labs page) before the values flow
 * into lab_results via lib/lab-parsing/commit.ts.
 *
 * Flow:
 *   1. Fetch patient_lab_uploads row.
 *   2. If mime is not one of {application/pdf, image/jpeg, image/png}:
 *      mark skipped ('unsupported_format_manual_review'), notify
 *      dietitian, exit.
 *   3. If mime is an image AND the LAB_IMAGE_PARSE=off reversibility
 *      switch is set (lib/labs/lab-image-parse-flag.ts): mark skipped
 *      ('image_manual_review'), notify dietitian, exit — the pre-P1.7b
 *      behaviour, kept reachable without a redeploy.
 *   4. Else (application/pdf, or image/* with the switch on — P1.7b):
 *      a. Download bytes from Vultr Object Storage.
 *      b. Call lib/lab-parsing/claude.ts extractLabValues(buf, source),
 *         where source is 'pdf' or 'image'. For images, extractLabValues
 *         internally runs lib/lab-parsing/prepare-image.ts before the
 *         API call.
 *      c. On success: insert into lab_parse_results (status=
 *         'pending_review'). Mark upload parse_status='success' since
 *         the upload was processed — the staged interpretation is the
 *         unit of success at this step. Notify dietitian to review; for
 *         image sources the notification detail names the photo
 *         provenance explicitly (Sara — a photo-derived value must not
 *         look identical to a PDF-derived one in the review queue).
 *      d. On ZodError/JSON parse failure, OR a prepare-image failure that
 *         is genuinely a property of the bytes (too_many_pixels,
 *         irreducible): parse_status='failed' — PERMANENT, not retried.
 *         R4 fix (2026-08-10): a prepare-image failure that is NOT a
 *         property of the bytes (decode_failed, resource — see
 *         lib/lab-parsing/prepare-image.ts's LabImagePrepareError doc)
 *         falls through to (e) instead and DOES retry.
 *      e. On Anthropic API error, or a retryable prepare-image failure:
 *         re-throw so pg-boss retries with backoff (max 3, then DLQ —
 *         Stone Rule #44).
 *
 * Confidence (P1.8): lib/lab-parsing/confidence.ts replaces the previous
 * hardcoded 0.95/0.9 stamps with a deterministic function of source
 * (pdf/image), legibility, mapped-vs-extra, and an OCR-sanity plausibility
 * check. This is DISPLAY-ONLY signal for the human verifier — it gates
 * nothing (Stone Rule #39's mandatory Verify + out-of-range block in
 * lib/lab-parsing/commit.ts are unchanged and remain the only gates).
 *
 * Anti-PHI logging: model + token counts are logged; the actual extracted
 * values and the Claude response body are NOT logged. The raw_text_excerpt
 * from Claude (first 200 chars of PDF text) is stored in
 * lab_parse_results.raw_text for audit but never emitted to console.
 */
// NOTE: `import 'server-only'` removed (2026-05-27). pg-boss queue
// handlers are imported by workers/queue-worker.ts (a vanilla Node
// CLI under tsx), where `server-only` throws "cannot be imported
// from a Client Component" because there's no Next.js RSC layer to
// short-circuit it. This file is only ever consumed by the queue
// worker — it has no React surface and cannot be bundled into the
// client by construction (no React imports, drizzle/pg/Anthropic SDK
// are server-only at the package level).
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  labParseCosts,
  labParseResults,
  patientLabUploads
} from '../db/schema';
import { extractLabValues, LabParseError } from '../lab-parsing/claude';
import {
  computeValueConfidence,
  computeOverallConfidence,
  resolveLegibility
} from '../lab-parsing/confidence';
import { buildParsedValues } from '../lab-parsing/build-values';
import { notifyDietitian } from '../patient-notifications/notify-dietitian';
import { getObjectBuffer } from '../storage/s3';
import { isImageParseEnabled } from '../labs/lab-image-parse-flag';

interface JobPayload {
  patientLabUploadId: string;
}

// The canonical + extra analyte mappings, the unit-mismatch guard, and the
// parsed_values builder now live in lib/lab-parsing/build-values.ts (P1.9),
// so the unit logic is unit-testable without this job's DB/storage deps.

function buildDetail(values: Array<{ parameter: string; value: number; unit: string }>): string {
  return values.slice(0, 4).map((v) => `${v.parameter} ${v.value}${v.unit === '%' ? '%' : ''}`).join(' · ');
}

export async function parseLabUpload(payload: JobPayload): Promise<void> {
  const [upload] = await db
    .select()
    .from(patientLabUploads)
    .where(eq(patientLabUploads.id, payload.patientLabUploadId));
  if (!upload) {
    throw new Error(`lab_upload_not_found:${payload.patientLabUploadId}`);
  }

  // Idempotency guard — audit C9 enabled retryLimit:3 on this queue
  // (Priya, 2026-05-28). A retry after a partial failure (e.g. the
  // staging INSERT succeeded but the subsequent patientLabUploads UPDATE
  // threw) must NOT stage a second pending_review row for the same PDF —
  // that would surface duplicate cards in the dietitian queue and risk
  // two lab_results from one report. If any staging row already exists
  // for this upload, a prior attempt already parsed it: no-op.
  const [existingStage] = await db
    .select({ id: labParseResults.id })
    .from(labParseResults)
    .where(eq(labParseResults.labUploadId, upload.id))
    .limit(1);
  if (existingStage) {
    console.warn(
      `parse-lab-upload ${upload.id}: staging row already exists — skipping re-parse (idempotent retry)`
    );
    return;
  }

  // MIME gate. Only these three ever reach Claude; anything else was
  // accepted at upload time by validate-file.ts's own allowlist so in
  // practice this should never fire, but a defensive skip beats a thrown
  // error reaching pg-boss retry.
  const PARSEABLE_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
  if (!PARSEABLE_MIME.has(upload.mimeType)) {
    await db
      .update(patientLabUploads)
      .set({
        parseStatus: 'skipped',
        parseSkippedReason: 'unsupported_format_manual_review',
        parsedAt: sql`NOW()`
      })
      .where(eq(patientLabUploads.id, upload.id));
    // R7: no ${upload.originalName} — see the header comment above the
    // schema-failure notify call for why filenames are routinely PHI.
    await notifyDietitian({
      patientId: upload.patientId,
      event: 'lab_uploaded',
      detail: 'Unsupported format — manual review',
      emrPath: `/patients/${upload.patientId}#labs`
    }).catch((e) => console.warn(`notify_dietitian_failed: ${e?.message ?? e}`));
    return;
  }

  const source: 'pdf' | 'image' = upload.mimeType === 'application/pdf' ? 'pdf' : 'image';

  // Reversibility switch (P1.7b) — images fall back to the pre-P1.7b
  // manual-review path when LAB_IMAGE_PARSE=off. PDFs are never gated by
  // this switch.
  if (source === 'image' && !isImageParseEnabled()) {
    await db
      .update(patientLabUploads)
      .set({
        parseStatus: 'skipped',
        parseSkippedReason: 'image_manual_review',
        parsedAt: sql`NOW()`
      })
      .where(eq(patientLabUploads.id, upload.id));
    // R7: no ${upload.originalName} — filenames are routinely PHI.
    await notifyDietitian({
      patientId: upload.patientId,
      event: 'lab_uploaded',
      detail: 'Image — manual review',
      emrPath: `/patients/${upload.patientId}#labs`
    }).catch((e) => console.warn(`notify_dietitian_failed: ${e?.message ?? e}`));
    return;
  }

  // Mark pending so the UI shows "Parsing" rather than "Awaiting review".
  await db
    .update(patientLabUploads)
    .set({ parseStatus: 'pending' })
    .where(eq(patientLabUploads.id, upload.id));

  // Suffix applied to dietitian-facing detail strings for photo-derived
  // results, so a photo-sourced value never LOOKS identical to a
  // PDF-sourced one in the review queue (Sara).
  const provenanceSuffix = source === 'image' ? ' (from photo — verify against the original)' : '';

  let extraction;
  try {
    const sourceBuf = await getObjectBuffer({
      bucket: upload.objectBucket,
      key: upload.objectKey
    });
    // No filename passed — it is the patient's name often enough that
    // sending it to Anthropic was a Stone Rule #13 violation (P1.26(a)).
    extraction = await extractLabValues(sourceBuf, source);
  } catch (err) {
    if (err instanceof LabParseError) {
      // schema/invalid_response → permanent failure, not retried.
      //
      // Of the prepare-image (P1.7b) reasons, only 'too_many_pixels' and
      // 'irreducible' are genuinely PROPERTIES OF THE BYTES — retrying the
      // exact same input cannot change the outcome, so pg-boss must not
      // burn its retry budget on them.
      //
      // R4 fix (Karthik BLOCKER, 2026-08-10 round-1 review): 'decode_failed'
      // and 'resource' are DELIBERATELY EXCLUDED from this permanent set —
      // they fall through to the `throw err` below and retry with backoff.
      // Before this fix, every prepare-image failure (including a
      // transient libvips allocation error under memory pressure — exactly
      // R3's load condition) was collapsed into a single 'image_prepare'
      // reason and treated as permanent, with no re-parse path anywhere in
      // the app. A legitimate lab photo that merely arrived during a
      // memory-pressure moment lost its parse forever.
      if (
        err.reason === 'schema' ||
        err.reason === 'invalid_response' ||
        err.reason === 'too_many_pixels' ||
        err.reason === 'irreducible'
      ) {
        await db
          .update(patientLabUploads)
          .set({
            parseStatus: 'failed',
            parseSkippedReason: `extraction_validation_failed:${err.reason}`,
            parsedAt: sql`NOW()`
          })
          .where(eq(patientLabUploads.id, upload.id));
        await notifyDietitian({
          patientId: upload.patientId,
          // R7 (Anita CONCERN, 2026-08-10 round-1 review): dropped
          // ${upload.originalName} from this detail string. Lab report
          // filenames are routinely the patient's own name (P1.26(a)'s
          // `SMT.<FIRSTNAME> <LASTNAME>.pdf` shape) — this was a NEW branch
          // in the P1.7b diff putting that exact pattern onto the Meta
          // WhatsApp Cloud API wire. The dietitian gets the deep link
          // regardless; the filename adds nothing.
          event: 'lab_uploaded',
          detail: `Auto-parse failed — review manually${provenanceSuffix}`,
          emrPath: `/patients/${upload.patientId}#labs`
        }).catch(() => {});
        console.warn(
          `parse_lab_upload schema_failure id=${upload.id} reason=${err.reason}`
        );
        return;
      }
      // config/api/timeout/decode_failed/resource → throw so pg-boss
      // retries with backoff (and eventually DLQs — Stone Rule #44).
      throw err;
    }
    throw err;
  }

  const v = extraction.extraction.values as Record<string, number | null | undefined>;

  // P1.8 — honest, deterministic confidence. resolveLegibility defaults a
  // PDF with no reported legibility to 'clear' (today's pre-P1.8
  // behaviour) and an image with no reported legibility to 'partial' —
  // never assume a photo was clear. See confidence.ts's header comment:
  // this is DISPLAY-ONLY signal for the human verifier, it gates nothing.
  const legibility = resolveLegibility(source, extraction.legibility);

  // Build the parsed_values payload. Each non-null parameter becomes one
  // entry; mappedField links to the lab_results column it will populate at
  // verify time (null mappedField means "preserve in lab_results.raw").
  // P1.9: a value whose REPORTED unit does not match the canonical unit is
  // routed to raw (never the typed column), labelled with the reported unit,
  // and marked for manual verification — see build-values.ts.
  const parsedValues = buildParsedValues(
    v,
    extraction.extraction.value_units,
    source,
    legibility
  );

  // Overall = the minimum of the per-value confidences (a report is only
  // as trustworthy as its least legible value). When nothing at all was
  // extracted, fall back to the source+legibility baseline (there are no
  // per-value confidences to take the minimum of). The fallback key is
  // deliberately not in PLAUSIBLE_BANDS, so it carries no plausibility
  // penalty — this is a baseline, not a value judgement.
  const fallbackConfidence = computeValueConfidence({
    source,
    legibility,
    key: '__no_values_extracted__',
    value: 0,
    mapped: true
  });
  const overallConfidence = computeOverallConfidence(
    parsedValues.map((p) => p.confidence),
    fallbackConfidence
  );

  // Stage the result. status='pending_review' is the default; the
  // verify API will flip it to 'verified' and write the matching
  // lab_results row in a single transaction.
  //
  // PHI-MINIMISATION (Anita, Stone Rule #39 sub-rule):
  //   We never persist raw_text_excerpt or patient_name_on_report into
  //   lab_parse_results. The Claude prompt was updated to NOT extract
  //   those fields. If a stale queue item still returns them (rare —
  //   pg-boss respawns within hours of the prompt change), we discard
  //   them here. The verifier downloads the source PDF from Object
  //   Storage (audited via 'lab.downloaded') if they need to cross-
  //   check values against the report header.
  const reportDate = extraction.extraction.report_date;
  await db.insert(labParseResults).values({
    labUploadId: upload.id,
    patientId: upload.patientId,
    collectedDate: reportDate ?? null,
    labName: extraction.extraction.lab_name ?? null,
    patientNameOnReport: null,
    parsedValues,
    rawText: null,
    // NUMERIC(3,2) column — 2dp fits within the [0.05, 0.95] range
    // produced by computeOverallConfidence/computeValueConfidence.
    overallConfidence: overallConfidence.toFixed(2),
    status: 'pending_review'
  });

  await db
    .update(patientLabUploads)
    .set({
      parseStatus: 'success',
      parsedAt: sql`NOW()`,
      parsedDocumentId: extraction.model,
      // NOT yet committed to lab_results — set on verify.
      labResultId: null
    })
    .where(eq(patientLabUploads.id, upload.id));

  // Cost log — separate try/catch so a logging failure doesn't undo
  // the parse_status update.
  try {
    await db.insert(labParseCosts).values({
      uploadId: upload.id,
      model: extraction.model,
      inputTokens: extraction.inputTokens,
      outputTokens: extraction.outputTokens,
      costUsd: extraction.costUsd.toFixed(5),
      durationMs: extraction.durationMs
    });
  } catch (err) {
    console.warn(
      `lab_parse_cost_log_failed id=${upload.id}: ${err instanceof Error ? err.message : err}`
    );
  }

  // R7: no ${upload.originalName} fallback — filenames are routinely PHI.
  await notifyDietitian({
    patientId: upload.patientId,
    event: 'lab_uploaded',
    detail: `${buildDetail(parsedValues) || 'Review pending'}${provenanceSuffix}`,
    emrPath: `/patients/${upload.patientId}#labs`
  }).catch((e) => console.warn(`notify_dietitian_failed: ${e?.message ?? e}`));
}
