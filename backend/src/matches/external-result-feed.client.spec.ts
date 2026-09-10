import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import {
  HttpExternalResultFeedClient,
  isTransientFeedError,
} from './external-result-feed.client';
import { CircuitOpenError } from '../common/circuit-breaker';

/** Matches the shape axios rejects with, which is what the client classifies. */
function httpError(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  });
}

function networkError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function makeClient(get: jest.Mock) {
  const config = {
    getOrThrow: jest.fn(() => 'https://feed.test/results'),
    get: jest.fn(() => undefined),
  } as unknown as ConfigService;
  const http = { get } as unknown as HttpService;
  return new HttpExternalResultFeedClient(http, config);
}

describe('HttpExternalResultFeedClient', () => {
  it('uses the configured feed URL and credential and responds to config changes', async () => {
    let url = 'https://feed-one.test/results';
    const config = {
      getOrThrow: jest.fn(() => url),
      get: jest.fn(() => 'secret'),
    } as unknown as ConfigService;
    const http = {
      get: jest.fn(() => of({ data: [] })),
    } as unknown as HttpService;
    const client = new HttpExternalResultFeedClient(http, config);

    await client.fetchResults();
    url = 'https://feed-two.test/results';
    await client.fetchResults();

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      'https://feed-one.test/results',
      { headers: { Authorization: 'Bearer secret' } },
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      'https://feed-two.test/results',
      { headers: { Authorization: 'Bearer secret' } },
    );
  });

  describe('error classification', () => {
    it.each([408, 425, 429, 500, 502, 503, 504])(
      'treats %i as transient',
      (status) => {
        expect(isTransientFeedError(httpError(status))).toBe(true);
      },
    );

    it.each([400, 401, 403, 404, 422])(
      'treats %i as permanent',
      (status) => {
        expect(isTransientFeedError(httpError(status))).toBe(false);
      },
    );

    it('treats a request that never got a response as transient', () => {
      expect(isTransientFeedError(networkError('ECONNRESET'))).toBe(true);
    });
  });

  describe('backoff', () => {
    it('retries a transient failure and returns the eventual result', async () => {
      const payload = [{ externalId: 'm-1' }];
      const get: jest.Mock = jest
        .fn()
        .mockReturnValueOnce(throwError(() => httpError(503)))
        .mockReturnValueOnce(of({ data: payload }));

      await expect(makeClient(get).fetchResults()).resolves.toBe(payload);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('does not retry a rejected credential', async () => {
      const get: jest.Mock = jest.fn(() => throwError(() => httpError(401)));

      await expect(makeClient(get).fetchResults()).rejects.toThrow(
        'status code 401',
      );
      expect(get).toHaveBeenCalledTimes(1);
    });
  });

  describe('circuit breaker', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('opens after repeated failures and stops calling the feed', async () => {
      const get: jest.Mock = jest.fn(() => throwError(() => httpError(401)));
      const client = makeClient(get);

      for (let i = 0; i < 5; i++) {
        await expect(client.fetchResults()).rejects.toThrow('status code 401');
      }
      expect(client.getHealth().state).toBe('open');

      await expect(client.fetchResults()).rejects.toBeInstanceOf(
        CircuitOpenError,
      );
      // Still five: the sixth poll was rejected locally.
      expect(get).toHaveBeenCalledTimes(5);
    });

    it('closes again when the half-open probe succeeds', async () => {
      const payload = [{ externalId: 'm-2' }];
      const get: jest.Mock = jest.fn(() => throwError(() => httpError(401)));
      const client = makeClient(get);

      for (let i = 0; i < 5; i++) {
        await expect(client.fetchResults()).rejects.toThrow('status code 401');
      }
      expect(client.getHealth().state).toBe('open');

      // Move past the open window rather than sleeping through it.
      const realNow = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(realNow + 60_000);
      expect(client.getHealth().state).toBe('half-open');

      get.mockReturnValue(of({ data: payload }));
      await expect(client.fetchResults()).resolves.toBe(payload);
      expect(client.getHealth().state).toBe('closed');
      expect(client.getHealth().consecutiveFailures).toBe(0);
    });
  });
});
