import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { WinningTeam } from './entities/match.entity';
import { withRetry } from '../common/retry.util';
import {
  BreakerHealth,
  CircuitBreaker,
  CircuitOpenError,
} from '../common/circuit-breaker';

export interface ExternalMatchResultPayload {
  externalId: string;
  homeScore: number;
  awayScore: number;
  winningTeam: WinningTeam;
}

export const EXTERNAL_RESULT_FEED_CLIENT = Symbol(
  'EXTERNAL_RESULT_FEED_CLIENT',
);

export interface ExternalResultFeedClient {
  fetchResults(): Promise<ExternalMatchResultPayload[]>;
}

/** Attempts per poll, including the first. Kept low: the poller runs again soon. */
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
/** Consecutive failed polls (after retries) before the breaker opens. */
const FAILURE_THRESHOLD = 5;
const OPEN_MS = 60_000;

/** Status codes worth another attempt: the upstream is busy, not wrong. */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const TRANSIENT_ERRNO = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'ENOTFOUND',
]);

/**
 * A response that arrived but was rejected (4xx other than the codes above) is
 * permanent: the URL or the credential is wrong, and retrying just repeats a
 * request the upstream has already refused.
 */
export function isTransientFeedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;

  const axiosLike = error as {
    response?: { status?: number };
    code?: string;
  };

  const status = axiosLike.response?.status;
  if (typeof status === 'number') return TRANSIENT_STATUS.has(status);

  // No response at all — the request never completed, so it is worth retrying.
  return typeof axiosLike.code === 'string'
    ? TRANSIENT_ERRNO.has(axiosLike.code)
    : true;
}

@Injectable()
export class HttpExternalResultFeedClient implements ExternalResultFeedClient {
  private readonly logger = new Logger(HttpExternalResultFeedClient.name);

  private readonly breaker = new CircuitBreaker({
    label: 'external result feed',
    failureThreshold: FAILURE_THRESHOLD,
    openMs: OPEN_MS,
  });

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Current state of the upstream as this client sees it, for monitoring.
   *
   * Exposed as a plain getter rather than wired into `HealthService`: that
   * service composes injected Terminus indicators, and adding the feed to it
   * changes which dependencies `/health` reports on. Left for a follow-up so
   * that decision is made deliberately rather than as a side effect here.
   */
  getHealth(): BreakerHealth {
    return this.breaker.health();
  }

  async fetchResults(): Promise<ExternalMatchResultPayload[]> {
    const url = this.configService.getOrThrow<string>('MATCH_RESULTS_FEED_URL');
    const credential = this.configService.get<string>(
      'MATCH_RESULTS_FEED_CREDENTIAL',
    );

    // Retry sits inside the breaker, not around it: one poll gets one retry
    // budget, and the breaker counts polls rather than individual attempts.
    return this.breaker.run(() =>
      withRetry(
        async () => {
          const response = await firstValueFrom(
            this.httpService.get<ExternalMatchResultPayload[]>(url, {
              headers: credential
                ? { Authorization: `Bearer ${credential}` }
                : {},
            }),
          );
          return response.data;
        },
        {
          maxAttempts: MAX_ATTEMPTS,
          baseDelayMs: BASE_DELAY_MS,
          isTransient: isTransientFeedError,
          onRetry: (error, attempt, delayMs) => {
            this.logger.warn(
              `result feed attempt ${attempt + 1} failed (${
                error instanceof Error ? error.message : String(error)
              }); retrying in ${delayMs}ms`,
            );
          },
        },
      ),
    ).catch((error: unknown) => {
      // A rejection from an open breaker is a local decision, not an upstream
      // failure — log it differently so it is not mistaken for a new outage.
      if (error instanceof CircuitOpenError) {
        this.logger.warn(error.message);
      } else {
        const { state, consecutiveFailures } = this.breaker.health();
        this.logger.error(
          `result feed poll failed (${
            error instanceof Error ? error.message : String(error)
          }); breaker=${state} consecutiveFailures=${consecutiveFailures}`,
        );
      }
      throw error;
    });
  }
}
