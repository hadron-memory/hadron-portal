/**
 * portal#1576 — the node picker, mounted. CLIENT lane: the pick flow runs
 * end to end against a URL-routed endpoint stub — choose a memory from the
 * caller's readable set, search server-side, pick a row, and receive the
 * node's SERVER-supplied URN verbatim (never one built on the client from
 * memory + loc). A failed read is a retry state, not "no nodes"; paging stops
 * on a short page. Plus the Select-family dialog semantics (#1279/#1305):
 * a labelled modal dialog whose Escape restores the opener.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import SelectNode from './SelectNode.svelte';
import type { NodeChoice } from '$lib/node-choices';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
const fetchMock = vi.fn();
const onselect = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  onselect.mockClear();
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

const memories = [
  { id: 'm1', name: 'Alpha KB', urn: 'hrn:mem:example.com:alpha' },
  { id: 'm2', name: 'Beta KB', urn: 'hrn:mem:example.com:beta' },
];

function mount() {
  const m = mountComponent(SelectNode, { memories, open: true, onselect });
  mounted.push(m);
  return m;
}

function button(root: HTMLElement, text: string) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
}

async function chooseMemory(root: HTMLElement, name: string) {
  // The URN cell's copy button is the row's FIRST button; select by label.
  const row = [...root.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(name));
  ([...row!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Select'))!.click();
  await tick(5);
}

async function search(root: HTMLElement, query: string) {
  const input = root.querySelector('input[aria-label="Search nodes by name or loc…"]') as HTMLInputElement;
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  button(root, 'Find')!.click();
  await tick(5);
}

const node = (i: number, over: Partial<NodeChoice> = {}): NodeChoice => ({ id: `n${i}`, name: `Node ${i}`, loc: `loc:${i}`, urn: `hrn:node:example.com:beta:loc:${i}`, ...over });
const url = (memoryId: string, query: string, offset: number) => `/app/memories/${memoryId}/nodes/choices?query=${query}&offset=${offset}`;
// A fresh response per call (never one shared object across requests), with
// just the surface the component reads: `ok` + `json()`. The jsdom lane can't
// read a real Response body stream, hence the plain object.
const okPage = (items: NodeChoice[], hasMore: boolean) => async () => ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore } }) });

/**
 * Fixtures route by URL and fail unexpected requests deliberately
 * (hrn:node:hadronmemory.com:hadron-portal:review:route-fetch-fixtures-by-endpoint): a catch-all sequencing mock can
 * answer one endpoint's request with another's body once main adds a sibling
 * read under this modal. Each URL maps to a queue, consumed in order.
 */
function serve(routes: Record<string, Array<(() => Promise<{ ok: boolean; json: () => Promise<unknown> }>) | Error>>) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const queue = routes[String(input)];
    if (!queue || queue.length === 0) return Promise.reject(new Error(`unexpected fetch: ${String(input)}`));
    const next = queue.shift()!;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next());
  });
}

// jsdom lays out nothing: give elements a box so the focus trap's
// rendered-ness filter keeps the controls focusable (SelectMemory's test
// mocks the same getter).
const mockLayout = () =>
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);

