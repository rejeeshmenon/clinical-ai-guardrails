/**
 * Prepares a lab-report PHOTO for Claude's image content block (P1.7a).
 *
 * WHY THIS IS REQUIRED, NOT AN OPTIMISATION: Claude's image content
 * blocks cap at 3.75 MB base64-source / 8000px per side, and Claude
 * internally downscales anything larger to a 1568px longest edge before
 * it ever reads it. Our own upload cap is 10 MB
 * (lib/patient-storage/validate-file.ts:20) and a phone JPEG routinely
 * exceeds 3.75 MB — sent as-is, the Anthropic API call fails outright
 * (not "processes it inefficiently"). This module is what stands between
 * a phone photo and a hard API failure.
 *
 * sharp@0.34.5 is already a dependency (package.json) and already used
 * for image normalisation in lib/pdf/signature-cache.ts — this module
 * matches that file's `{ limitInputPixels, sequentialRead: true }` option
 * style for the same reason: bound the decoder (pixel count), not just
 * the transfer (byte count), against a decompression-bomb input.
 *
 * `.rotate()` with NO arguments applies the EXIF orientation tag.
 * Critical: iPhone photos are almost always stored rotated with an
 * orientation tag set rather than pixels physically rotated — without
 * this step Claude reads a sideways lab report.
 *
 * HEIC IS DELIBERATELY OUT OF SCOPE. sharp's prebuilt binary ships
 * without libheif for patent-licensing reasons, and
 * lib/patient-storage/validate-file.ts:21 already rejects HEIC at the
 * upload door — an iPhone photographing in HEIC format never reaches
 * this module today. A follow-on item if/when we add HEIC support
 * upstream.
 *
 * PHI: this module NEVER logs image bytes, dimensions with patient
 * context, or any decoded content. It has no console.* calls at all —
 * keep it that way. (Stone Rule #16 — PHI is never logged.)
 */
import sharp from 'sharp';

/** Claude's hard cap on base64-encoded image source bytes. */
export const CLAUDE_MAX_IMAGE_BYTES = 3_750_000;
/** Claude downscales to this longest edge internally — matching it here wastes zero bytes. */
export const CLAUDE_TARGET_LONG_EDGE = 1568;
/**
 * Decompression-bomb guard on the DECODER (pixel count), independent of
 * the transfer byte cap.
 *
 * R3 (Karthik BLOCKER, 2026-08-10 round-1 review): was 50,000,000. Measured
 * on this VPS (2vCPU/4GB, worker module graph 258 MB resident, pm2 cap
 * 600M): a 198 KB flat PNG at 50 MP drove a ~233 MB transient RSS spike
 * through the real prepareLabImage — a single concurrent Rx render in the
 * same window could breach the pm2 memory cap, SIGKILL the job mid-parse,
 * and re-queue it to fail identically an hour later (the INC-010
 * crash-loop shape). Lowered to 16,000,000 (16 MP): the proof's own
 * phone-photo-scale fixture is 4000x3000 = 12 MP, so every camera this
 * module targets stays comfortably under the new ceiling, while an
 * adversarial/malformed image claiming >16 MP is rejected before decode.
 *
 * Compare lib/pdf/signature-cache.ts's MAX_SIGNATURE_PIXELS = 4,000,000
 * (for a 2 MB byte cap). The two are not meant to be numerically identical
 * — a signature scan and a photographed A4/letter lab report are
 * different content classes with different legitimate resolutions — but
 * the RATIO to each module's own byte cap should be similar in spirit:
 * signature caps ~2 pixels/byte-cap-unit (4,000,000 / 2,000,000), this
 * module now caps ~4.3 pixels/byte-cap-unit (16,000,000 / 3,750,000).
 * Slightly more generous is deliberate — a lab report photo legitimately
 * needs more resolution to keep small print legible than a signature scan
 * does — while still roughly halving the worst-case transient RSS of the
 * previous 50 MP ceiling (scripts/proof/p17-lab-image-prepare.ts prints
 * the measured before/after).
 */
export const MAX_INPUT_PIXELS = 16_000_000;

/** Long edge used for the final rung of the reduction ladder. */
const FALLBACK_LONG_EDGE = 1024;
/** Quality rungs tried, in order, after the initial pass at quality 85. */
const QUALITY_LADDER = [70, 55] as const;
/** Quality used for the final long-edge-reduced rung. */
const FALLBACK_QUALITY = 70;

