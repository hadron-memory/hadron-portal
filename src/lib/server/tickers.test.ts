/**
 * portal#1099 — the Tickers reads: S7a is read-only, and each read maps only
 * the server's concealment codes (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as tickers from './tickers';
import { pageOf } from '$lib/test/pagedFixture';

const request = vi.fn();
const client = { request } as never;
const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('S7a is read-only', () => {
  it('every GraphQL document in the module is a query, none a mutation', () => {
    const docs = Object.entries(tickers).filter(([k, v]) => k.endsWith('_QUERY') && typeof v === 'string') as [string, string][];
    expect(docs.length).toBeGreaterThanOrEqual(5);
    for (const [, doc] of docs) {
      expect(doc).toMatch(/\bquery \w+/);
      expect(doc).not.toMatch(/\bmutation\b/);
    }
  });
});

describe('ticker reasons (portal#1144)', () => {
  it('the list and the detail read share a fragment that selects reasons', () => {
    expect(tickers.APP_TICKERS_QUERY).toMatch(/fragment TickerFields on Ticker \{[^}]*\breasons\b/);
    expect(tickers.TICKER_QUERY).toMatch(/fragment TickerFields on Ticker \{[^}]*\breasons\b/);
  });
});

describe('portal#1384 — tick code and task loc are detail-only', () => {
  const fragment = (doc: string) => doc.match(/fragment TickerFields on Ticker \{[^}]*\}/)?.[0] ?? '';

  it('TICKER_QUERY selects tickCode itself, outside the shared fragment', () => {
    expect(tickers.TICKER_QUERY).toMatch(/\btickCode\b/);
    expect(fragment(tickers.TICKER_QUERY)).not.toMatch(/\btickCode\b/);
  });

  it('the shared fragment and the list select neither tickCode nor registerTaskLoc', () => {
    for (const doc of [tickers.APP_TICKERS_QUERY, tickers.TICKER_QUERY]) {
      expect(fragment(doc)).not.toMatch(/\b(tickCode|registerTaskLoc)\b/);
    }
    expect(tickers.APP_TICKERS_QUERY).not.toMatch(/\b(tickCode|registerTaskLoc)\b/);
  });

  it('registerTaskLoc lives in its own query, never in TICKER_QUERY (a failure there must not blank the page)', () => {
    expect(tickers.TICKER_TASK_QUERY).toMatch(/\bregisterTaskLoc\b/);
    expect(tickers.TICKER_QUERY).not.toMatch(/\bregisterTaskLoc\b/);
  });

  it('loadTickerTask maps only APP_NOT_FOUND to not-participant; the rest is a failure', async () => {
    request.mockResolvedValueOnce({ ticker: { id: 't1', registerTaskLoc: 'tasks:x' } });
    await expect(tickers.loadTickerTask(client, 't1')).resolves.toEqual({ kind: 'ok', value: { registerTaskLoc: 'tasks:x' } });
    request.mockRejectedValueOnce(gqlError('APP_NOT_FOUND'));
    await expect(tickers.loadTickerTask(client, 't1')).resolves.toEqual({ kind: 'not-participant' });
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    await expect(tickers.loadTickerTask(client, 't1')).resolves.toEqual({ kind: 'failed' });
    request.mockResolvedValueOnce({ ticker: null });
    await expect(tickers.loadTickerTask(client, 't1')).resolves.toEqual({ kind: 'ok', value: null });
  });
});

describe('loadTickers', () => {
  it('ok with the rows', async () => {
    request.mockResolvedValueOnce({ tickers: [{ id: 't1' }] });
    await expect(tickers.loadTickers(client, 'app-1')).resolves.toEqual({ kind: 'ok', value: [{ id: 't1' }] });
    expect(request).toHaveBeenCalledWith(tickers.APP_TICKERS_QUERY, { appRef: 'app-1', first: tickers.SUBSCRIBER_COUNT_PAGE });
  });
  it('APP_NOT_FOUND is the not-participant state', async () => {
    request.mockRejectedValueOnce(gqlError('APP_NOT_FOUND'));
    await expect(tickers.loadTickers(client, 'app-1')).resolves.toEqual({ kind: 'not-participant' });
  });
  it('anything else is a failure, never an empty list', async () => {
    request.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR'));
    await expect(tickers.loadTickers(client, 'app-1')).resolves.toEqual({ kind: 'failed' });
    request.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(tickers.loadTickers(client, 'app-1')).resolves.toEqual({ kind: 'failed' });
  });
});

describe('loadWakeSettings', () => {
  it('WORKER_NOT_FOUND (the server’s answer to a non-participant) is not-participant', async () => {
    request.mockRejectedValueOnce(gqlError('WORKER_NOT_FOUND'));
    await expect(tickers.loadWakeSettings(client, 'w1')).resolves.toEqual({ kind: 'not-participant' });
  });
  it('FORBIDDEN is not one of its concealment codes, so it is a failure', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    await expect(tickers.loadWakeSettings(client, 'w1')).resolves.toEqual({ kind: 'failed' });
  });
});

describe('loadAppKeyScopes', () => {
  it('maps scopes by key', async () => {
    request.mockResolvedValueOnce({ appKeysPage: pageOf([{ id: 'k1', scopes: [{ scope: 'attention:deliver', hostId: null, grantedAt: 'x' }] }]) });
    await expect(tickers.loadAppKeyScopes(client, 'app-1')).resolves.toEqual({
      kind: 'ok',
      byKey: { k1: [{ scope: 'attention:deliver', hostId: null, grantedAt: 'x' }] },
    });
  });
  it.each([21, 201])('%i keys: every key has its scopes, joined by id, 20 per call (portal#1615)', async (n) => {
    const all = Array.from({ length: n }, (_, i) => ({ id: `k${i}`, scopes: [{ scope: 'attention:deliver', hostId: null, grantedAt: `g${i}` }] }));
    request.mockImplementation(async (_q: string, v: { limit?: number; offset?: number }) => ({ appKeysPage: pageOf(all, v) }));
    const r = await tickers.loadAppKeyScopes(client, 'app-1');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(Object.keys(r.byKey)).toHaveLength(n);
      expect(r.byKey[`k${n - 1}`][0].grantedAt).toBe(`g${n - 1}`);
    }
    expect(request).toHaveBeenCalledTimes(Math.ceil(n / 20) + 1);
    for (const [, v] of request.mock.calls) expect(v.limit).toBeLessThanOrEqual(20);
  });
  it('a refused later page hides the column with no partial map', async () => {
    request.mockImplementation(async (_q: string, v: { offset?: number }) => {
      if ((v.offset ?? 0) >= 20) throw gqlError('FORBIDDEN');
      return { appKeysPage: pageOf(Array.from({ length: 30 }, (_, i) => ({ id: `k${i}`, scopes: [] })), v) };
    });
    await expect(tickers.loadAppKeyScopes(client, 'app-1')).resolves.toEqual({ kind: 'hidden' });
  });
  it('FORBIDDEN (not a manager, cor:aut:010:03) hides the column; it is not an error', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    await expect(tickers.loadAppKeyScopes(client, 'app-1')).resolves.toEqual({ kind: 'hidden' });
  });
  it('anything else is a failure', async () => {
    request.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR'));
    await expect(tickers.loadAppKeyScopes(client, 'app-1')).resolves.toEqual({ kind: 'failed' });
  });
  it('is its own request: the keys list query never selects scopes', async () => {
    const { APP_KEYS_QUERY } = await import('./queries');
    expect(APP_KEYS_QUERY).not.toMatch(/scopes/);
    expect(tickers.APP_KEY_SCOPES_QUERY).toMatch(/scopes/);
  });
});
