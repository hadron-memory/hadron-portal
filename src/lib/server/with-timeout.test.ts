import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './with-timeout';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('passes the result through when the work settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, null)).resolves.toBe('ok');
  });

  it('settles to the fallback when the work hangs', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<string>(() => {}), 1000, null);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeNull();
  });

  it('still rejects when the work rejects before the bound', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, null)).rejects.toThrow('boom');
  });
});
