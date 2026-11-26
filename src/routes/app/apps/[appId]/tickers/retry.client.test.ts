/**
 * portal#1457 item 4 — the failed-state "Try again" is clicked, and the click
 * refreshes the page's data exactly once. CLIENT lane: a server render never
 * runs a click handler, so the retry rendered in page.test.ts was never pinned.
 * Mutant: drop the `onclick={refresh}` handler and these go red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { setStubPage, resetStubPage } from '$lib/test/stubs/app-stores';

vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));
import Detail from './[tickerId]/+page.svelte';
import List from '../AppTickers.svelte';
import { sectionProps } from '$lib/test/ticker-section-props';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { announcedStatusRegion } from '$lib/test/firstPopulatedStatusText';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const settings = { kind: 'ok', value: { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 480, dailyWakeBudgetDerived: true } };
const delivery = { kind: 'ok', value: { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false } };
const ticker = {
  id: 'tk-1', name: 'eng', slug: 'eng', tickCode: 'tick.eng', urn: 'hrn:ticker:acme.com:team:eng',
  enabled: true, cadenceSeconds: 600, anchorAt: '2026-10-01T00:00:00Z',
  nextTickAt: null, lastTickAt: null, quietHours: null, relevance: 'ALL', channels: [],
  owner: { id: 'w-1', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' },
  createdAt: '2026-10-01T00:00:00Z', updatedAt: null, reasons: ['READ_TEAM_CHANNEL'],
};

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  resetStubPage();
});

const invalidations = () => navigationCalls.filter((c) => c.fn === 'invalidateAll').length;
const retryButtons = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === 'Try again');

describe('portal#1457 — Try again refreshes once', () => {
  it('ticker page: the failed Task read’s retry calls invalidateAll exactly once', async () => {
    setStubPage('http://localhost/app/apps/app-1/tickers/tk-1', { appId: 'app-1', tickerId: 'tk-1' });
    const m = mountComponent(Detail as never, {
      data: {
        app, ticker, paged: false, after: null, impersonating: null, settings, loadedAt: '2026-10-16T10:00:00Z',
        tickerTask: { kind: 'failed' }, roster: { kind: 'ok', workers: [] },
        subscribers: { kind: 'ok', value: { items: [], hasNextPage: false, endCursor: null } },
      },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const buttons = retryButtons(m.target);
    expect(buttons.length).toBe(1);
    expect(invalidations()).toBe(0);
    buttons[0].click();
    await tick(2);
    expect(invalidations()).toBe(1);
  });

  // The list is a section of Settings now: its retry reads the section's slice again through the tab endpoint (not the
  // page load), once, and shows what comes back. Mutant: drop the `onclick={refresh}` handler, or read the page load.
  it('tickers section: the failed load’s retry reads the section again exactly once and shows the answer', async () => {
    setStubPage('http://localhost/app/apps/app-1', { appId: 'app-1' });
    const fetched: string[] = [];
    const panel = (tickers: unknown) => ({ tickers, settings, delivery, subscriberCountPage: 50, loadedAt: '2026-10-16T10:00:00Z', impersonating: null });
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return { ok: true, json: async () => ({ tickersPanel: panel({ kind: 'ok', value: [{ ...ticker, subscribers: { hasNextPage: false, items: [] } }] }) }) };
    });
    try {
      const m = mountComponent(List as never, sectionProps({ app, ...panel({ kind: 'failed' }) }) as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      const buttons = retryButtons(m.target);
      expect(buttons.length).toBe(1);
      expect(fetched).toEqual([]);
      buttons[0].click();
      await tick(4);
      expect(fetched).toEqual(['/app/apps/app-1/tab?tab=tickers']);
      expect(invalidations()).toBe(0);
      expect(retryButtons(m.target)).toHaveLength(0);
      expect(m.target.textContent).toContain('eng');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // A write that landed must be reported even when the re-read after it fails: the failed read only marks the list stale
  // (hrn:pr hadron-portal#2644 review). Mutant: hand the form the bare `reload`, and its submit handler rejects before
  // it reports anything.
  it('a created ticker is reported when the re-read after it fails, and the section says it could not refresh', async () => {
    setStubPage('http://localhost/app/apps/app-1', { appId: 'app-1' });
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }));
    try {
      const panel = { tickers: { kind: 'ok', value: [] }, settings, delivery, subscriberCountPage: 50, loadedAt: '2026-10-16T10:00:00Z', impersonating: null };
      const m = mountComponent(List as never, sectionProps({ app, ...panel }) as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      const form = m.target.querySelector<HTMLFormElement>('form[data-testid]')!;
      const name = form.querySelector<HTMLInputElement>('input[name="name"]')!;
      name.value = 'standup';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      await tick(2);
      await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { action: 'createTicker', ok: true, ticker: { id: 'tk-9', name: 'standup' } } });
      await tick(4);
      expect(announcedStatusRegion(m.target)!.firstElementChild!.textContent).toContain('Created standup.');
      expect(m.target.textContent).toContain('Couldn’t refresh.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a failed refresh keeps what is shown and says so', async () => {
    setStubPage('http://localhost/app/apps/app-1', { appId: 'app-1' });
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) }));
    try {
      const m = mountComponent(List as never, sectionProps({ app, tickers: { kind: 'failed' }, settings, delivery, subscriberCountPage: 50, loadedAt: '2026-10-16T10:00:00Z', impersonating: null }) as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      retryButtons(m.target)[0].click();
      await tick(4);
      expect(m.target.textContent).toContain('Couldn’t refresh.');
      expect(retryButtons(m.target)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
