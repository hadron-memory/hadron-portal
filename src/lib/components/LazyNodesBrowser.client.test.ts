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
    expect(btn(m, /Load more nodes/)).toBeTruthy();
  });

  it('Load more nodes reads the next offset; rows repeated by offset paging are shown once', async () => {
    replies['page?offset=0'] = [{ rows: range(0, 50), hasMore: true }];
    replies['page?offset=50'] = [{ rows: [...range(48, 2), ...range(50, 10)], hasMore: false }];
    const m = await mount();
    await click(btn(m, /Load more nodes/));
    expect(fetched).toEqual(['page?offset=0', 'page?offset=50']);
    expect(m.target.querySelector('[data-testid="table-partial"]')?.textContent).toMatch(/End of the list\.\s*60 loaded/);
    expect(btn(m, /Load more nodes/)).toBeUndefined();
  });

  it('a second click while a page is in flight does not append it twice', async () => {
    replies['page?offset=0'] = [{ rows: range(0, 50), hasMore: true }];
    let release!: (r: Response) => void;
    replies['page?offset=50'] = [new Promise<Response>((r) => { release = r; }) as never];
    const m = await mount();
    const more = btn(m, /Load more nodes/)!;
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
    await click(btn(m, /Load more nodes/));
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

  it('portal#2378: the empty-page note is announced by a region that exists, empty, while the page loads', async () => {
    let finish!: (v: unknown) => void;
    replies['page?offset=0'] = [new Promise((resolve) => { finish = resolve; }) as never];
    const m = await mount();
    const region = () => m.target.querySelector<HTMLElement>('[data-testid="nodes-tab-none"]');
    const before = region();
    expect(before, 'mounted while the first page is in flight').not.toBeNull();
    expect(before!.getAttribute('role')).toBe('status');
    expect(before!.textContent?.trim()).toBe('');
    finish(new Response(JSON.stringify({ rows: [], hasMore: false }), { status: 200 }));
    await wait(5); flushSync();
    expect(region()).toBe(before);
    expect(before!.textContent).toContain('No matching or visible nodes');
  });

  it('states the listing scope (system nodes and comments are not listed) and the offset caveat', async () => {
    replies['page?offset=0'] = [{ rows: range(0, 1), hasMore: false }];
    const m = await mount();
    const scope = m.target.querySelector('[data-testid="nodes-scope"]')?.textContent ?? '';
    expect(scope).toMatch(/System nodes and comments are not listed/);
    expect(scope).toMatch(/skip or repeat a row/);
  });

  it('links each row to its OWN memory, including an inherited base-memory row', async () => {
    // The server sends memory:null on every inherited node; the row's memoryId is its address.
    const base = node(1, { memoryId: 'mem-base', memory: null, urn: 'hrn:node:acme.com:base:a:n0001' });
    replies['page?offset=0'] = [{ rows: [node(0), base], hasMore: false }];
    const m = await mount();
    const hrefs = [...m.target.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`/app/memories/${MEM}/nodes/n0`);
    expect(hrefs).toContain('/app/memories/mem-base/nodes/n1');
    expect(hrefs).not.toContain(`/app/memories/${MEM}/nodes/n1`);
    // Only the inherited row carries the marker, and its URN is the node's own.
    expect(m.target.querySelectorAll('[data-testid="node-inherited"]')).toHaveLength(1);
    expect([...m.target.querySelectorAll('[title]')].some((e) => e.getAttribute('title') === 'hrn:node:acme.com:base:a:n0001')).toBe(true);
  });

  it('the Table itself has no local filter box (hideSearch holds; the tab\'s own box is the server search) and labels the empty-loc root node', async () => {
    replies['page?offset=0'] = [{ rows: [node(0), node(1, { loc: '', name: '' })], hasMore: false }];
    const m = await mount();
    expect(m.target.querySelector('[data-testid="table-header"] input')).toBeNull();
    expect(m.target.textContent).toContain('(root node)');
    expect(m.target.querySelectorAll('[data-testid="node-inherited"]')).toHaveLength(0);
  });

  it('the header toggle names only what it holds: Columns, not search or views (#2693)', async () => {
    replies['page?offset=0'] = [{ rows: [node(0)], hasMore: false }];
    const m = await mount();
    const toggle = m.target.querySelector('[data-testid="table-header-toggle"]');
    expect(toggle?.textContent?.trim()).toBe('Columns');
    expect(toggle?.textContent).not.toMatch(/search|views/i);
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

  it('a loc that names an Object.prototype member opens like any other and does not wedge the Tree', async () => {
    replies['children?parent=&offset=0'] = [{ rows: [node(0, { loc: 'constructor', name: 'Ctor' }), node(1, { loc: '__proto__', name: 'Proto' })], hasMore: false }];
    replies['children?parent=constructor&offset=0'] = [{ rows: [node(5, { loc: 'constructor:k', name: 'CtorKid' })], hasMore: false }];
    const m = await mountTree();
    const expand = () => m.target.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')!;
    await click(expand());
    expect(text(m)).toContain('CtorKid');
    expect(text(m)).toContain('Proto');
    expect(m.target.querySelector('[data-testid="tree-list"]')).toBeTruthy();
  });

  it('a Tree row links to its own memory, an inherited one to its base memory', async () => {
    replies['children?parent=&offset=0'] = [{ rows: [node(0), node(1, { memoryId: 'mem-base', memory: null })], hasMore: false }];
    const m = await mountTree();
    const hrefs = [...m.target.querySelectorAll('[data-testid="tree-node"]')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([`/app/memories/${MEM}/nodes/n0`, '/app/memories/mem-base/nodes/n1']);
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

  it('Load more nodes at a level reads the next offset and dedupes a repeated row', async () => {
    replies['children?parent=&offset=0'] = [{ rows: range(0, 20), hasMore: true }];
    replies['children?parent=&offset=20'] = [{ rows: [node(19), ...range(20, 2)], hasMore: false }];
    const m = await mountTree();
    await click(btn(m, /Load more nodes/));
    expect(fetched).toEqual(['children?parent=&offset=0', 'children?parent=&offset=20']);
    expect(m.target.querySelectorAll('[data-testid="tree-node"]')).toHaveLength(22);
  });

  it('keeps the DOM bounded as pages accumulate (windowed rows)', async () => {
    replies['children?parent=&offset=0'] = [{ rows: range(0, 20), hasMore: true }];
    for (let p = 1; p <= 40; p++) replies[`children?parent=&offset=${p * 20}`] = [{ rows: range(p * 20, 20), hasMore: p < 40 }];
    const m = await mountTree();
    const scroller = m.target.querySelector<HTMLElement>('[data-testid="tree-scroller"]')!;
    const toEnd = () => { Object.defineProperty(scroller, 'scrollTop', { value: 1e9, configurable: true }); scroller.dispatchEvent(new Event('scroll')); flushSync(); };
    for (let p = 1; p <= 40; p++) {
      // The Load more nodes row is the last row: a reader scrolls to it, and only then is it mounted.
      toEnd();
      await click(btn(m, /Load more nodes/));
    }
    expect(m.target.querySelectorAll('[data-testid="tree-node"]').length).toBeLessThan(80);
    // ...while every loaded row is still counted in the scroller's height
    const ul = m.target.querySelector<HTMLElement>('[data-testid="tree-list"]')!;
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

describe('content search (#2693)', () => {
  const box = (m: Mounted<Record<string, unknown>>) => m.target.querySelector('[data-testid="nodes-search"]') as HTMLInputElement;
  const type = async (m: Mounted<Record<string, unknown>>, v: string, settle = 340) => {
    const el = box(m);
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(settle);
    flushSync();
  };
  const found = (rows: unknown[], hasMore = false) => ({ rows, hasMore });

  it('has an accessibly named search box that asks the SERVER (debounced, one read for a burst), never filtering loaded rows', async () => {
    replies['page?offset=0'] = [found(range(0, 3))];
    replies['page?offset=0&q=zeta'] = [found([node(7, { name: 'Zeta hit' })])];
    const m = await mount();
    expect(box(m).getAttribute('aria-label')).toBeTruthy();
    // typing the first letters does not read yet; only the settled text does, once
    for (const v of ['z', 'ze', 'zet', 'zeta']) { box(m).value = v; box(m).dispatchEvent(new Event('input', { bubbles: true })); await wait(20); }
    expect(fetched).toEqual(['page?offset=0']);
    await wait(340);
    flushSync();
    expect(fetched).toEqual(['page?offset=0', 'page?offset=0&q=zeta']);
    // the old loaded rows are gone: the list is the server's answer, not a local filter
    expect(text(m)).toContain('Zeta hit');
    expect(text(m)).not.toContain('Node 0');
    expect(text(m)).toMatch(/Searched the whole memory for “zeta”/);
  });

  it('pages a search with q kept, and Clear returns to the normal paged list', async () => {
    replies['page?offset=0'] = [found(range(0, 2)), found(range(0, 2))];
    replies['page?offset=0&q=a'] = [found(range(10, 50), true)];
    replies['page?offset=50&q=a'] = [found(range(60, 2))];
    const m = await mount();
    await type(m, 'a');
    await click(btn(m, /Load more nodes/));
    expect(fetched.slice(-1)).toEqual(['page?offset=50&q=a']);
    await click(m.target.querySelector('[data-testid="nodes-search-clear"]') as HTMLButtonElement);
    expect(fetched.slice(-1)).toEqual(['page?offset=0']);
    expect(box(m).value).toBe('');
    expect(text(m)).toContain('Node 0');
  });

  it('a stale answer to an older search never lands, even while the newer read is still pending', async () => {
    let releaseOld!: (r: Response) => void;
    let releaseNew!: (r: Response) => void;
    replies['page?offset=0'] = [found(range(0, 1))];
    replies['page?offset=0&q=old'] = [new Promise<Response>((r) => { releaseOld = r; }) as never];
    replies['page?offset=0&q=new'] = [new Promise<Response>((r) => { releaseNew = r; }) as never];
    const m = await mount();
    await type(m, 'old');
    await type(m, 'new');
    releaseOld(new Response(JSON.stringify(found([node(8, { name: 'Stale answer' })])), { status: 200 }));
    await wait(10);
    flushSync();
    expect(text(m)).not.toContain('Stale answer');
    releaseNew(new Response(JSON.stringify(found([node(9, { name: 'Fresh answer' })])), { status: 200 }));
    await wait(10);
    flushSync();
    expect(text(m)).toContain('Fresh answer');
    expect(text(m)).not.toContain('Stale answer');
  });

  it('a failed search says it failed, offers Retry, and is never "no nodes match"', async () => {
    replies['page?offset=0'] = [found(range(0, 1))];
    replies['page?offset=0&q=boom'] = ['fail', found([node(5, { name: 'Recovered' })])];
    const m = await mount();
    await type(m, 'boom');
    expect(text(m)).toMatch(/Could not load this page/);
    expect(text(m)).not.toMatch(/No nodes match/);
    await click(btn(m, /Retry/));
    expect(text(m)).toContain('Recovered');
  });

  it('a search with no hit says it searched the whole memory', async () => {
    replies['page?offset=0'] = [found(range(0, 1))];
    replies['page?offset=0&q=nothing'] = [found([])];
    const m = await mount();
    await type(m, 'nothing');
    expect(text(m)).toMatch(/No nodes match “nothing” anywhere in this memory/);
  });

  it('an unmount with a search in flight, or a debounce pending, leaves no rejection and no later read', async () => {
    let release!: (r: Response) => void;
    replies['page?offset=0'] = [found(range(0, 1))];
    replies['page?offset=0&q=gone'] = [new Promise<Response>((r) => { release = r; }) as never];
    const rejections = await captureUnhandledRejections(async () => {
      const m = mountComponent(LazyNodesBrowser as never, { memoryId: MEM } as never) as Mounted<Record<string, unknown>>;
      await wait(5);
      flushSync();
      await type(m, 'gone');
      m.unmount();
      release(new Response(JSON.stringify(found(range(0, 3))), { status: 200 }));
      await wait(10);
    });
    expect(rejections).toEqual([]);
    expect(fetched).toEqual(['page?offset=0', 'page?offset=0&q=gone']);

    fetched.length = 0;
    const m2 = mountComponent(LazyNodesBrowser as never, { memoryId: MEM } as never) as Mounted<Record<string, unknown>>;
    replies['page?offset=0'] = [found(range(0, 1))];
    await wait(5);
    flushSync();
    box(m2).value = 'late';
    box(m2).dispatchEvent(new Event('input', { bubbles: true }));
    m2.unmount();
    await wait(340);
    expect(fetched).not.toContain('page?offset=0&q=late');
  });
});

describe('filters and sort (#2693 step 1)', () => {
  const found = (rows: unknown[], hasMore = false) => ({ rows, hasMore });
  const q = (m: Mounted<Record<string, unknown>>, id: string) => m.target.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const pick = async (el: HTMLSelectElement, value: string) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); await wait(5); flushSync(); };

  it('every control is a server read with the criteria in the URL; nothing is filtered locally', async () => {
    replies['page?offset=0'] = [found(range(0, 2))];
    replies['page?offset=0&type=prompt'] = [found([node(5, { name: 'Only prompt' })])];
    replies['page?offset=0&type=prompt&mine=1'] = [found([node(6, { name: 'Mine prompt' })])];
    replies['page?offset=0&type=prompt&changed=7d&mine=1'] = [found([node(7, { name: 'Recent mine' })])];
    replies['page?offset=0&type=prompt&changed=7d&mine=1&sort=updated'] = [found([node(8, { name: 'Sorted' })])];
    const m = await mount();
    await click(q(m, 'nodes-type-prompt') as HTMLButtonElement);
    expect(q(m, 'nodes-type-prompt').getAttribute('aria-pressed')).toBe('true');
    expect(text(m)).toContain('Only prompt');
    expect(text(m)).not.toContain('Node 0');
    await click(q(m, 'nodes-mine') as HTMLButtonElement);
    await pick(q(m, 'nodes-changed') as HTMLSelectElement, '7d');
    await pick(q(m, 'nodes-sort') as HTMLSelectElement, 'updated');
    expect(fetched.slice(-1)).toEqual(['page?offset=0&type=prompt&changed=7d&mine=1&sort=updated']);
    expect(text(m)).toContain('Sorted');
    expect(text(m)).toMatch(/Filtered the whole memory/);
  });

  it('tags are added with Enter, shown as chips, sent as repeated params, removed from the chip, and capped', async () => {
    replies['page?offset=0'] = [found(range(0, 1))];
    replies['page?offset=0&tag=alpha'] = [found([node(3)])];
    replies['page?offset=0&tag=alpha&tag=beta'] = [found([node(4)])];
    replies['page?offset=0&tag=beta'] = [found([node(5)])];
    const m = await mount();
    const input = q(m, 'nodes-tag-input') as HTMLInputElement;
    expect(input.maxLength).toBe(100);
    for (const tag of ['alpha', 'alpha', 'beta']) {
      input.value = tag;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(5);
      flushSync();
    }
    expect(fetched.filter((f) => f.includes('tag='))).toEqual(['page?offset=0&tag=alpha', 'page?offset=0&tag=alpha&tag=beta']);
    expect([...m.target.querySelectorAll('[data-testid="nodes-tag-chip"]')].map((c) => c.textContent?.replace('×', '').trim())).toEqual(['alpha', 'beta']);
    await click(m.target.querySelector('[aria-label="Remove tag alpha"]') as HTMLButtonElement);
    expect(fetched.slice(-1)).toEqual(['page?offset=0&tag=beta']);
  });

  it('Best match needs a text search: disabled without one, and dropped when the text is cleared', async () => {
    replies['page?offset=0'] = [found(range(0, 1)), found(range(0, 1))];
    replies['page?offset=0&q=zeta'] = [found([node(2)])];
    replies['page?offset=0&q=zeta&sort=relevance'] = [found([node(3)])];
    const m = await mount();
    const sort = q(m, 'nodes-sort') as HTMLSelectElement;
    expect((sort.querySelector('option[value="relevance"]') as HTMLOptionElement).disabled).toBe(true);
    const box = q(m, 'nodes-search') as HTMLInputElement;
    box.value = 'zeta';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(340);
    flushSync();
    expect((sort.querySelector('option[value="relevance"]') as HTMLOptionElement).disabled).toBe(false);
    await pick(sort, 'relevance');
    await click(q(m, 'nodes-search-clear') as HTMLButtonElement);
    expect(fetched.slice(-1)).toEqual(['page?offset=0']);
    expect((q(m, 'nodes-sort') as HTMLSelectElement).value).toBe('');
  });

  it('a filter with no hit says so for the whole memory; a failed filter is a retry, never that', async () => {
    replies['page?offset=0'] = [found(range(0, 1))];
    replies['page?offset=0&type=chat'] = [found([])];
    replies['page?offset=0&type=chat&type=data'] = ['fail', found([node(9, { name: 'Back' })])];
    const m = await mount();
    await click(q(m, 'nodes-type-chat') as HTMLButtonElement);
    expect(text(m)).toMatch(/No nodes in this memory match these filters/);
    await click(q(m, 'nodes-type-data') as HTMLButtonElement);
    expect(text(m)).toMatch(/Could not load this page/);
    expect(text(m)).not.toMatch(/match these filters/);
    await click(btn(m, /Retry/));
    expect(text(m)).toContain('Back');
  });

  it('a stale answer to an older filter never lands while the newer read is pending', async () => {
    let releaseOld!: (r: Response) => void;
    replies['page?offset=0'] = [found(range(0, 1))];
    replies['page?offset=0&type=info'] = [new Promise<Response>((r) => { releaseOld = r; }) as never];
    replies['page?offset=0&type=info&type=data'] = [new Promise<Response>(() => {}) as never];
    const m = await mount();
    await click(q(m, 'nodes-type-info') as HTMLButtonElement);
    await click(q(m, 'nodes-type-data') as HTMLButtonElement);
    releaseOld(new Response(JSON.stringify(found([node(8, { name: 'Stale filter answer' })])), { status: 200 }));
    await wait(10);
    flushSync();
    expect(text(m)).not.toContain('Stale filter answer');
  });
});

describe('status line and tag box (#2696 blind P2, P3s)', () => {
  const found = (rows: unknown[], hasMore = false) => ({ rows, hasMore });
  const q = (m: Mounted<Record<string, unknown>>, id: string) => m.target.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const CAVEAT = /apply to the rows loaded so far/;

  it('while a narrowed read is loading, or has failed, the plain-list caveat is not shown; it says it is searching the whole memory', async () => {
    replies['page?offset=0'] = [found(range(0, 3), true)];
    replies['page?offset=0&type=data'] = [new Promise<Response>(() => {}) as never];
    replies['page?offset=0&type=chat'] = ['fail'];
    const m = await mount();
    expect(q(m, 'table-partial').textContent).toMatch(CAVEAT);
    await click(q(m, 'nodes-type-data') as HTMLButtonElement);
    expect(q(m, 'table-partial').textContent).not.toMatch(CAVEAT);
    expect(q(m, 'table-partial').textContent).toMatch(/Searching the whole memory/);
    await click(q(m, 'nodes-type-data') as HTMLButtonElement);
    await click(q(m, 'nodes-type-chat') as HTMLButtonElement);
    expect(text(m)).toMatch(/Could not load this page/);
    expect(q(m, 'table-partial').textContent).not.toMatch(CAVEAT);
  });

  const addTags = async (m: Mounted<Record<string, unknown>>, tags: string[]) => {
    const input = q(m, 'nodes-tag-input') as HTMLInputElement;
    for (const tag of tags) {
      input.value = tag;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(2);
      flushSync();
    }
  };

  it('a 21st tag is never sent and the box says the limit is reached', async () => {
    replies['page?offset=0'] = [found(range(0, 1))];
    for (let i = 1; i <= 20; i++) replies[`page?offset=0&${Array.from({ length: i }, (_, j) => `tag=t${j}`).join('&')}`] = [found(range(0, 1))];
    const m = await mount();
    await addTags(m, Array.from({ length: 21 }, (_, i) => `t${i}`));
    expect(m.target.querySelectorAll('[data-testid="nodes-tag-chip"]')).toHaveLength(20);
    expect(fetched.some((f) => f.includes('tag=t20'))).toBe(false);
    expect(q(m, 'nodes-tag-limit')).toBeTruthy();
  });

  it('a tag with a control character is refused in the box, so no 400 Retry can be offered', async () => {
    replies['page?offset=0'] = [found(range(0, 1))];
    const m = await mount();
    await addTags(m, ['bad\u0000tag', 'tab\there']);
    expect(m.target.querySelectorAll('[data-testid="nodes-tag-chip"]')).toHaveLength(0);
    expect(fetched).toEqual(['page?offset=0']);
  });

  it('Enter runs the search at once, without waiting out the debounce', async () => {
    replies['page?offset=0'] = [found(range(0, 1))];
    replies['page?offset=0&q=now'] = [found([node(4, { name: 'Immediate' })])];
    const m = await mount();
    const box = q(m, 'nodes-search') as HTMLInputElement;
    box.value = 'now';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(20);
    flushSync();
    expect(fetched.slice(-1)).toEqual(['page?offset=0&q=now']);
    expect(text(m)).toContain('Immediate');
    await wait(340);
    expect(fetched.filter((f) => f === 'page?offset=0&q=now')).toHaveLength(1);
  });

  it('the type buttons offer exactly the types the door allow-lists', async () => {
    replies['page?offset=0'] = [found(range(0, 1))];
    const m = await mount();
    const offered = [...m.target.querySelectorAll('[data-testid^="nodes-type-"]')].map((b) => b.getAttribute('data-testid')!.replace('nodes-type-', ''));
    const { FILTERABLE_NODE_TYPES } = await import('$lib/server/nodes-tab-pages');
    expect(offered).toEqual([...FILTERABLE_NODE_TYPES]);
  });
});

describe('a filter change while page 2 is in flight (#2693 amended gate)', () => {
  it('resets to offset 0 and the old page 2 is never appended to the new list', async () => {
    let releaseOld!: (r: Response) => void;
    replies['page?offset=0'] = [{ rows: range(0, 50), hasMore: true }];
    replies['page?offset=50'] = [new Promise<Response>((r) => { releaseOld = r; }) as never];
    replies['page?offset=0&type=data'] = [{ rows: [node(900, { name: 'Filtered first page' })], hasMore: false }];
    const m = await mount();
    await click(btn(m, /Load more nodes/));
    const type = m.target.querySelector('[data-testid="nodes-type-data"]') as HTMLButtonElement;
    await click(type);
    releaseOld(new Response(JSON.stringify({ rows: range(50, 50), hasMore: true }), { status: 200 }));
    await wait(10);
    flushSync();
    expect(fetched.slice(-1)).toEqual(['page?offset=0&type=data']);
    expect(text(m)).toContain('Filtered first page');
    expect(text(m)).not.toContain('Node 50');
    expect(text(m)).toMatch(/1 loaded/);
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

describe('saved views on the Nodes tab (#2705)', () => {
  const q = (m: Mounted<Record<string, unknown>>, id: string) => m.target.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  async function mountAs(viewerId: string) {
    const m = mountComponent(LazyNodesBrowser as never, { memoryId: MEM, viewerId } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await wait(10);
    flushSync();
    return m;
  }
  const seed = (viewerId: string, view: Record<string, unknown>) => {
    const key = `hadron:views:v1:nodes-tab:${viewerId}:${MEM}`;
    window.localStorage.setItem(key, JSON.stringify([{ id: 'v1', name: 'Mine', isDefault: true, createdAt: 't', updatedAt: 't', view }]));
  };
  const filters = (c: Array<{ id: string; value: unknown }>) => ({ sorting: [], columnFilters: c, globalFilter: '', columnVisibility: {}, columnOrder: [], columnSizing: {}, pagination: { pageIndex: 0, pageSize: 25 } });

  it('no viewer id means no strip and no storage key', async () => {
    replies['page?offset=0'] = [{ rows: range(0, 3), hasMore: false }];
    const m = await mountAs('');
    expect(text(m)).not.toMatch(/New view/i);
    expect(Object.keys(window.localStorage).filter((k) => k.startsWith('hadron:views:v1'))).toEqual([]);
  });

  it('a saved view is applied on mount as the same bounded, offset-paged read as typing it', async () => {
    seed('u1', filters([{ id: 'q', value: 'auth' }, { id: 'types', value: ['info'] }]));
    replies['page?offset=0&q=auth&type=info'] = [{ rows: range(0, 2), hasMore: false }];
    const m = await mountAs('u1');
    // exactly one read, the view's: no plain first read that the view then replaces
    expect(fetched).toEqual(['page?offset=0&q=auth&type=info']);
    expect((q(m, 'nodes-search') as HTMLInputElement).value).toBe('auth');
    expect(text(m)).toContain('Mine');
  });

  it('two users in one browser storage never see or apply each other\'s views', async () => {
    seed('u1', filters([{ id: 'q', value: 'secret-keyword' }]));
    replies['page?offset=0'] = [{ rows: range(0, 2), hasMore: false }];
    const m = await mountAs('u2');
    expect(text(m)).not.toContain('Mine');
    expect(fetched.join(' ')).not.toContain('secret-keyword');
    expect((q(m, 'nodes-search') as HTMLInputElement).value).toBe('');
  });

  it('a view that can no longer be read is a retryable error, never "no results"', async () => {
    seed('u1', filters([{ id: 'q', value: 'gone' }]));
    replies['page?offset=0&q=gone'] = ['fail', { rows: range(0, 1), hasMore: false }];
    const m = await mountAs('u1');
    expect(m.target.querySelector('[role="alert"]')?.textContent).toMatch(/Could not load/);
    expect(text(m)).not.toMatch(/No nodes match/);
    await click(btn(m, /^Retry$/));
    expect(fetched.filter((f) => f === 'page?offset=0&q=gone')).toHaveLength(2);
    expect(text(m)).toContain('Node 0');
  });

  it('a default view that only holds columns still reads the list once', async () => {
    seed('u1', filters([]));
    replies['page?offset=0'] = [{ rows: range(0, 2), hasMore: false }];
    const m = await mountAs('u1');
    expect(fetched).toEqual(['page?offset=0']);
    expect(text(m)).toContain('Node 0');
  });

  it('a malformed stored record (null filter entry, non-array slices) never kills the strip or the list', async () => {
    window.localStorage.setItem(`hadron:views:v1:nodes-tab:u1:${MEM}`, JSON.stringify([
      { id: 'v1', name: 'Odd', isDefault: true, createdAt: 't', updatedAt: 't', view: { ...filters([]), columnFilters: [null, 7, { id: 'q', value: 'x' }], sorting: 'nope' } },
    ]));
    replies['page?offset=0&q=x'] = [{ rows: range(0, 1), hasMore: false }];
    const rejections = await captureUnhandledRejections(async () => { await mountAs('u1'); });
    expect(rejections).toEqual([]);
    expect(fetched).toEqual(['page?offset=0&q=x']);
  });

  it('a new search goes back to page one, not an empty later page', async () => {
    replies['page?offset=0'] = [{ rows: range(0, 60), hasMore: false }];
    replies['page?offset=0&q=zz'] = [{ rows: range(100, 60), hasMore: false }];
    const m = await mountAs('u1');
    await click(btn(m, /^Next$/));
    expect(text(m)).toContain('Node 25');
    const box = q(m, 'nodes-search') as HTMLInputElement;
    box.value = 'zz'; box.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(340); flushSync();
    expect(text(m)).toContain('Node 100');
    expect(btn(m, /^Previous$/)?.disabled).toBe(true);
  });

  it('the strip stays when a view finds nothing', async () => {
    seed('u1', filters([{ id: 'q', value: 'zzz' }]));
    replies['page?offset=0&q=zzz'] = [{ rows: [], hasMore: false }];
    const m = await mountAs('u1');
    expect(text(m)).toContain('Mine');
    expect(text(m)).toMatch(/No nodes match/);
  });

  it('ViewTabs\' async init resolving after unmount starts no read; a mounted one does (both directions)', async () => {
    seed('u1', filters([{ id: 'q', value: 'late' }]));
    replies['page?offset=0&q=late'] = [{ rows: range(0, 1), hasMore: false }, { rows: range(0, 1), hasMore: false }];
    replies['page?offset=0'] = [{ rows: range(0, 1), hasMore: false }];
    const rejections = await captureUnhandledRejections(async () => {
      const m = mountComponent(LazyNodesBrowser as never, { memoryId: MEM, viewerId: 'u1' } as never) as Mounted<Record<string, unknown>>;
      m.unmount(); // before the strip's awaited storage read resumes
      await wait(30);
    });
    expect(rejections).toEqual([]);
    expect(fetched.filter((f) => f.includes('q=late'))).toEqual([]);
    // the mounted direction: the same record applies when the component is alive
    await mountAs('u1');
    expect(fetched.filter((f) => f.includes('q=late'))).toHaveLength(1);
  });
});