export class LabImagePrepareError extends Error {
  constructor(
    /**
     * R4 (Karthik BLOCKER, 2026-08-10 round-1 review): 'resource' is a NEW
     * reason, distinct from 'decode_failed'. Before this fix, every sharp
     * error that was not the pixel-limit guard collapsed into
     * 'decode_failed' — including a transient libvips allocation failure
     * under memory pressure (exactly R3's load condition). Upstream,
     * lib/jobs/parse-lab-upload.ts treated ANY image_prepare failure as
     * PERMANENT (no retry, no DLQ), so a legitimate lab photo that merely
     * arrived during a memory-pressure moment permanently forfeited its
     * parse with no re-parse path anywhere in the app.
     *
     * Only 'too_many_pixels' and 'irreducible' are genuinely PROPERTIES OF
     * THE BYTES — retrying the exact same input cannot change the outcome.
     * 'decode_failed' (truly corrupt/non-image bytes) and 'resource'
     * (transient allocation pressure) are NOT properties of the bytes in
     * the same way a decode failure under load may succeed on retry once
     * memory pressure clears — see parse-lab-upload.ts's classification.
     */
    public reason: 'too_many_pixels' | 'decode_failed' | 'irreducible' | 'resource',
    message?: string
  ) {
    super(message ?? reason);
  }
}

/**
 * Heuristic match for libvips/Node resource-exhaustion errors (allocation
 * failure, file-descriptor exhaustion, etc.) as opposed to a genuinely
 * corrupt/non-image input. Sharp/libvips do not expose a structured error
 * code for this distinction, so this is pattern-matched on the message —
 * deliberately broad (a false 'resource' classification only costs an
 * extra pg-boss retry; a false 'decode_failed' classification permanently
 * drops a legitimate photo that merely hit a bad moment).
 */
const RESOURCE_ERROR_RE = /memory|alloc|resource|too many open files|enomem|eagain|emfile|enfile/i;

export interface PreparedImage {
  base64: string;
  mediaType: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
  qualityUsed: number;
}

interface Encoded {
  data: Buffer;
  width: number;
  height: number;
}

async function encodeAt(buf: Buffer, longEdge: number, quality: number): Promise<Encoded> {
  let data: Buffer;
  try {
    data = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true })
      .rotate()
      .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/exceeds pixel limit/i.test(msg)) {
      throw new LabImagePrepareError(
        'too_many_pixels',
        'input image exceeds the decompression-bomb pixel guard'
      );
    }
    if (RESOURCE_ERROR_RE.test(msg)) {
      throw new LabImagePrepareError(
        'resource',
        'transient resource pressure while decoding the image — retryable'
      );
    }
    throw new LabImagePrepareError('decode_failed', 'input image could not be decoded');
  }
  // A second, cheap metadata read on the (already small) output — sharp
  // does not return final post-resize dimensions from the pipeline itself
  // when `.rotate()` may have transposed width/height.
  const meta = await sharp(data).metadata();
  return { data, width: meta.width ?? 0, height: meta.height ?? 0 };
}

/**
 * Reduce an arbitrary source image (JPEG/PNG, any orientation) to a
 * Claude-ready JPEG: EXIF-corrected, capped at CLAUDE_TARGET_LONG_EDGE on
 * its longest edge, and under CLAUDE_MAX_IMAGE_BYTES. Throws
 * LabImagePrepareError('irreducible') if even the most aggressive rung
 * still exceeds the byte cap (pathological — e.g. an adversarial noise
 * image that resists JPEG compression).
 */
export async function prepareLabImage(buf: Buffer): Promise<PreparedImage> {
  const first = await encodeAt(buf, CLAUDE_TARGET_LONG_EDGE, 85);
  if (first.data.length <= CLAUDE_MAX_IMAGE_BYTES) {
    return {
      base64: first.data.toString('base64'),
      mediaType: 'image/jpeg',
      width: first.width,
      height: first.height,
      bytes: first.data.length,
      qualityUsed: 85
    };
  }

  for (const quality of QUALITY_LADDER) {
    const attempt = await encodeAt(buf, CLAUDE_TARGET_LONG_EDGE, quality);
    if (attempt.data.length <= CLAUDE_MAX_IMAGE_BYTES) {
      return {
        base64: attempt.data.toString('base64'),
        mediaType: 'image/jpeg',
        width: attempt.width,
        height: attempt.height,
        bytes: attempt.data.length,
        qualityUsed: quality
      };
    }
  }

  const last = await encodeAt(buf, FALLBACK_LONG_EDGE, FALLBACK_QUALITY);
  if (last.data.length <= CLAUDE_MAX_IMAGE_BYTES) {
    return {
      base64: last.data.toString('base64'),
      mediaType: 'image/jpeg',
      width: last.width,
      height: last.height,
      bytes: last.data.length,
      qualityUsed: FALLBACK_QUALITY
    };
  }

  throw new LabImagePrepareError(
    'irreducible',
    `could not reduce image below ${CLAUDE_MAX_IMAGE_BYTES} bytes`
  );
}