describe('SelectNode: dialog semantics (#1279/#1305)', () => {
  it('the opened panel is a labelled, modal, focusable dialog', async () => {
    const { target } = mount();
    await tick(2);
    const d = target.querySelector('[role="dialog"]');
    expect(d).not.toBeNull();
    expect(d!.getAttribute('aria-modal')).toBe('true');
    expect((d!.getAttribute('aria-label') ?? '').trim().length).toBeGreaterThan(0);
    expect(d!.getAttribute('tabindex')).toBe('-1');
  });

  it('focus returns to the opener when the dialog closes on Escape', async () => {
    // portal#1305 review P2: a self-focusing child inside the trap captures
    // focus before the trap records the opener, and restore is lost. The
    // full arc — opener focused → open → focus in → Escape → opener restored
    // — is the only probe that catches it. Opening SelectNode shows the
    // memory stage first, so Escape dismisses the NESTED picker once before
    // the picker itself closes.
    const box = mockLayout();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    try {
      const { target } = mount();
      await tick(2);
      expect(target.querySelectorAll('[role="dialog"]').length).toBe(2);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushSync();
      expect(target.querySelectorAll('[role="dialog"]').length).toBe(1);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushSync();
      expect(target.querySelector('.fixed.inset-0')).toBeNull();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
      box.mockRestore();
    }
  });

  it('Escape while the nested memory picker is open closes only the nested one', async () => {
    const box = mockLayout();
    try {
      const { target } = mount();
      await tick(2);
      button(target, 'Choose a memory…')!.click();
      await tick(2);
      // Both dialogs exist; the Escape belongs to the innermost.
      expect(target.querySelectorAll('[role="dialog"]').length).toBe(2);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushSync();
      expect(target.querySelectorAll('[role="dialog"]').length).toBe(1);
      expect(target.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Choose a node');
    } finally {
      box.mockRestore();
    }
  });
});

describe('SelectNode: pick flow (#1576)', () => {
  it('offers exactly the caller-supplied memories and fetches nothing until one is chosen', async () => {
    serve({});
    const { target } = mount();
    await tick();
    expect(target.textContent).toContain('Alpha KB');
    expect(target.textContent).toContain('Beta KB');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('choose a memory, search, pick: the node\'s server URN arrives verbatim, never client-built', async () => {
    // The server urn deliberately differs from any memory-urn + loc concatenation.
    const serverUrn = 'hrn:node:example.com:beta:special-alias';
    serve({ [url('m2', 'findings', 0)]: [okPage([node(1, { name: 'Findings index', loc: 'findings:index', urn: serverUrn })], false)] });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'findings');
    expect(fetchMock).toHaveBeenCalledWith(url('m2', 'findings', 0));
    expect(target.textContent).toContain('Findings index');
    button(target, 'Select')!.click();
    await tick();
    expect(onselect).toHaveBeenCalledTimes(1);
    expect(onselect.mock.calls[0][0]).toEqual({ id: 'n1', name: 'Findings index', loc: 'findings:index', urn: serverUrn });
  });

  it('a failed read is a retry state, not "no nodes", and the retry re-reads', async () => {
    // One queue, two entries: the first read rejects, the retry succeeds.
    serve({ [url('m2', 'x', 0)]: [new Error('transport'), okPage([node(1)], false)] });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'x');
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load nodes');
    expect(target.textContent).not.toContain('No nodes found.');
    button(target, 'Try again')!.click();
    await tick(5);
    expect(target.querySelector('[role="alert"]')).toBeNull();
    expect(target.textContent).toContain('Node 1');
  });

  it('pages with Load more and stops on a short page', async () => {
    serve({
      [url('m2', 'node', 0)]: [okPage(Array.from({ length: 20 }, (_, i) => node(i)), true)],
      [url('m2', 'node', 20)]: [okPage([node(20), node(21), node(22)], false)],
    });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'node');
    expect(button(target, 'Load more nodes')).toBeTruthy();
    button(target, 'Load more nodes')!.click();
    await tick(5);
    expect(fetchMock).toHaveBeenLastCalledWith(url('m2', 'node', 20));
    expect(button(target, 'Load more nodes')).toBeFalsy();
    // 20 + 3 rows landed: DataTable's own footer counts them (10 per page).
    expect(target.textContent).toContain('Page 1 of 3');
  });

  it('closing the picker dismisses it; a fresh open starts at the memory stage', async () => {
    serve({ [url('m2', 'one', 0)]: [okPage([node(1)], false)] });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'one');
    button(target, 'Close')!.click();
    await tick();
    expect(target.textContent).not.toContain('Choose a node');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    // A fresh mount starts at the memory stage and fetches nothing until a
    // memory is chosen — the close effect resets in-between state.
    mounted.pop()!.unmount();
    const second = mount();
    await tick(5);
    expect(second.target.textContent).toContain('Pick which memory to search in first.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
