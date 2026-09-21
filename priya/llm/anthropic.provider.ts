/**
 * AnthropicProvider — Messages API wrapper for Priya.
 *
 * Uses axios directly (no @anthropic-ai/sdk dep) to keep the Docker
 * image lean and match the repo convention (other outbound HTTP in
 * nestjs-src all uses axios).
 *
 * Contract:
 *   - model: claude-haiku-4-5-20251001 (pinned; upgrade via PR, not env)
 *   - max_tokens: 400 (Priya never needs more than 4 sentences)
 *   - system: array form with cache_control on the single large block —
 *     enables prompt caching when prefix >= 4096 tokens (Haiku minimum)
 *   - 6s request timeout, one retry at 1s delay on 5xx or timeout
 *   - returns { text, usage } — usage is the raw Anthropic usage object,
 *     fed directly to CostTracker.record()
 *
 * Error modes:
 *   - AnthropicTimeoutError — both attempts timed out
 *   - AnthropicServerError  — both attempts returned 5xx
 *   - AnthropicClientError  — 4xx from Anthropic (bad request, no retry)
 * Orchestrator catches these and triggers the fallback handoff.
 *
 * Image handling:
 *   - If turn.imageUrl is set, the user content becomes [image, text]
 *   - Claude Haiku 4.5 supports vision via URL or base64. We send URL
 *     (Chatwoot data_url) first; URL may fail if Chatwoot is private to
 *     the VPC. Section 7 can add base64 download fallback.
 *
 * Marker: isSelfAuthored
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { MessageLogEntry, PriyaLanguage } from '../state/state.interface';
import {
  AnthropicCircuitBreaker,
  CircuitOpenError,
} from './anthropic-circuit-breaker';

export { CircuitOpenError } from './anthropic-circuit-breaker';

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 400;
const REQUEST_TIMEOUT_MS = 6000;
const RETRY_DELAY_MS = 1000;

export class AnthropicTimeoutError extends Error {
  constructor(message = 'anthropic timeout') {
    super(message);
    this.name = 'AnthropicTimeoutError';
  }
}
export class AnthropicServerError extends Error {
  constructor(message = 'anthropic 5xx') {
    super(message);
    this.name = 'AnthropicServerError';
  }
}
export class AnthropicClientError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'AnthropicClientError';
  }
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ChatInput {
  systemPrompt: string;
  history: MessageLogEntry[];
  currentTurn: {
    content: string;
    language: PriyaLanguage | null;
    imageUrl?: string;
  };
}

export interface ChatOutput {
  text: string;
  usage: AnthropicUsage;
  model: string;
  latencyMs: number;
}

@Injectable()
export class AnthropicProvider {
  private readonly log = new Logger(AnthropicProvider.name);
  private readonly client: AxiosInstance | null = null;
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly breaker: AnthropicCircuitBreaker,
  ) {
    this.apiKey = (this.config.get<string>('ANTHROPIC_API_KEY') || '').trim();
    if (this.apiKey) {
      this.client = axios.create({
        baseURL: 'https://api.anthropic.com',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
      this.log.log(`[priya-llm] initialised model=${ANTHROPIC_MODEL}`);
    } else {
      this.log.warn(
        '[priya-llm] ANTHROPIC_API_KEY not set — provider will refuse every call',
      );
    }
  }

  isEnabled(): boolean {
    return !!this.client;
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    if (!this.client) {
      throw new AnthropicClientError(0, 'anthropic client not configured');
    }

    // Circuit breaker gate — throws CircuitOpenError immediately when
    // open (no API call, no latency, no cost). Section §8 clarification:
    // the breaker counts FINAL failures after retry, so the 1-retry in
    // callWithRetry below runs first.
    this.breaker.guard();

    const body = this.buildRequestBody(input);
    const start = Date.now();
    try {
      const data = await this.callWithRetry(body);
      const text = this.extractText(data);
      const usage: AnthropicUsage = {
        input_tokens: data?.usage?.input_tokens ?? 0,
        output_tokens: data?.usage?.output_tokens ?? 0,
        cache_creation_input_tokens:
          data?.usage?.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens:
          data?.usage?.cache_read_input_tokens ?? 0,
      };
      const latencyMs = Date.now() - start;
      this.breaker.onSuccess();
      return { text, usage, model: data?.model ?? ANTHROPIC_MODEL, latencyMs };
    } catch (err) {
      // Only bump breaker on infra failures (timeout / 5xx / network).
      // AnthropicClientError is 4xx — a request shape problem, not an
      // upstream outage. Don't let a bad request flip the breaker.
      if (
        err instanceof AnthropicTimeoutError ||
        err instanceof AnthropicServerError
      ) {
        this.breaker.onFailure();
      }
      throw err;
    }
  }

  /**
   * Exposed for the cache-verify harness + section 8 health check. The
   * orchestrator does NOT call this directly.
   */
  buildRequestBody(input: ChatInput): any {
    const userContent = this.buildUserContent(input);
    const messages = [
      ...input.history.map((h) => ({
        role: h.t === 'in' ? 'user' : 'assistant',
        content: h.text,
      })),
      { role: 'user', content: userContent },
    ];
    return {
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: input.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages,
    };
  }

  private buildUserContent(input: ChatInput): any {
    const stateHint =
      `language_detected: ${input.currentTurn.language ?? 'en'}\n` +
      `message: ${input.currentTurn.content || '(no text)'}`;
    if (!input.currentTurn.imageUrl) {
      return stateHint;
    }
    // Multimodal content block — URL source; section 7 adds base64 fallback.
    return [
      {
        type: 'image',
        source: { type: 'url', url: input.currentTurn.imageUrl },
      },
      { type: 'text', text: stateHint },
    ];
  }

  private async callWithRetry(body: any): Promise<any> {
    try {
      const res = await this.client!.post('/v1/messages', body);
      return res.data;
    } catch (err) {
      const classified = this.classifyError(err);
      if (classified instanceof AnthropicClientError) {
        // 4xx — no retry
        throw classified;
      }
      this.log.warn(
        `[priya-llm] attempt 1 failed (${classified.name}) — retrying in ${RETRY_DELAY_MS}ms`,
      );
      await this.sleep(RETRY_DELAY_MS);
      try {
        const res = await this.client!.post('/v1/messages', body);
        return res.data;
      } catch (err2) {
        throw this.classifyError(err2);
      }
    }
  }

  private classifyError(err: unknown): Error {
    const ae = err as AxiosError;
    if (ae?.code === 'ECONNABORTED' || ae?.code === 'ETIMEDOUT') {
      return new AnthropicTimeoutError(`timeout after ${REQUEST_TIMEOUT_MS}ms`);
    }
    const status = ae?.response?.status;
    if (status && status >= 500) {
      return new AnthropicServerError(`${status} ${(ae.response?.data as any)?.error?.message || ''}`);
    }
    if (status && status >= 400) {
      return new AnthropicClientError(
        status,
        (ae.response?.data as any)?.error?.message || `anthropic ${status}`,
      );
    }
    if (ae?.message) {
      return new AnthropicServerError(`network: ${ae.message}`);
    }
    return new AnthropicServerError('unknown error');
  }

  private extractText(data: any): string {
    const blocks = data?.content || [];
    const parts: string[] = [];
    for (const b of blocks) {
      if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    }
    return parts.join('\n').trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
