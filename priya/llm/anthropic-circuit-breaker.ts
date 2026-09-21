/**
 * Anthropic circuit breaker.
 *
 * Trip conditions (either):
 *   - 5 CONSECUTIVE failures (timeout or 5xx), OR
 *   - 5 failures within any 60-second rolling window.
 *
 * States:
 *   closed     — normal; every call forwards to the provider
 *   open       — no calls; provider throws CircuitOpenError
 *                immediately (no API hit, no cost, no latency).
 *                Duration: 120 s.
 *   half_open  — after 120 s, the FIRST eligible request is the
 *                probe. Success → closed. Failure → re-open for
 *                another 120 s, counter from scratch.
 *
 * Retry interaction (user-specified clarification §8.8):
 *   - AnthropicProvider's 1-retry still runs first.
 *   - A "breaker failure" is the FINAL failed outcome after retry
 *     already exhausted. So 5 breaker failures ≈ up to 10 actual
 *     API calls.
 *
 * Counter semantics:
 *   - `tripCountToday` increments each time state transitions into
 *     'open'. Resets at IST midnight via midnight-crossing check
 *     on every counter read — no scheduler needed.
 *   - `failuresLastMinute` is rolling: a sliding window of timestamps,
 *     pruned on every record.
 *
 * Single-process only — state is per-replica by design. The NestJS
 * webhook service runs one replica today; if we scale to N, each
 * replica's breaker observes its own failure window (acceptable
 * trade-off, avoids Redis round-trips on the hot path).
 *
 * Marker: isSelfAuthored
 */

import { Injectable, Logger } from '@nestjs/common';

export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitOpenError extends Error {
  constructor(
    public readonly openedAt: Date,
    public readonly reopenAt: Date,
  ) {
    super(
      `anthropic circuit open since ${openedAt.toISOString()}; ` +
        `next probe at ${reopenAt.toISOString()}`,
    );
    this.name = 'CircuitOpenError';
  }
}

export interface BreakerSnapshot {
  state: BreakerState;
  tripCountToday: number;
  failuresLastMinute: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  reopensAt: string | null;
}

const CONSECUTIVE_TRIP_THRESHOLD = 5;
const ROLLING_TRIP_THRESHOLD = 5;
const ROLLING_WINDOW_MS = 60_000;
const OPEN_DURATION_MS = 120_000;

@Injectable()
export class AnthropicCircuitBreaker {
  private readonly log = new Logger(AnthropicCircuitBreaker.name);

  private state: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private failureTimestamps: number[] = []; // ms since epoch, pruned
  private lastFailureAt: number | null = null;
  private openedAt: number | null = null;
  private reopensAt: number | null = null;

  // Daily trip counter — IST-day-keyed
  private tripCountToday = 0;
  private tripCountDayKey = this.istDayKey(Date.now());

  /**
   * Gate call — throws CircuitOpenError when open and still within
   * the 120 s window. Transitions open → half_open when the window
   * has elapsed.
   */
  guard(): void {
    const now = Date.now();
    if (this.state === 'open') {
      if (this.reopensAt !== null && now >= this.reopensAt) {
        this.state = 'half_open';
        this.log.log('[priya-breaker] transition open → half_open (probe window)');
        return;
      }
      const opened = new Date(this.openedAt ?? now);
      const reopen = new Date(this.reopensAt ?? now);
      throw new CircuitOpenError(opened, reopen);
    }
  }

  /**
   * Call outcome hook — record success.
   * closed: nothing special.
   * half_open: transition back to closed, clear failure counters.
   */
  onSuccess(): void {
    if (this.state === 'half_open') {
      this.state = 'closed';
      this.consecutiveFailures = 0;
      this.failureTimestamps = [];
      this.log.log('[priya-breaker] probe succeeded — transition half_open → closed');
    } else if (this.state === 'closed') {
      // Successful call after a partial streak — reset consecutive counter.
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Call outcome hook — record failure.
   * closed: increment counters; trip if threshold reached.
   * half_open: probe failed → re-open for another 120 s, counters
   *            from scratch.
   */
  onFailure(): void {
    const now = Date.now();
    this.lastFailureAt = now;

    if (this.state === 'half_open') {
      this.trip(now, 'probe_failed');
      return;
    }

    if (this.state !== 'closed') return;

    this.consecutiveFailures += 1;
    this.failureTimestamps.push(now);
    this.pruneFailureTimestamps(now);

    const rolling = this.failureTimestamps.length;
    if (
      this.consecutiveFailures >= CONSECUTIVE_TRIP_THRESHOLD ||
      rolling >= ROLLING_TRIP_THRESHOLD
    ) {
      this.trip(
        now,
        this.consecutiveFailures >= CONSECUTIVE_TRIP_THRESHOLD
          ? 'consecutive_threshold'
          : 'rolling_threshold',
      );
    }
  }

  snapshot(): BreakerSnapshot {
    const now = Date.now();
    this.refreshDailyCounter(now);
    return {
      state: this.state,
      tripCountToday: this.tripCountToday,
      failuresLastMinute: this.pruneFailureTimestamps(now),
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      reopensAt: this.reopensAt ? new Date(this.reopensAt).toISOString() : null,
    };
  }

  /** Test-only — reset breaker state. */
  _reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.failureTimestamps = [];
    this.lastFailureAt = null;
    this.openedAt = null;
    this.reopensAt = null;
    this.tripCountToday = 0;
    this.tripCountDayKey = this.istDayKey(Date.now());
  }

  // ── internals ─────────────────────────────────────────────────────────

  private trip(now: number, reason: string): void {
    this.refreshDailyCounter(now);
    this.state = 'open';
    this.openedAt = now;
    this.reopensAt = now + OPEN_DURATION_MS;
    this.tripCountToday += 1;
    this.consecutiveFailures = 0;
    this.failureTimestamps = [];
    this.log.warn(
      `[priya-breaker] TRIPPED (${reason}) — open for ${OPEN_DURATION_MS / 1000}s; tripCountToday=${this.tripCountToday}`,
    );
  }

  private pruneFailureTimestamps(now: number): number {
    const cutoff = now - ROLLING_WINDOW_MS;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t >= cutoff);
    return this.failureTimestamps.length;
  }

  private refreshDailyCounter(now: number): void {
    const key = this.istDayKey(now);
    if (key !== this.tripCountDayKey) {
      this.tripCountDayKey = key;
      this.tripCountToday = 0;
    }
  }

  private istDayKey(msEpoch: number): string {
    const ist = new Date(msEpoch + 5.5 * 3600_000);
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const d = String(ist.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
