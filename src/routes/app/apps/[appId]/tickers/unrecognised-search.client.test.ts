/**
 * portal#1314 — the Tickers grid finds a row by the "(unrecognised)" note its reasons cell
 * renders. CLIENT lane: the search box filters a mounted grid, which a server render never
 * builds, and only the mounted page shows which projection the column wires in
 * (`hrn:node:hadronmemory.com:hadron-portal:review:everything-the-cell-renders-must-be-searchable`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';

vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));
import Page from '../AppTickers.svelte';
import { sectionProps } from '$lib/test/ticker-section-props';


const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const settings = { kind: 'ok', value: { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 480, dailyWakeBudgetDerived: true } };
const delivery = { kind: 'ok', value: { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false } };

const ticker = (name: string, reasons: unknown) => ({
  id: `id-${name}`, name, slug: name, urn: `hrn:ticker:acme.com:team:${name}`,
  enabled: true, cadenceSeconds: 600, anchorAt: '2026-10-01T00:00:00Z',
  nextTickAt: null, lastTickAt: null, quietHours: null, relevance: 'ALL', channels: [],
  owner: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: null,
  subscribers: { hasNextPage: false, items: [] }, reasons,
});

function mountPage() {
  setStubPage('https://example.test/app/apps/app-1/tickers', { appId: 'app-1' });
  const m = mountComponent(Page as never, sectionProps({
      app,
      tickers: { kind: 'ok', value: [
        ticker('future', ['READ_TEAM_CHANNEL', 'SOMETHING_NEW']),
        ticker('known', ['EVERY_TICK']),
        ticker('broken', ['SOMETHING_NEW', 3]),
      ] },
      settings, delivery, subscriberCountPage: 50, loadedAt: '2026-10-16T10:00:00Z', impersonating: null,
  }) as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}

async function search(target: HTMLElement, text: string) {
  const box = target.querySelector<HTMLInputElement>('input[aria-label="Search tickers…"]')!;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
}

const names = (t: HTMLElement) =>
  [...t.querySelectorAll('tbody tr')].map((r) => r.querySelector('a[href*="/tickers/"]')?.textContent?.trim());

describe('Tickers — searching the unrecognised-reason note (portal#1314)', () => {
  it('finds a well-formed unknown-reason row by the note it renders, and not a known or malformed row', async () => {
    const { target } = mountPage();
    await tick(2);
    // Positive control: all rows render, and the note is on screen for the unknown reason.
    expect(names(target)).toEqual(expect.arrayContaining(['future', 'known', 'broken']));
    expect(target.textContent).toContain('(unrecognised)');

    await search(target, 'unrecognised');
    expect(names(target)).toEqual(['future']);
  });

  it('still finds the row by the raw reason name', async () => {
    const { target } = mountPage();
    await tick(2);
    await search(target, 'something_new');
    expect(names(target)).toEqual(expect.arrayContaining(['future']));
  });

  // portal#1341: a reason that reads like the "unavailable" sentence is still a reason.
  it('renders a reason equal to the unavailable text as a reason, and finds it by that text', async () => {
    setStubPage('https://example.test/app/apps/app-1/tickers', { appId: 'app-1' });
    const m = mountComponent(Page as never, sectionProps({
      app,
      tickers: { kind: 'ok', value: [ticker('lookalike', ['Reasons unavailable']), ticker('broken', ['EVERY_TICK', 3]), ticker('known', ['EVERY_TICK'])] },
      settings, delivery, subscriberCountPage: 50, loadedAt: '2026-10-16T10:00:00Z', impersonating: null,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const row = (n: string) => [...m.target.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes(n))!;
    // The look-alike is a well-formed unknown reason: it shows the unrecognised note; the malformed row does not.
    expect(row('lookalike').textContent).toContain('(unrecognised)');
    expect(row('broken').textContent).not.toContain('(unrecognised)');

    await search(m.target, 'unrecognised');
    expect(names(m.target)).toEqual(['lookalike']);
  });
});
