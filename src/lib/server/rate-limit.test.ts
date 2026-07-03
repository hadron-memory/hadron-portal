import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, rateLimitResponse, __resetRateLimit } from './rate-limit';

describe('rateLimit', () => {
  beforeEach(() => __resetRateLimit());

  it('allows up to the limit within a window, then blocks', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 60_000, t0).ok).toBe(true);
    }
    const blocked = rateLimit('k', 3, 60_000, t0);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
  });

  it('resets after the window elapses', () => {
    const t0 = 2_000_000;
    expect(rateLimit('k', 1, 60_000, t0).ok).toBe(true);
    expect(rateLimit('k', 1, 60_000, t0).ok).toBe(false);
    // Next window.
    expect(rateLimit('k', 1, 60_000, t0 + 60_000).ok).toBe(true);
  });

  it('scopes counts per key', () => {
    const t0 = 3_000_000;
    expect(rateLimit('a', 1, 60_000, t0).ok).toBe(true);
    expect(rateLimit('b', 1, 60_000, t0).ok).toBe(true);
    expect(rateLimit('a', 1, 60_000, t0).ok).toBe(false);
  });
});

describe('rateLimitResponse', () => {
  beforeEach(() => __resetRateLimit());

  it('returns null while under the limit and a 429 once over', async () => {
    expect(rateLimitResponse('user-1', 'bucket', 1, 60_000)).toBeNull();
    const res = rateLimitResponse('user-1', 'bucket', 1, 60_000);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get('Retry-After')).toBeTruthy();
    expect((await res!.json()).error).toMatch(/rate limit/i);
  });

  it('keys distinct users separately', () => {
    expect(rateLimitResponse('user-1', 'bucket', 1, 60_000)).toBeNull();
    expect(rateLimitResponse('user-2', 'bucket', 1, 60_000)).toBeNull();
  });
});
