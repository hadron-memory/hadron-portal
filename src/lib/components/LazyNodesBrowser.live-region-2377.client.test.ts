/**
 * portal#2344 / #2377: the Nodes tab's loading lines are persistent LiveRegions: one beside the
 * Table (a page read) and one beside the Tree (a folder read). Each exists empty before the read,
 * speaks during it, and is the same element after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, wait, type Mounted } from '$lib/test/mountComponent';
import { announcedStatusRegion } from '$lib/test/firstPopulatedStatusText';
import LazyNodesBrowser from './LazyNodesBrowser.svelte';

const MEM = 'mem-1';
const node = (i: number) => ({
  id: `n${i}`, loc: `a:n${String(i).padStart(4, '0')}`, name: `Node ${i}`, description: null, nodeType: 'info', tags: [], memoryId: MEM,
  memory: { id: MEM, urn: 'hrn:mem:acme.com:m', name: 'M' },
});
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => node(from + i));
const key = (url: string) => url.replace(/^.*\/nodes\//, '');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

let replies: Record<string, Array<unknown | Promise<Response>>>;
beforeEach(() => {
  replies = {};
  vi.stubGlobal('fetch', async (url: string) => {
    const next = (replies[key(url)] ?? []).shift();
    if (next instanceof Promise) return next;
    return json(next ?? { failed: true });
  });
  try { window.localStorage.clear(); } catch { /* ignore */ }
});
const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });

async function mount() {
  const m = mountComponent(LazyNodesBrowser as never, { memoryId: MEM } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await wait(5); flushSync();
  return m;
}
const settle = async () => { await wait(5); flushSync(); };
const statuses = (m: Mounted<Record<string, unknown>>) => [...m.target.querySelectorAll<HTMLElement>('[role="status"]')];

describe('LazyNodesBrowser: loading lines are persistent live regions (portal#2344)', () => {
  it('Table: Load more speaks inside a region that already existed, empty, and leaves it in place', async () => {
    let finish!: (r: Response) => void;
    replies['page?offset=0'] = [{ rows: range(0, 50), hasMore: true }];
    replies['page?offset=50'] = [new Promise<Response>((resolve) => { finish = resolve; })];
    const m = await mount();

    const idle = statuses(m).filter((r) => !r.textContent?.trim());
    expect(idle.length).toBeGreaterThan(0); // BEFORE: the region exists
    expect(announcedStatusRegion(m.target)).toBeNull();

    [...m.target.querySelectorAll('button')].find((b) => /Load more nodes/.test(b.textContent ?? ''))!.click();
    await settle();
    const during = announcedStatusRegion(m.target);
    expect(during?.textContent?.trim()).toBe('Loading…'); // DURING
    expect(idle).toContain(during);

    finish(json({ rows: range(50, 5), hasMore: false }));
    await settle();
    expect(during!.isConnected).toBe(true); // AFTER: same element, empty
    expect(during!.textContent?.trim()).toBe('');
  });

  it('Tree: expanding a folder speaks in the tree region that already existed, empty', async () => {
    let finish!: (r: Response) => void;
    window.localStorage.setItem('hadron:memoryBrowser:nodesPane', 'tree');
    replies['children?parent=&offset=0'] = [{ rows: range(0, 3), hasMore: false }];
    replies[`children?parent=${encodeURIComponent('a:n0000')}&offset=0`] = [new Promise<Response>((resolve) => { finish = resolve; })];
    const m = await mount();

    const region = m.target.querySelector<HTMLElement>('[data-testid="tree-loading"]');
    expect(region, 'the tree region exists before any folder is read').not.toBeNull();
    expect(region!.getAttribute('role')).toBe('status');
    expect(region!.textContent?.trim()).toBe(''); // BEFORE

    m.target.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')!.click();
    await settle();
    expect(m.target.querySelector('[data-testid="tree-loading"]')).toBe(region);
    expect(region!.textContent?.trim()).toBe('Loading a:n0000…'); // DURING: the folder is named

    finish(json({ rows: [{ ...node(100), loc: 'a:n0000:c1', name: 'Child 1' }], hasMore: false }));
    await settle();
    expect(m.target.querySelector('[data-testid="tree-loading"]')).toBe(region); // AFTER
    expect(region!.textContent?.trim()).toBe('');
  });
  it('Tree: a second folder that starts while the first is pending is a new entry in the same region', async () => {
    let finishA!: (r: Response) => void;
    let finishB!: (r: Response) => void;
    window.localStorage.setItem('hadron:memoryBrowser:nodesPane', 'tree');
    replies['children?parent=&offset=0'] = [{ rows: range(0, 3), hasMore: false }];
    replies[`children?parent=${encodeURIComponent('a:n0000')}&offset=0`] = [new Promise<Response>((resolve) => { finishA = resolve; })];
    replies[`children?parent=${encodeURIComponent('a:n0001')}&offset=0`] = [new Promise<Response>((resolve) => { finishB = resolve; })];
    const m = await mount();
    const region = m.target.querySelector<HTMLElement>('[data-testid="tree-loading"]')!;

    const expand = () => [...m.target.querySelectorAll<HTMLButtonElement>('button[aria-label="Expand"]')];
    expand()[0].click();
    await settle();
    const first = [...region.children].map((c) => c.textContent?.trim());
    expect(first).toEqual(['Loading a:n0000…']);

    expand()[0].click(); // the next collapsed folder, while the first read is still pending
    await settle();
    // The region gained an entry for B (an addition a reader hears); it is not the same text as before.
    expect([...region.children].map((c) => c.textContent?.trim())).toEqual(['Loading a:n0000…', 'Loading a:n0001…']);

    finishA(json({ rows: [], hasMore: false }));
    finishB(json({ rows: [], hasMore: false }));
    await settle();
    expect(m.target.querySelector('[data-testid="tree-loading"]')).toBe(region);
    expect(region.textContent?.trim()).toBe('');
  });
});
