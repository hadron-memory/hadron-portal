/**
 * portal#1022 gate — does this deployment offer node signing? Read from the
 * authenticated SDL route, because selecting the true-only `ServerInfo.signing`
 * fails validation when it is off, and introspection is off in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/api', () => ({ serverBaseUrl: () => 'http://srv' }));

const sdl = (fields: string) => `"""Identity"""\ntype ServerInfo {\n${fields}\n  version: String!\n  baseUrl: String!\n}\ntype Query { serverInfo: ServerInfo! }\n`;
const ON = sdl('  "Present and true only when this deployment offers node signing."\n  signing: Boolean!');
const OFF = sdl('');

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

const answer = (body: string, status = 200) => fetchMock.mockResolvedValue(new Response(body, { status }));

describe('deploymentOffersSigning', () => {
  it('reads the authenticated SDL route with the caller token', async () => {
    answer(ON);
    expect(await mod.deploymentOffersSigning('tok')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://srv/graphql/schema', { headers: { Authorization: 'Bearer tok' } });
  });

  it('is off when ServerInfo declares no signing field', async () => {
    answer(OFF);
    expect(await mod.deploymentOffersSigning('tok')).toBe(false);
  });

  it('ignores a signing field on any other type', async () => {
    answer(OFF + 'type Other {\n  signing: Boolean!\n}\n');
    expect(await mod.deploymentOffersSigning('tok')).toBe(false);
  });

  it('reads off on a refused route, a network failure, or unparseable SDL', async () => {
    answer('{"error":"nope"}', 401);
    expect(await mod.deploymentOffersSigning('tok')).toBe(false);
    vi.advanceTimersByTime(mod.SIGNING_CAPABILITY_TTL_MS + 1);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await mod.deploymentOffersSigning('tok')).toBe(false);
    vi.advanceTimersByTime(mod.SIGNING_CAPABILITY_TTL_MS + 1);
    answer('type {');
    expect(await mod.deploymentOffersSigning('tok')).toBe(false);
  });

  it('without a token it does not probe', async () => {
    expect(await mod.deploymentOffersSigning(null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches the answer for the TTL, shares one in-flight probe, then re-probes', async () => {
    answer(OFF);
    const [a, b] = await Promise.all([mod.deploymentOffersSigning('t1'), mod.deploymentOffersSigning('t2')]);
    expect([a, b]).toEqual([false, false]);
    expect(await mod.deploymentOffersSigning('t3')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // the switch flips with a server restart; the next window sees it
    vi.advanceTimersByTime(mod.SIGNING_CAPABILITY_TTL_MS + 1);
    answer(ON);
    expect(await mod.deploymentOffersSigning('t4')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches a failed probe too, so a broken route is not hit per view', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    await mod.deploymentOffersSigning('tok');
    await mod.deploymentOffersSigning('tok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
