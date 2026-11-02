/**
 * portal#1068 — the App's key inventory in its OWN classified requests.
 * `App.keys` is manager-only and non-null on the server (hadron-server#2080), so
 * selecting it on the shared App fragment nulls the App for every non-manager.
 * A non-manager gets `hidden` (no count, no zero); a failure is `failed`, never
 * an empty list (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_FIELDS, APP_QUERY, APPS_QUERY, ORGANIZATIONS_QUERY, CREATE_APP_MUTATION, UPDATE_APP_MUTATION } from './queries';
import * as appKeys from './app-keys';
import { pageOf } from '$lib/test/pagedFixture';

const request = vi.fn();
const client = { request } as never;
const gqlError = (code: string) => ({ response: { errors: [{ message: `secret ${code} key-id-abc`, extensions: { code } }] } });
const key = (id: string) => ({ id, label: id, keyPreview: 'hdr_app_...abcd', createdAt: 'x', lastUsedAt: null, revokedAt: null });
const warn = vi.spyOn(console, 'warn');

beforeEach(() => {
  request.mockReset();
  warn.mockReset().mockImplementation(() => {});
});

describe('no operation selects App.keys', () => {
  it.each([
    ['APP_FIELDS', APP_FIELDS],
    ['APP_QUERY', APP_QUERY],
    ['APPS_QUERY', APPS_QUERY],
    ['ORGANIZATIONS_QUERY', ORGANIZATIONS_QUERY],
    ['CREATE_APP_MUTATION', CREATE_APP_MUTATION],
    ['UPDATE_APP_MUTATION', UPDATE_APP_MUTATION],
  ])('%s', (_name, doc) => {
    expect(doc).not.toMatch(/^\s*keys\s*\{/m);
  });
});

describe('loadAppKeys', () => {
  it('ok carries the keys', async () => {
    request.mockResolvedValueOnce({ appKeysPage: pageOf([key('k1')]) });
    await expect(appKeys.loadAppKeys(client, 'app-1')).resolves.toEqual({ kind: 'ok', keys: [key('k1')] });
  });
  it('ok with no keys is an empty list, distinct from hidden and failed', async () => {
    request.mockResolvedValueOnce({ appKeysPage: pageOf([]) });
    await expect(appKeys.loadAppKeys(client, 'app-1')).resolves.toEqual({ kind: 'ok', keys: [] });
  });
  it('FORBIDDEN (not a manager) is hidden', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    await expect(appKeys.loadAppKeys(client, 'app-1')).resolves.toEqual({ kind: 'hidden' });
  });
  it('anything else is failed, never an empty list, and logs no server text or key id', async () => {
    request.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR'));
    await expect(appKeys.loadAppKeys(client, 'app-1')).resolves.toEqual({ kind: 'failed' });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/key-id-abc|secret/);
  });
  it('a transport error is failed', async () => {
    request.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(appKeys.loadAppKeys(client, 'app-1')).resolves.toEqual({ kind: 'failed' });
  });
});

describe('loadAppKeys follows every page (portal#1615)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => key(`k${i}`));
  it.each([21, 201, 450])('%i keys: every key is shown, 20 per call', async (n) => {
    request.mockImplementation(async (_q: string, v: { limit?: number; offset?: number }) => ({ appKeysPage: pageOf(many(n), v) }));
    const r = await appKeys.loadAppKeys(client, 'app-1');
    expect(r).toEqual({ kind: 'ok', keys: many(n) });
    expect(request).toHaveBeenCalledTimes(Math.ceil(n / 20) + 1);
    for (const [, v] of request.mock.calls) expect(v.limit).toBeLessThanOrEqual(20);
  });
  it('a refused later page is the same refusal state, with no partial list', async () => {
    request.mockImplementation(async (_q: string, v: { offset?: number }) => {
      if ((v.offset ?? 0) >= 20) throw gqlError('FORBIDDEN');
      return { appKeysPage: pageOf(many(60), v) };
    });
    await expect(appKeys.loadAppKeys(client, 'app-1')).resolves.toEqual({ kind: 'hidden' });
    request.mockImplementation(async (_q: string, v: { offset?: number }) => {
      if ((v.offset ?? 0) >= 40) throw gqlError('INTERNAL_SERVER_ERROR');
      return { appKeysPage: pageOf(many(60), v) };
    });
    await expect(appKeys.loadAppKeys(client, 'app-1')).resolves.toEqual({ kind: 'failed' });
  });
});

describe('loadActiveKeyCounts', () => {
  const apps = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `app-${i}` }));
  it('counts per App; zero is a real zero only from ok', async () => {
    request.mockImplementation(async (_q: string, v: { appRef: string }) => ({ appKeysPage: pageOf(v.appRef === 'app-0' ? [key('a'), key('b')] : []) }));
    await expect(appKeys.loadActiveKeyCounts(client, apps(2))).resolves.toEqual({
      'app-0': { kind: 'ok', count: 2 },
      'app-1': { kind: 'ok', count: 0 },
    });
  });
  it('non-manager is hidden, failure is failed, and neither is a count', async () => {
    request.mockImplementation(async (_q: string, v: { appRef: string }) => {
      if (v.appRef === 'app-0') throw gqlError('FORBIDDEN');
      if (v.appRef === 'app-1') throw gqlError('INTERNAL_SERVER_ERROR');
      return { appKeysPage: pageOf([key('a')]) };
    });
    const out = await appKeys.loadActiveKeyCounts(client, apps(3));
    expect(out['app-0']).toEqual({ kind: 'hidden' });
    expect(out['app-1']).toEqual({ kind: 'failed' });
    expect(out['app-2']).toEqual({ kind: 'ok', count: 1 });
  });
  it('apps past the cap are unknown and are not requested', async () => {
    request.mockResolvedValue({ appKeysPage: pageOf([]) });
    const out = await appKeys.loadActiveKeyCounts(client, apps(appKeys.ACTIVE_KEY_COUNT_CAP + 1));
    expect(request).toHaveBeenCalledTimes(appKeys.ACTIVE_KEY_COUNT_CAP);
    expect(out[`app-${appKeys.ACTIVE_KEY_COUNT_CAP}`]).toEqual({ kind: 'unknown' });
  });
  it('never has more than the concurrency limit in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    request.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { appKeysPage: pageOf([]) };
    });
    await appKeys.loadActiveKeyCounts(client, apps(20));
    expect(peak).toBeLessThanOrEqual(appKeys.ACTIVE_KEY_COUNT_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });
});
