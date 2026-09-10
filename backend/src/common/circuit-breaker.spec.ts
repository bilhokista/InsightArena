import {
  CircuitBreaker,
  CircuitOpenError,
} from './circuit-breaker';

/** Controllable clock, so no test has to wait for a real `openMs` to elapse. */
function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function makeBreaker(clock: ReturnType<typeof fakeClock>) {
  return new CircuitBreaker({
    label: 'test upstream',
    failureThreshold: 3,
    openMs: 30_000,
    now: clock.now,
  });
}

const boom = () => Promise.reject(new Error('upstream down'));

describe('CircuitBreaker', () => {
  it('stays closed and passes results through while calls succeed', async () => {
    const breaker = makeBreaker(fakeClock());

    await expect(breaker.run(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.health().state).toBe('closed');
    expect(breaker.health().consecutiveFailures).toBe(0);
  });

  it('opens after the failure threshold is reached', async () => {
    const clock = fakeClock();
    const breaker = makeBreaker(clock);

    for (let i = 0; i < 2; i++) {
      await expect(breaker.run(boom)).rejects.toThrow('upstream down');
      expect(breaker.health().state).toBe('closed');
    }

    await expect(breaker.run(boom)).rejects.toThrow('upstream down');

    const health = breaker.health();
    expect(health.state).toBe('open');
    expect(health.consecutiveFailures).toBe(3);
    expect(health.lastError).toBe('upstream down');
    expect(health.retryAfterMs).toBe(30_000);
  });

  it('rejects without calling upstream while open', async () => {
    const clock = fakeClock();
    const breaker = makeBreaker(clock);
    for (let i = 0; i < 3; i++) {
      await expect(breaker.run(boom)).rejects.toThrow('upstream down');
    }

    const call = jest.fn(() => Promise.resolve('ok'));
    await expect(breaker.run(call)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(call).not.toHaveBeenCalled();
  });

  it('recovers when the half-open probe succeeds', async () => {
    const clock = fakeClock();
    const breaker = makeBreaker(clock);
    for (let i = 0; i < 3; i++) {
      await expect(breaker.run(boom)).rejects.toThrow('upstream down');
    }

    clock.advance(30_000);
    expect(breaker.health().state).toBe('half-open');

    await expect(breaker.run(async () => 'recovered')).resolves.toBe(
      'recovered',
    );

    const health = breaker.health();
    expect(health.state).toBe('closed');
    expect(health.consecutiveFailures).toBe(0);
    expect(health.lastError).toBeNull();
  });

  it('re-opens for a full window when the half-open probe fails', async () => {
    const clock = fakeClock();
    const breaker = makeBreaker(clock);
    for (let i = 0; i < 3; i++) {
      await expect(breaker.run(boom)).rejects.toThrow('upstream down');
    }

    clock.advance(30_000);
    await expect(breaker.run(boom)).rejects.toThrow('upstream down');

    expect(breaker.health().state).toBe('open');
    expect(breaker.health().retryAfterMs).toBe(30_000);

    clock.advance(29_999);
    expect(breaker.health().state).toBe('open');
    clock.advance(1);
    expect(breaker.health().state).toBe('half-open');
  });

  it('admits only one probe while half-open', async () => {
    const clock = fakeClock();
    const breaker = makeBreaker(clock);
    for (let i = 0; i < 3; i++) {
      await expect(breaker.run(boom)).rejects.toThrow('upstream down');
    }
    clock.advance(30_000);

    let releaseProbe: (value: string) => void = () => undefined;
    const probe = breaker.run(
      () =>
        new Promise<string>((resolve) => {
          releaseProbe = resolve;
        }),
    );

    const second = jest.fn(() => Promise.resolve('ok'));
    await expect(breaker.run(second)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(second).not.toHaveBeenCalled();

    releaseProbe('ok');
    await expect(probe).resolves.toBe('ok');
    expect(breaker.health().state).toBe('closed');
  });
});
