/**
 * Claude Sonnet 4.5 lab document extraction.
 *
 * Why Claude over Google Document AI: Indian lab PDFs (Redcliffe, SRL,
 * Lal PathLabs, Thyrocare, Apollo) have wildly inconsistent layouts.
 * A semantic reader handles "Haemoglobin A1c (NGSP)" → hba1c_percent
 * without per-vendor parsers.
 *
 * Pricing (claude-sonnet-4-5-20250929, as of Jan 2026):
 *   Input:  $3.00 / MTok
 *   Output: $15.00 / MTok
 * Typical lab PDF: ~5K input tokens, ~500 output tokens → ~$0.023
 * which is ~₹2 at ₹85/USD. Spec quoted ₹0.25–0.40; actual will be
 * tracked in lab_parse_costs.
 *
 * Anti-PHI: we DO send PHI to Anthropic (patient name appears on the
 * PDF — we cannot strip it without re-rendering). That is acceptable
 * because the patient consented to data processing for clinical care
 * (consent_records.consent_type='portal_intake_v1'). However we MUST
 * NOT log the PDF contents or the Claude response body at INFO level
 * — only token counts + sanitised summary fields.
 */
// `import 'server-only'` removed — pulled into queue worker via
// lib/jobs/parse-lab-upload.ts. See parse-lab-upload.ts header.
import Anthropic from '@anthropic-ai/sdk';
import { LAB_SYSTEM_PROMPT, buildLabUserPrompt } from './prompt';
import { labExtractionSchema, type LabExtraction } from './schema';
import { prepareLabImage, LabImagePrepareError } from './prepare-image';

export const LAB_PARSE_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 60_000;

// Per-million-token USD pricing for the model above.
const PRICE_INPUT_PER_MTOK = 3.0;
const PRICE_OUTPUT_PER_MTOK = 15.0;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LabParseError('config', 'ANTHROPIC_API_KEY not set');
  _client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  return _client;
}

export class LabParseError extends Error {
  constructor(
    public reason:
      | 'config'
      | 'api'
      | 'timeout'
      | 'invalid_response'
      | 'schema'
      // P1.7b — sharp couldn't prepare a photo for Claude's image cap.
      // R4 (2026-08-10 round-1 review, Karthik BLOCKER): this is now the
      // SPECIFIC prepare-image.ts reason, not a collapsed 'image_prepare'
      // bucket. The previous collapse meant EVERY sharp failure — including
      // a transient resource-exhaustion error — was treated as a permanent
      // failure of this specific input. Only 'too_many_pixels' and
      // 'irreducible' are genuinely properties of the bytes; 'decode_failed'
      // and 'resource' are retryable — see lib/jobs/parse-lab-upload.ts's
      // classification.
      | 'too_many_pixels'
      | 'decode_failed'
      | 'irreducible'
      | 'resource',
    message?: string
  ) {
    super(message ?? reason);
  }
}

export interface ExtractResult {
  extraction: LabExtraction;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  source: 'pdf' | 'image';
  legibility: 'clear' | 'partial' | 'poor' | null;
}

function calcCostUsd(input: number, output: number): number {
  const cents =
    (input / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (output / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  // Round to 5 decimal places (matches lab_parse_costs.cost_usd precision).
  return Math.round(cents * 100_000) / 100_000;
}

/*
 * NOTE (P1.26(a), 2026-07-22): this function deliberately does NOT take
 * a filename. It used to, solely to interpolate it into the user-turn
 * text — which shipped the patient's name to Anthropic on every parse
 * (Stone Rule #13). The parameter is gone rather than ignored so it
 * cannot be quietly reintroduced.
 *
 * `source` is REQUIRED (P1.7b), not defaulted, so no call site can
 * silently keep sending everything as a PDF document block once photo
 * uploads start arriving — a photo sent as `type: 'document'` fails the
 * Anthropic API outright rather than degrading gracefully.
 */
export async function extractLabValues(
  buf: Buffer,
  source: 'pdf' | 'image'
): Promise<ExtractResult> {
  const client = getClient();
  const startedAt = Date.now();

  let contentBlock: Anthropic.Messages.ContentBlockParam;
  if (source === 'pdf') {
    contentBlock = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: buf.toString('base64')
      }
    };
  } else {
    let prepared;
    try {
      prepared = await prepareLabImage(buf);
    } catch (err) {
      if (err instanceof LabImagePrepareError) {
        // R4: propagate the SPECIFIC prepare-image reason, not a
        // collapsed 'image_prepare' bucket — parse-lab-upload.ts's
        // permanent-vs-retryable classification depends on it.
        throw new LabParseError(err.reason, err.message);
      }
      throw err;
    }
    contentBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: prepared.mediaType,
        data: prepared.base64
      }
    };
  }

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: LAB_PARSE_MODEL,
      max_tokens: MAX_TOKENS,
      system: LAB_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [contentBlock, { type: 'text', text: buildLabUserPrompt() }]
        }
      ]
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new LabParseError('timeout', 'anthropic_timeout');
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new LabParseError('api', msg);
  }
  const durationMs = Date.now() - startedAt;

  const first = message.content[0];
  if (!first || first.type !== 'text') {
    throw new LabParseError('invalid_response', 'no_text_in_response');
  }

  // Strip accidental markdown fences before JSON.parse.
  const jsonStr = first.text.replace(/```json\s*|```\s*$/g, '').trim();
  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch (err) {
    throw new LabParseError('invalid_response', 'json_parse_failed');
  }

  const parsed = labExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LabParseError('schema', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;
  return {
    extraction: parsed.data,
    model: LAB_PARSE_MODEL,
    inputTokens,
    outputTokens,
    costUsd: calcCostUsd(inputTokens, outputTokens),
    durationMs,
    source,
    legibility: parsed.data.legibility ?? null
  };
}
