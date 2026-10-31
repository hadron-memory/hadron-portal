/**
 * portal#1497 (MCP cut R7a) — the three controls ON THE RENDERED PAGE: turning
 * the ticker off keeps the subscriber list exactly as it was (cor:agt:080:06 —
 * the page never implies that off removes anyone), each control is a real
 * focusable button in the page's tab order, and the page carries cor:agt:080:20's
 * sentence beside the subscriber controls (the same sentence the server's
 * SUBSCRIBE_FORBIDDEN refusal answers with).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { setStubPage, resetStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const ticker = (enabled: boolean) => ({
  id: 'tk-1', name: 'eng', slug: 'eng', urn: 'hrn:ticker:acme.com:team:eng',
  enabled, cadenceSeconds: 600, anchorAt: '2026-10-01T00:00:00Z',
  nextTickAt: null, lastTickAt: null, quietHours: null, relevance: 'ALL', channels: [],
  owner: { id: 'w-1', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' },
  createdAt: '2026-10-01T00:00:00Z', updatedAt: null, reasons: ['READ_TEAM_CHANNEL'],
});
const subscriber = (id: string, workerId: string, name: string) => ({
  id, createdAt: '2026-10-10T00:00:00Z', viaGrant: false,
  createdBy: { id: 'w-ada', name: 'Ada', urn: null },
  worker: { id: workerId, name, urn: `hrn:worker:acme.com:team:${workerId}`, retiredAt: null },
});
const ROSTER = { kind: 'ok', workers: [
  { id: 'w-1', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' },
  { id: 'w-2', name: 'Liam', urn: 'hrn:worker:acme.com:team:liam' },
] };
const SUBSCRIBERS = { kind: 'ok', value: { items: [subscriber('s1', 'w-2', 'Liam'), subscriber('s2', 'w-3', 'Vera')], hasNextPage: false, endCursor: null } };

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  resetStubPage();
  sessionStorage.clear();
});

async function mountPage(tickerEnabled = true) {
  setStubPage('http://localhost/app/apps/app-1/tickers/tk-1', { appId: 'app-1', tickerId: 'tk-1' });
  const m = mountComponent(Page as never, {
    data: {
      app, ticker: ticker(tickerEnabled), subscribers: SUBSCRIBERS, tickerTask: { kind: 'ok', value: { registerTaskLoc: null } },
      roster: ROSTER, paged: false, after: null, impersonating: null,
    },
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

const rowWorkers = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="subscribers-empty"], table tbody tr')].map((r) => r.textContent ?? '');

describe('portal#1497 — the controls on the rendered page', () => {
  it('turning the ticker OFF leaves the subscriber list exactly as it was (cor:agt:080:06)', async () => {
    const root = await mountPage(true);
    const before = rowWorkers(root);
    expect(before.length).toBe(2);
    const form = root.querySelector<HTMLFormElement>('[data-testid="ticker-enabled-control"] form')!;
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { action: 'set-enabled', ok: true, target: { tickerId: 'tk-1' }, enabled: false } });
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-enabled-result"]')!.textContent).toContain('Turned off.');
    expect(rowWorkers(root)).toEqual(before); // nobody was removed by turning it off
  });

  it('each control is a real focusable button in the page (Tab reaches it): on/off, Add, and every row’s Remove', async () => {
    const root = await mountPage(true);
    const focusable = [...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    const text = (b: HTMLButtonElement) => b.textContent ?? '';
    expect(focusable.some((b) => text(b).includes('Turn off'))).toBe(true);
    expect(focusable.some((b) => text(b).includes('Add subscriber'))).toBe(true);
    const removes = focusable.filter((b) => text(b).includes('Remove'));
    expect(removes).toHaveLength(2); // one per row, whatever the roster said (w-3 is not in it)
    for (const b of focusable) expect(b.tabIndex).toBe(0); // nothing is reached by pointer only
  });

  it('cor:agt:080:20’s sentence sits beside the subscriber controls — the same text the SUBSCRIBE_FORBIDDEN refusal uses', async () => {
    const root = await mountPage(true);
    const line = root.querySelector('[data-testid="ticker-subscriber-who"]')!;
    expect(line.textContent).toBe('Only a worker’s holder or whoever manages the App can subscribe or unsubscribe that worker.');
    // and the on/off line above still states cor:agt:080:18's rule, with no tool pointer left (D4)
    const who = [...root.querySelectorAll('p')].map((p) => p.textContent ?? '').find((t) => t.includes('Only its owner'));
    expect(who).toContain('Only its owner, the owning worker’s holder, or whoever manages the App can change this ticker.');
    expect(who).not.toContain('MCP');
    expect(who).not.toContain('hadron_ticker');
  });

  it('the who-may line and the Add control are NOT offered to a non-participant (the roster’s "not offered" state)', async () => {
    const root = await mountPage(true);
    // sanity: present for a participant…
    expect(root.querySelector('[data-testid="ticker-subscriber-who"]')).not.toBeNull();
    const m = mountComponent(Page as never, {
      data: {
        app, ticker: ticker(true), subscribers: { kind: 'not-participant' }, tickerTask: { kind: 'ok', value: { registerTaskLoc: null } },
        roster: ROSTER, paged: false, after: null, impersonating: null,
      },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    expect(m.target.querySelector('[data-testid="ticker-subscriber-who"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="ticker-add-subscriber"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="ticker-enabled-control"]')).not.toBeNull(); // D1: on/off is every participant's
  });
});
