/**
 * CorpusLogger — Phase 1.5 corpus builder.
 *
 * Every inbound patient message's FIRST SENTENCE is emitted to a
 * structured log stream `priya.corpus.inbound_first_sentence` after
 * phone-number scrubbing. This becomes the dataset we use in Phase 1.5
 * to measure real language distribution, deflection-trigger frequency,
 * common intents, and Priya's failure modes.
 *
 * Design principles:
 *   - PHI-safe by construction: phone digits stripped before write.
 *   - No patient names, no contact ids, no Chatwoot URLs — only
 *     conversation id (ephemeral) + hashed conversation fingerprint
 *     for cross-message grouping without re-identification.
 *   - Structured JSON payload inside a single log line so grep/jq work
 *     against stdout without a separate log pipeline.
 *   - Separate log namespace (stream key in the JSON) so ops can
 *     tail/ship just this stream to the corpus sink later.
 *
 * Why first SENTENCE, not full message: the opening line carries the
 * intent; later sentences are usually clarifications/repetitions that
 * bloat the corpus without new signal.
 *
 * Marker: isSelfAuthored
 */

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PhoneExtractor } from '../extractors/phone.extractor';

const STREAM_KEY = 'priya.corpus.inbound_first_sentence';
const MAX_SENTENCE_CHARS = 200;

/**
 * Simple multi-language sentence splitter. Splits on the first of
 * . ? ! । (Devanagari danda, not used here but cheap to include) or
 * a line break. Unicode-safe.
 */
function firstSentence(s: string): string {
  if (!s) return '';
  const trimmed = s.trim();
  const m = trimmed.match(/^[^.?!।\n]+[.?!।]?/);
  const head = (m ? m[0] : trimmed).trim();
  if (head.length > MAX_SENTENCE_CHARS) {
    return head.slice(0, MAX_SENTENCE_CHARS) + '…';
  }
  return head;
}

export interface CorpusRecord {
  stream: typeof STREAM_KEY;
  /** Detected language at time of log (pre- or post-reconcile, caller decides). */
  language: string | null;
  /** 'INSTAGRAM_DM' | 'FACEBOOK_MESSENGER' | 'WHATSAPP_DIRECT'. */
  channel: string;
  /** Ephemeral conversation id — 24h-lifespan, not a long-term identifier. */
  conversationId: number;
  /** Stable fingerprint of accountId+conversationId+contactId (SHA256, 12 chars). */
  convFp: string;
  /** Patient turn number in this conversation, 0-indexed. */
  turn: number;
  /** Character count BEFORE scrub (so we know if the message was long). */
  rawLen: number;
  /** First-sentence text, phone-scrubbed. Never raw digits. */
  sentence: string;
  /** Whether the raw (pre-scrub) message contained ≥1 India mobile match. */
  hadPhone: boolean;
  /** Whether the patient turn had an image attachment. */
  hadImage: boolean;
  /** Whether the patient turn had an audio attachment. */
  hadAudio: boolean;
  /** ISO timestamp. */
  ts: string;
}

@Injectable()
export class CorpusLogger {
  private readonly log = new Logger('priya.corpus');
  private readonly phone = new PhoneExtractor();

  logInboundFirstSentence(input: {
    accountId: number;
    conversationId: number;
    contactId: number;
    channel: string;
    language: string | null;
    turn: number;
    rawText: string;
    hadImage: boolean;
    hadAudio: boolean;
  }): void {
    const rawText = input.rawText || '';
    const head = firstSentence(rawText);
    const scrubbed = this.phone.scrub(head);
    const phoneMatches = this.phone.extractAll(rawText);
    const record: CorpusRecord = {
      stream: STREAM_KEY,
      language: input.language,
      channel: input.channel,
      conversationId: input.conversationId,
      convFp: this.fingerprint(input.accountId, input.conversationId, input.contactId),
      turn: input.turn,
      rawLen: rawText.length,
      sentence: scrubbed,
      hadPhone: phoneMatches.length > 0,
      hadImage: !!input.hadImage,
      hadAudio: !!input.hadAudio,
      ts: new Date().toISOString(),
    };
    // One line, structured — greppable via `grep priya.corpus.inbound_first_sentence`
    // or jq-pipeable after extraction.
    this.log.log(`[${STREAM_KEY}] ${JSON.stringify(record)}`);
  }

  private fingerprint(accountId: number, conversationId: number, contactId: number): string {
    return crypto
      .createHash('sha256')
      .update(`${accountId}:${conversationId}:${contactId}`)
      .digest('hex')
      .slice(0, 12);
  }
}
