import { beforeEach, describe, expect, it, vi } from 'vitest';

// The cache holds module-level state, so each test file run shares one
// instance — tests use distinct asset ids to stay independent.
vi.mock('$lib/api/assetUpload', () => ({
  getAssetDownloadTicket: vi.fn(),
}));

import { getAssetDownloadTicket } from '$lib/api/assetUpload';
import { evictThumbTicket, getThumbSrc } from './thumb-ticket-cache';

const mint = vi.mocked(getAssetDownloadTicket);

function ticket(url: string, ttlMs: number) {
  return { url, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}

beforeEach(() => {
  mint.mockReset();
});

describe('thumb-ticket-cache', () => {
  it('dedupes concurrent requests for the same asset into one mint', async () => {
    mint.mockResolvedValue(ticket('https://store/one', 300_000));
    const [a, b] = await Promise.all([getThumbSrc('dedupe-1'), getThumbSrc('dedupe-1')]);
    expect(a).toBe('https://store/one');
    expect(b).toBe('https://store/one');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('serves a fresh ticket from cache without re-minting', async () => {
    mint.mockResolvedValue(ticket('https://store/two', 300_000));
    await getThumbSrc('cache-1');
    await getThumbSrc('cache-1');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('re-mints when the cached ticket is inside the expiry slack', async () => {
    // 10s TTL < 30s slack — usable never, so each call mints anew.
    mint
      .mockResolvedValueOnce(ticket('https://store/short-a', 10_000))
      .mockResolvedValueOnce(ticket('https://store/short-b', 10_000));
    expect(await getThumbSrc('expiry-1')).toBe('https://store/short-a');
    expect(await getThumbSrc('expiry-1')).toBe('https://store/short-b');
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('assigns a short lifetime instead of caching forever when expiresAt is null', async () => {
    mint.mockResolvedValue({ url: 'https://store/no-expiry', expiresAt: null });
    await getThumbSrc('null-exp-1');
    // 60s assumed lifetime > 30s slack ⇒ still cached on the second call.
    await getThumbSrc('null-exp-1');
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('evictThumbTicket forces the next call to mint a fresh URL', async () => {
    mint
      .mockResolvedValueOnce(ticket('https://store/evict-a', 300_000))
      .mockResolvedValueOnce(ticket('https://store/evict-b', 300_000));
    expect(await getThumbSrc('evict-1')).toBe('https://store/evict-a');
    evictThumbTicket('evict-1');
    expect(await getThumbSrc('evict-1')).toBe('https://store/evict-b');
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed mint — the next call retries', async () => {
    mint
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(ticket('https://store/retry', 300_000));
    await expect(getThumbSrc('fail-1')).rejects.toThrow('boom');
    expect(await getThumbSrc('fail-1')).toBe('https://store/retry');
  });

  it('bounds the cache — the oldest entries fall out past the cap', async () => {
    mint.mockImplementation(async (id: string) => ticket(`https://store/${id}`, 300_000));
    // Fill well past MAX_ENTRIES (200) with distinct ids…
    for (let i = 0; i < 210; i++) await getThumbSrc(`bound-${i}`);
    const callsAfterFill = mint.mock.calls.length;
    // …the earliest id has been evicted, so asking again re-mints…
    await getThumbSrc('bound-0');
    expect(mint.mock.calls.length).toBe(callsAfterFill + 1);
    // …while the most recent is still cached.
    await getThumbSrc('bound-209');
    expect(mint.mock.calls.length).toBe(callsAfterFill + 1);
  });
});
