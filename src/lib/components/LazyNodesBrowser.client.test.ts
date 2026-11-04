/**
 * portal#1700: the restored Nodes tab, on bounded reads. What a server render
 * cannot see: one page per user action, no double append, a retry that keeps
 * what is shown, a bounded DOM as folders and pages accumulate, and a teardown
 * (a memory switch re-keys the component) that leaves nothing in flight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureUnhandledRejections, mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
import { flushSync } from 'svelte';
import LazyNodesBrowser from './LazyNodesBrowser.svelte';

const MEM = 'mem-1';
const node = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `n${i}`, loc: `a:n${String(i).padStart(4, '0')}`, name: `Node ${i}`, description: null, nodeType: 'info', tags: [], memoryId: MEM,
  memory: { id: MEM, urn: 'hrn:mem:acme.com:m', name: 'M' }, ...extra,
});
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => node(from + i));

type Reply = { rows: unknown[]; hasMore: boolean } | 'fail' | Promise<Response>;
let replies: Record<string, Reply[]>;
let fetched: string[];
const key = (url: string) => url.replace(/^.*\/nodes\//, '');

beforeEach(() => {
  replies = {};
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(key(url));
    const queue = replies[key(url)] ?? [];
    const next = queue.shift();
    if (next instanceof Promise) return next;
    if (!next || next === 'fail') return new Response(JSON.stringify({ failed: true }), { status: 200 });
    return new Response(JSON.stringify(next), { status: 200 });
  });
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

async function mount() {
  const m = mountComponent(LazyNodesBrowser as never, { memoryId: MEM } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await wait(5);
  flushSync();
  return m;
}
const text = (m: Mounted<Record<string, unknown>>) => m.target.textContent ?? '';
const btn = (m: Mounted<Record<string, unknown>>, label: RegExp) =>
  [...m.target.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
const click = async (b: HTMLButtonElement | undefined) => { expect(b).toBeTruthy(); b!.click(); await wait(5); flushSync(); };

describe('Table (default)', () => {
  it('reads ONE page on mount, asks for no more until the reader does, and says the rows are partial', async () => {
    replies[`page?offset=0`] = [{ rows: range(0, 50), hasMore: true }];
    const m = await mount();
    expect(fetched).toEqual(['page?offset=0']);
    expect(text(m)).toContain('Node 0');
    expect(m.target.querySelector('[data-testid="table-partial"]')?.textContent).toMatch(/rows loaded so far, not the whole memory/);
    expect(btn(m, /Show more/)).toBeTruthy();
  });

  it('Show more reads the next offset; rows repeated by offset paging are shown once', async () => {
    replies['page?offset=0'] = [{ rows: range(0, 50), hasMore: true }];
    replies['page?offset=50'] = [{ rows: [...range(48, 2), ...range(50, 10)], hasMore: false }];
    const m = await mount();
    await click(btn(m, /Show more/));
    expect(fetched).toEqual(['page?offset=0', 'page?offset=50']);
    expect(m.target.querySelector('[data-testid="table-partial"]')?.textContent).toMatch(/End of the list\.\s*60 loaded/);
    expect(btn(m, /Show more/)).toBeUndefined();
  });

  it('a second click while a page is in flight does not append it twice', async () => {
    replies['page?offset=0'] = [{ rows: range(0, 50), hasMore: true }];
    let release!: (r: Response) => void;
    replies['page?offset=50'] = [new Promise<Response>((r) => { release = r; }) as never];
    const m = await mount();
    const more = btn(m, /Show more/)!;
    more.click(); more.click();
    await wait(2);
    release(new Response(JSON.stringify({ rows: range(50, 5), hasMore: false }), { status: 200 }));
    await wait(5); flushSync();
    expect(fetched.filter((f) => f === 'page?offset=50')).toHaveLength(1);
    expect(m.target.querySelector('[data-testid="table-partial"]')?.textContent).toMatch(/55 loaded/);
  });

  it('a failed page says so, keeps the rows, and Retry asks for the SAME offset', async () => {
    replies['page?offset=0'] = [{ rows: range(0, 50), hasMore: true }];
    replies['page?offset=50'] = ['fail', { rows: range(50, 3), hasMore: false }];
    const m = await mount();
    await click(btn(m, /Show more/));
    expect(m.target.querySelector('[role="alert"]')?.textContent).toMatch(/Could not load this page/);
    expect(text(m)).toContain('Node 0');
    await click(btn(m, /Retry/));
    expect(fetched.filter((f) => f === 'page?offset=50')).toHaveLength(2);
    expect(text(m)).toMatch(/53 loaded/);
  });

  it('a first-page failure is a failure with Retry, never "no nodes"', async () => {
    replies['page?offset=0'] = ['fail'];
    const m = await mount();
    expect(text(m)).toMatch(/Could not load this page/);
    expect(text(m)).not.toMatch(/No matching or visible nodes/);
    expect(btn(m, /Retry/)).toBeTruthy();
  });

  it('an empty page says "no matching or visible nodes", never "this memory is empty"', async () => {
    replies['page?offset=0'] = [{ rows: [], hasMore: false }];
    const m = await mount();
    expect(text(m)).toMatch(/No matching or visible nodes/);
    expect(text(m)).not.toMatch(/memory is empty|no nodes/i);
  });

  it('states the listing scope (system nodes and comments are not listed) and the offset caveat', async () => {
    replies['page?offset=0'] = [{ rows: range(0, 1), hasMore: false }];
    const m = await mount();
    const scope = m.target.querySelector('[data-testid="nodes-scope"]')?.textContent ?? '';
    expect(scope).toMatch(/System nodes and comments are not listed/);
    expect(scope).toMatch(/skip or repeat a row/);
  });

  it('links each row to its OWN memory, including an inherited base-memory row', async () => {
    const base = node(1, { memoryId: 'mem-base', memory: { id: 'mem-base', urn: 'hrn:mem:acme.com:base', name: 'Base' } });
    replies['page?offset=0'] = [{ rows: [node(0), base], hasMore: false }];
    const m = await mount();
    const hrefs = [...m.target.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`/app/memories/${MEM}/nodes/n0`);
    expect(hrefs).toContain('/app/memories/mem-base/nodes/n1');
    expect(hrefs).not.toContain(`/app/memories/${MEM}/nodes/n1`);
  });
});

describe('Tree', () => {
  async function mountTree() {
    window.localStorage.setItem('hadron:memoryBrowser:nodesPane', 'tree');
    return mount();
  }

  it('reads only the top level on open, with the node-less-branch limit and a Table link', async () => {
    replies['children?parent=&offset=0'] = [{ rows: range(0, 20), hasMore: true }];
    const m = await mountTree();
    expect(fetched).toEqual(['children?parent=&offset=0']);
    expect(m.target.querySelector('[data-testid="tree-limit"]')?.textContent).toMatch(/may leave out a branch that has none/);
    expect(btn(m, /Open the Table/)).toBeTruthy();
    expect(text(m)).toContain('Node 0');
  });

  it('expanding a folder reads that folder once; collapse and re-expand reads nothing more', async () => {
    replies['children?parent=&offset=0'] = [{ rows: range(0, 3), hasMore: false }];
    replies[`children?parent=${encodeURIComponent('a:n0000')}&offset=0`] = [{ rows: [node(100, { loc: 'a:n0000:c1', name: 'Child 1' })], hasMore: false }];
    const m = await mountTree();
    const expand = () => m.target.querySelector<HTMLButtonElement>('button[aria-label="Expand"]');
    await click(expand()!);
    expect(text(m)).toContain('Child 1');
    await click(m.target.querySelector<HTMLButtonElement>('button[aria-label="Collapse"]')!);
    expect(text(m)).not.toContain('Child 1');
    await click(expand()!);
    expect(text(m)).toContain('Child 1');
    expect(fetched.filter((f) => f.includes('n0000'))).toHaveLength(1);
  });

  it('a folder with no children says so; a failed folder keeps the rows and retries the same page', async () => {
    replies['children?parent=&offset=0'] = [{ rows: range(0, 2), hasMore: false }];
    replies[`children?parent=${encodeURIComponent('a:n0000')}&offset=0`] = [{ rows: [], hasMore: false }];
    replies[`children?parent=${encodeURIComponent('a:n0001')}&offset=0`] = ['fail', { rows: [node(7, { loc: 'a:n0001:k', name: 'Kid' })], hasMore: false }];
    const m = await mountTree();
    const expands = () => [...m.target.querySelectorAll<HTMLButtonElement>('button[aria-label="Expand"]')];
    await click(expands()[0]);
    expect(text(m)).toContain('No child nodes');
    await click(expands()[0]);
    expect(text(m)).toContain('Could not load this page');
    expect(text(m)).toContain('Node 0');
    await click(btn(m, /Retry/));
    expect(text(m)).toContain('Kid');
  });

  it('Show more at a level reads the next offset and dedupes a repeated row', async () => {
    replies['children?parent=&offset=0'] = [{ rows: range(0, 20), hasMore: true }];
    replies['children?parent=&offset=20'] = [{ rows: [node(19), ...range(20, 2)], hasMore: false }];
    const m = await mountTree();
    await click(btn(m, /Show more/));
    expect(fetched).toEqual(['children?parent=&offset=0', 'children?parent=&offset=20']);
    expect(m.target.querySelectorAll('[role="treeitem"]')).toHaveLength(22);
  });

  it('keeps the DOM bounded as pages accumulate (windowed rows)', async () => {
    replies['children?parent=&offset=0'] = [{ rows: range(0, 20), hasMore: true }];
    for (let p = 1; p <= 40; p++) replies[`children?parent=&offset=${p * 20}`] = [{ rows: range(p * 20, 20), hasMore: p < 40 }];
    const m = await mountTree();
    const scroller = m.target.querySelector<HTMLElement>('[data-testid="tree-scroller"]')!;
    const toEnd = () => { Object.defineProperty(scroller, 'scrollTop', { value: 1e9, configurable: true }); scroller.dispatchEvent(new Event('scroll')); flushSync(); };
    for (let p = 1; p <= 40; p++) {
      // The Show more row is the last row: a reader scrolls to it, and only then is it mounted.
      toEnd();
      await click(btn(m, /Show more/));
    }
    expect(m.target.querySelectorAll('[role="treeitem"]').length).toBeLessThan(80);
    // ...while every loaded row is still counted in the scroller's height
    const ul = m.target.querySelector<HTMLElement>('[role="tree"]')!;
    expect(parseInt(ul.style.height, 10)).toBeGreaterThan(800 * 32);
  });

  it('an empty top level says "no matching or visible nodes"', async () => {
    replies['children?parent=&offset=0'] = [{ rows: [], hasMore: false }];
    const m = await mountTree();
    expect(text(m)).toMatch(/No matching or visible nodes/);
    expect(text(m)).not.toMatch(/memory is empty/i);
  });

  it('labels an inherited row and a root (empty-loc) node', async () => {
    replies['children?parent=&offset=0'] = [{ rows: [node(0, { loc: '', name: '' }), node(1, { memoryId: 'mem-base' })], hasMore: false }];
    const m = await mountTree();
    expect(text(m)).toContain('(root node)');
    expect(text(m)).toContain('inherited');
  });
});

describe('teardown', () => {
  it('a memory switch (unmount) with a read in flight leaves no rejection and no later read', async () => {
    let release!: (r: Response) => void;
    replies['page?offset=0'] = [new Promise<Response>((r) => { release = r; }) as never];
    const rejections = await captureUnhandledRejections(async () => {
      const m = mountComponent(LazyNodesBrowser as never, { memoryId: MEM } as never) as Mounted<Record<string, unknown>>;
      await tick();
      m.unmount();
      release(new Response(JSON.stringify({ rows: range(0, 3), hasMore: true }), { status: 200 }));
      await wait(10);
    });
    expect(rejections).toEqual([]);
    expect(fetched).toEqual(['page?offset=0']);
  });
});
