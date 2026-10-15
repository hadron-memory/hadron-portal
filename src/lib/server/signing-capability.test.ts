/**
 * portal#1022 gate, read from `GET /capabilities` (portal#1098, hadron-server#1925):
 * the deployment's switches, unauthenticated, outside GraphQL. The SDL probe
 * (#1097's stopgap) is gone; a pin below holds that no schema fetch happens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/api', () => ({ serverBaseUrl: () => 'http://srv' }));

const fetchMock = vi.fn();
let mod: typeof import('./signing-capability');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mod = await import('./signing-capability');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const caps = (list: string[], headers: Record<string, string> = { 'Cache-Control': 'public, max-age=60', ETag: '"e1"' }) =>
  new Response(JSON.stringify({ capabilities: list }), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
const answer = (res: Response) => fetchMock.mockResolvedValueOnce(res);
const urlOf = (call: unknown[]) => String(call[0]);
const headersOf = (call: unknown[]) => new Headers((call[1] as RequestInit | undefined)?.headers);

describe('deploymentOffersSigning', () => {
  it('reads GET /capabilities, unauthenticated, and never the SDL route', async () => {
    answer(caps(['node-signing']));
    expect(await mod.deploymentOffersSigning('tok')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0])).toBe('http://srv/capabilities');
    expect(headersOf(fetchMock.mock.calls[0]).has('Authorization')).toBe(false);
    expect(fetchMock.mock.calls.some((c) => urlOf(c).includes('/graphql/schema'))).toBe(false);
  });

  it('is off when node-signing is absent, even with other switches on', async () => {
    answer(caps(['passkey-registration']));
    expect(await mod.deploymentOffersSigning('tok')).toBe(false);
  });

  it('is off with every switch off (an empty list)', async () => {
    answer(caps([]));
    expect(await mod.deploymentOffersSigning('tok')).toBe(false);
  });

  it('without a token it reads off and does not fetch: there is no session to read signatures with', async () => {
    expect(await mod.deploymentOffersSigning(null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deploymentCapabilities: fail closed', () => {
  const failures: Array<[string, () => void]> = [
    ['a 429', () => answer(new Response(null, { status: 429 }))],
    ['a 500', () => answer(new Response('boom', { status: 500 }))],
    ['a network failure', () => fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))],
    ['a body that is not JSON', () => answer(new Response('<html>', { status: 200 }))],
    ['a body of the wrong shape', () => answer(new Response(JSON.stringify({ capabilities: 'node-signing' }), { status: 200 }))],
    ['a list with a non-string entry', () => answer(new Response(JSON.stringify({ capabilities: ['node-signing', 1] }), { status: 200 }))],
  ];
  for (const [name, arrange] of failures) {
    it(`reads every switch off on ${name}`, async () => {
      arrange();
      expect((await mod.deploymentCapabilities()).size).toBe(0);
      expect(await mod.deploymentOffersSigning('tok')).toBe(false);
    });
  }

  it('caches a failure for the retry window, so a broken route is not hit per view', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    await mod.deploymentCapabilities();
    await mod.deploymentCapabilities();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(mod.CAPABILITIES_FAILURE_RETRY_MS + 1);
    await mod.deploymentCapabilities();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Anne's P3 on #1097: one shared in-flight request must not wait forever,
  // or a hung server stalls every node view waiting on it.
  it('gives up on a hung request at the deadline, reads off, and frees the shared request', async () => {
    let aborted = false;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      }));
    const pending = mod.deploymentCapabilities();
    await vi.advanceTimersByTimeAsync(mod.CAPABILITIES_DEADLINE_MS + 1);
    expect((await pending).size).toBe(0);
    expect(aborted).toBe(true);
    // after the failure window, a fresh request goes out rather than reusing the dead one
    vi.advanceTimersByTime(mod.CAPABILITIES_FAILURE_RETRY_MS + 1);
    answer(caps(['node-signing']));
    expect((await mod.deploymentCapabilities()).has('node-signing')).toBe(true);
  });
});

describe('deploymentCapabilities: the endpoint’s own caching', () => {
  it('shares one in-flight request and serves max-age from memory', async () => {
    answer(caps(['node-signing']));
    const [a, b] = await Promise.all([mod.deploymentOffersSigning('t1'), mod.deploymentOffersSigning('t2')]);
    expect([a, b]).toEqual([true, true]);
    vi.advanceTimersByTime(59_000);
    expect(await mod.deploymentOffersSigning('t3')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('after max-age, revalidates with If-None-Match and keeps the answer on a 304', async () => {
    answer(caps(['node-signing']));
    await mod.deploymentCapabilities();
    vi.advanceTimersByTime(60_001);
    answer(new Response(null, { status: 304, headers: { 'Cache-Control': 'public, max-age=60', ETag: '"e1"' } }));
    expect((await mod.deploymentCapabilities()).has('node-signing')).toBe(true);
    expect(headersOf(fetchMock.mock.calls[1]).get('If-None-Match')).toBe('"e1"');
    // the 304 renewed the freshness window
    vi.advanceTimersByTime(30_000);
    await mod.deploymentCapabilities();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a switch flipped by a restart is seen at the next revalidation', async () => {
    answer(caps(['node-signing']));
    expect(await mod.deploymentOffersSigning('tok')).toBe(true);
    vi.advanceTimersByTime(60_001);
    answer(caps([], { 'Cache-Control': 'public, max-age=60', ETag: '"e2"' }));
    expect(await mod.deploymentOffersSigning('tok')).toBe(false);
  });

  it('without a max-age it does not reuse the answer, but still revalidates by ETag', async () => {
    answer(caps(['node-signing'], { ETag: '"e1"' }));
    await mod.deploymentCapabilities();
    answer(new Response(null, { status: 304, headers: { ETag: '"e1"' } }));
    expect((await mod.deploymentCapabilities()).has('node-signing')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(fetchMock.mock.calls[1]).get('If-None-Match')).toBe('"e1"');
  });

  it('a 304 with nothing cached to reuse reads off', async () => {
    answer(new Response(null, { status: 304 }));
    expect((await mod.deploymentCapabilities()).size).toBe(0);
  });
});
