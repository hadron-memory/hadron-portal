/**
 * portal#1341 — the ticker detail page tells a malformed reasons list from a real reason
 * that happens to read like the "Reasons unavailable" sentence. CLIENT lane: it asserts what
 * the mounted page renders for the reasons row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';

vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const ticker = (reasons: unknown) => ({
  id: 'tk-1', name: 'eng', slug: 'eng', urn: 'hrn:ticker:acme.com:team:eng',
  enabled: true, cadenceSeconds: 600, anchorAt: '2026-10-01T00:00:00Z',
  nextTickAt: null, lastTickAt: null, quietHours: null, relevance: 'ALL', channels: [],
  owner: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: null, reasons,
});

async function reasonsRow(reasons: unknown): Promise<string> {
  setStubPage('https://example.test/app/apps/app-1/tickers/tk-1', { appId: 'app-1', tickerId: 'tk-1' });
  const m = mountComponent(Page as never, {
    data: { app, ticker: ticker(reasons), subscribers: { kind: 'failed' }, paged: false, impersonating: null },
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  const dt = [...m.target.querySelectorAll('dt')].find((d) => d.textContent?.trim() === 'Wakes when')!;
  return dt.nextElementSibling!.textContent ?? '';
}

describe('Ticker detail — reasons row (portal#1341)', () => {
  it('shows a reason spelled like the unavailable text as a reason, with the unrecognised note', async () => {
    const text = await reasonsRow(['Reasons unavailable']);
    expect(text).toContain('Reasons unavailable');
    expect(text).toContain('(unrecognised)');
  });

  it('still shows the malformed case as unavailable, with no reason list', async () => {
    const text = await reasonsRow(['EVERY_TICK', 3]);
    expect(text.trim()).toBe('Reasons unavailable');
  });
});
