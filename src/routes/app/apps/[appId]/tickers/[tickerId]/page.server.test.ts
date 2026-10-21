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
}));

const ev = (appId = 'app-1', tickerId = 'tk-1') => ({
  params: { appId, tickerId },
  locals: { token: 't', impersonation: null, user: null },
  url: new URL(`https://x.test/app/apps/${appId}/tickers/${tickerId}`),
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
});
