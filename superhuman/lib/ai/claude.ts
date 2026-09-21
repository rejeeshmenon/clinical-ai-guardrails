/**
 * Claude Haiku 4.5 wrapper.
 *
 * Stone rule #12: AI is fail-closed for clinical paths. If the API is
 * down, times out (>10s), or errors → caller must continue without AI.
 * Never block the clinical workflow.
 *
 * Server-only — never imported in client code.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL_ID = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 10_000;
const MAX_TOKENS_OUT = 1024;

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeUnavailableError('missing_api_key');
  }
  _client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  return _client;
}

export class ClaudeUnavailableError extends Error {
  constructor(public reason: 'missing_api_key' | 'timeout' | 'api_error' | 'rate_limited' | 'other', message?: string) {
    super(message ?? reason);
  }
}

export interface ClaudeMessageInput {
  system: string;
  user: string;
}

export interface ClaudeMessageResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Cost in USD as Anthropic-billed (approx). */
  costUsd: number;
}

// Approximate billing rates per 1M tokens for Haiku 4.5 (placeholder; verify on billing dashboard).
const PRICE_PER_M_IN = 1.0;   // USD / 1M input tokens
const PRICE_PER_M_OUT = 5.0;  // USD / 1M output tokens

export async function claudeMessage(
  input: ClaudeMessageInput
): Promise<ClaudeMessageResult> {
  const client = getClient();
  try {
    const resp = await client.messages.create({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS_OUT,
      system: input.system,
      messages: [{ role: 'user', content: input.user }]
    });
    const text = resp.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim();
    const tokensIn = resp.usage.input_tokens;
    const tokensOut = resp.usage.output_tokens;
    const costUsd =
      (tokensIn * PRICE_PER_M_IN + tokensOut * PRICE_PER_M_OUT) / 1_000_000;
    return { text, model: MODEL_ID, tokensIn, tokensOut, costUsd };
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ClaudeUnavailableError('timeout');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ClaudeUnavailableError('rate_limited');
    }
    if (err instanceof Anthropic.APIError) {
      throw new ClaudeUnavailableError('api_error', err.message);
    }
    throw new ClaudeUnavailableError('other', String(err));
  }
}

export const CLAUDE_MODEL_ID = MODEL_ID;
