/**
 * portal#1413 slice B — the stops page's visible copy, mounted. B1 the row Lift hit area, B3 the banner time
 * naming its zone is in StopBanner.test.ts, B6 paging and empty-cursor copy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';

const sig = (id: string, over: Record<string, unknown> = {}) => ({
  id, level: 'PAUSE', scope: 'WORKER', targetWorkerId: 'w1', targetHostId: null, setAt: '2026-10-01T10:00:00Z', until: null,
  setByUserId: null, setByHostKey: false, live: true, endedAt: null, endKind: null, endedByUserId: null, endedByHostKey: false, ...over,
});
const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = '';
});
async function html(over: { signals?: unknown[]; after?: string | null; hasNext?: boolean; manages?: string } = {}) {
  const data = {
    app: { id: 'app-1', name: 'Acme', organizationId: null },
    page: { kind: 'ok', value: { signals: over.signals ?? [], pageInfo: { hasNextPage: over.hasNext ?? false, endCursor: over.hasNext ? 'c1' : null } } },
    live: { kind: 'ok', value: { complete: true, signals: [] } },
    manages: over.manages ?? 'yes',
    workers: [{ id: 'w1', name: 'Gaby', urn: null }],
    rosterFailed: false,
    people: {},
    after: over.after ?? null,
    loadedAt: '2026-10-01T10:00:00Z',
    impersonating: null,
  };
  const m = mountComponent(Page as never, { data } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target.innerHTML;
}

describe('B1 row Lift', () => {
  it('is a 44px hit area', async () => {
    const out = await html({ signals: [sig('s1')] });
    const btn = /<button[^>]*>\s*Lift\s*<\/button>/.exec(out)?.[0] ?? '';
    expect(btn).toMatch(/min-h-11/);
    expect(btn).toMatch(/min-w-11/);
  });
});

describe('B6 paging copy', () => {
  it('the cursor link says older, because the list is newest first', async () => {
    const out = await html({ signals: [sig('s1')], hasNext: true });
    expect(out).toContain('Show older stops');
    expect(out).not.toContain('Show later stops');
  });

  it('an empty cursor page says there are no older stops and links back to the first page', async () => {
    const out = await html({ signals: [], after: 'c1' });
    expect(out).toContain('No older stops.');
    expect(out).not.toContain('No stops have been set on this App.');
    expect(out).toMatch(/<a href="\?"[^>]*>[^<]*first stops/);
  });

  it('an empty first page still says none have been set', async () => {
    const out = await html({ signals: [] });
    expect(out).toContain('No stops have been set on this App.');
    expect(out).not.toContain('No older stops.');
  });
});
