/**
 * #1209 — a Ticker whose App the reader can't read (`ticker.app` null) is
 * this page's 404, same as a null ticker: the page's no-oracle rule says a
 * ticker the viewer can't reach and one that doesn't exist are both not-found.
 * Before the fix the null fell through to `ticker.app.id` — a TypeError, so a
 * permission question answered as a 500. Server modules are mocked because
 * the contracts under test are this loader's guards, not the wire.
 */
import { describe, expect, it, vi } from 'vitest';

const APP = { id: 'app-1', urn: 'hrn:app:acme.com:team', name: 'Team' };

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: vi.fn() }),
}));
vi.mock('$lib/server/agent-tasks', () => ({
  loadTasksApp: vi.fn(async () => APP),
}));
// `loadSubscribers`/`loadAppTickerSettings` are never reached by these guards
// (404/redirect fire first), so they are bare `vi.fn()`s — stubbing them with
// invented return values would pin shapes the real modules never produce
// (they return `TickerRead<T>`, `{ kind, value }`, which the page switches on).
vi.mock('$lib/server/tickers', () => ({
  loadTicker: vi.fn(),
  loadSubscribers: vi.fn(),
  loadAppTickerSettings: vi.fn(),
  loadTickerTask: vi.fn(),
  loadTickerRoster: vi.fn(),
}));

const ev = (appId = 'app-1', tickerId = 'tk-1', search = '') => ({
  params: { appId, tickerId },
  locals: { token: 't', impersonation: null, user: null },
  url: new URL(`https://x.test/app/apps/${appId}/tickers/${tickerId}${search}`),
});

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

describe('ticker detail loader — null Ticker.app (#1209)', () => {
  it('a missing ticker is the page 404 (control)', async () => {
    const { loadTicker } = await import('$lib/server/tickers');
    vi.mocked(loadTicker).mockResolvedValueOnce(null);
    const load = await importLoad();
    await expect(load(ev() as never)).rejects.toMatchObject({ status: 404 });
  });

  it('a ticker whose App the reader cannot read (app null) is the same 404, not a TypeError', async () => {
    const { loadTicker } = await import('$lib/server/tickers');
    vi.mocked(loadTicker).mockResolvedValueOnce({
      id: 'tk-1', urn: 'hrn:ticker:acme.com:team:eng', name: 'Eng', slug: 'eng',
      enabled: true, cadenceSeconds: 300, quietHours: null, channels: [], app: null,
    } as never);
    const load = await importLoad();
    await expect(load(ev() as never)).rejects.toMatchObject({ status: 404, body: { message: 'Ticker not found' } });
  });

  it('a ticker of ANOTHER app still redirects to its canonical address (control)', async () => {
    const { loadTicker } = await import('$lib/server/tickers');
    vi.mocked(loadTicker).mockResolvedValueOnce({
      id: 'tk-9', urn: 'hrn:ticker:acme.com:other:ops', name: 'Ops', slug: 'ops',
      enabled: true, cadenceSeconds: 300, quietHours: null, channels: [], app: { id: 'app-2' },
    } as never);
    const load = await importLoad();
    await expect(load(ev() as never)).rejects.toMatchObject({ status: 307, location: '/app/apps/app-2/tickers/tk-9' });
  });

  // #1211 review P3 — the cross-app redirect must carry the caller's query
  // (the ?after= pager state), as every load-time redirect does. The empty-
  // search control above pins the no-stray-'?' direction; this pins the other.
  it('the cross-app redirect carries the caller\'s query (review P3)', async () => {
    const { loadTicker } = await import('$lib/server/tickers');
    vi.mocked(loadTicker).mockResolvedValueOnce({
      id: 'tk-9', urn: 'hrn:ticker:acme.com:other:ops', name: 'Ops', slug: 'ops',
      enabled: true, cadenceSeconds: 300, quietHours: null, channels: [], app: { id: 'app-2' },
    } as never);
    const load = await importLoad();
    await expect(load(ev('app-1', 'tk-9', '?after=abc') as never)).rejects.toMatchObject({
      status: 307,
      location: '/app/apps/app-2/tickers/tk-9?after=abc',
    });
  });
});

describe('ticker detail loader — the roster read (portal#1497)', () => {
  const TICKER_OK = {
    id: 'tk-1', urn: 'hrn:ticker:acme.com:team:eng', name: 'Eng', slug: 'eng',
    enabled: true, cadenceSeconds: 300, quietHours: null, channels: [], app: { id: 'app-1' },
  };

  async function loadFull() {
    const { loadTicker, loadSubscribers, loadAppTickerSettings, loadTickerTask, loadTickerRoster } = await import('$lib/server/tickers');
    vi.mocked(loadTicker).mockResolvedValue(TICKER_OK as never);
    vi.mocked(loadSubscribers).mockResolvedValue({ kind: 'ok', value: { items: [], hasNextPage: false, endCursor: null } } as never);
    vi.mocked(loadAppTickerSettings).mockResolvedValue({ kind: 'ok', value: {} as never } as never);
    vi.mocked(loadTickerTask).mockResolvedValue({ kind: 'ok', value: null } as never);
    const load = (await import('./+page.server')).load;
    return { load, loadTickerRoster: vi.mocked(loadTickerRoster) };
  }

  it('reads the App’s roster exactly once per page load, for the Add-subscriber chooser', async () => {
    const { load, loadTickerRoster } = await loadFull();
    loadTickerRoster.mockResolvedValue({ kind: 'ok', workers: [{ id: 'w-1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' }] });
    const data = (await load(ev() as never)) as Record<string, unknown>;
    expect(loadTickerRoster).toHaveBeenCalledTimes(1);
    expect(loadTickerRoster).toHaveBeenCalledWith(expect.anything(), 'app-1');
    expect(data.roster).toEqual({ kind: 'ok', workers: [{ id: 'w-1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' }] });
  });

  it('a refused or failed roster read reaches the page as its own state, never as an empty list', async () => {
    for (const read of [{ kind: 'hidden' }, { kind: 'failed' }] as const) {
      const { load, loadTickerRoster } = await loadFull();
      loadTickerRoster.mockResolvedValue(read as never);
      const data = (await load(ev() as never)) as Record<string, unknown>;
      expect(data.roster).toEqual(read);
    }
  });
});
