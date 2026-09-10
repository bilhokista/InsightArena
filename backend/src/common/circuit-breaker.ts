/**
 * Minimal circuit breaker for outbound calls to a single upstream.
 *
 * Complements {@link withRetry} in `retry.util.ts` rather than replacing it:
 * retry handles one bad call, the breaker handles a bad *upstream*. Without a
 * breaker, every scheduled poll still pays the full retry budget against a
 * service that is already down, which is exactly how a client earns a
 * rate-limit ban while it is failing anyway.
 *
 * States:
 *   closed    — calls pass through; consecutive failures are counted.
 *   open      — calls are rejected immediately for `openMs`.
 *   half-open — one probe is allowed through. Success closes the breaker,
 *               failure re-opens it for another `openMs`.
 *
 * Deliberately not generalised into a decorator or a module: one upstream, one
 * instance, constructed by whoever owns the call.
 */

export type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(label: string, retryAfterMs: number) {
    super(
      `${label} circuit is open; not calling upstream for another ${retryAfterMs}ms`,
    );
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  /** Human-readable name for the upstream, used in errors and logs. */
  label: string;
  /** Consecutive failures that trip the breaker. Default 5. */
  failureThreshold?: number;
  /** How long the breaker stays open before allowing a probe. Default 30s. */
  openMs?: number;
  /**
   * Current time in ms. Injectable so tests can advance the clock without
   * sleeping — a breaker tested with real timers is a slow, flaky test.
   */
  now?: () => number;
}

export interface BreakerHealth {
  state: BreakerState;
  consecutiveFailures: number;
  /** ms until the next probe is allowed. 0 unless the state is `open`. */
  retryAfterMs: number;
  lastError: string | null;
}

export class CircuitBreaker {
  private readonly label: string;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly now: () => number;

  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private probeInFlight = false;
  private lastError: string | null = null;

  constructor(options: CircuitBreakerOptions) {
    this.label = options.label;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.openMs = options.openMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
  }

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.openMs ? 'half-open' : 'open';
  }

  health(): BreakerHealth {
    const state = this.state;
    return {
      state,
      consecutiveFailures: this.consecutiveFailures,
      retryAfterMs:
        state === 'open' && this.openedAt !== null
          ? Math.max(0, this.openMs - (this.now() - this.openedAt))
          : 0,
      lastError: this.lastError,
    };
  }

  /**
   * Runs `fn` unless the breaker is open.
   *
   * While half-open, only one probe is admitted; concurrent callers are
   * rejected as if the breaker were still open. Without that guard a burst of
   * queued callers would all stampede the recovering upstream at once.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;

    if (state === 'open') {
      throw new CircuitOpenError(this.label, this.health().retryAfterMs);
    }

    if (state === 'half-open') {
      if (this.probeInFlight) {
        throw new CircuitOpenError(this.label, 0);
      }
      this.probeInFlight = true;
    }

    try {
      const result = await fn();
      this.reset();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    } finally {
      this.probeInFlight = false;
    }
  }

  private reset(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.lastError = null;
  }

  private recordFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    this.lastError = error instanceof Error ? error.message : String(error);

    // A failed probe re-opens the breaker immediately, without waiting for the
    // threshold again — the upstream just told us it is still unhealthy.
    if (this.openedAt !== null || this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = this.now();
    }
  }
}
