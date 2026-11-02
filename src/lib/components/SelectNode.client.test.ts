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
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
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

// The search input is named by its wrapping label ("Search nodes"), not an
// aria-label of its own (label-in-name is then exact, with no trailing ellipsis).
function searchInput(root: HTMLElement) {
  const label = [...root.querySelectorAll('label')].find((l) => l.textContent?.includes('Search nodes'))!;
  return label.querySelector('input') as HTMLInputElement;
}

async function search(root: HTMLElement, query: string) {
  const input = searchInput(root);
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
// read a real Response body stream, hence the plain object. `nextOffset` is
// the SERVER-computed next read offset (raw-count based): the client pages by
// it and never by the filtered items it received.
const okPage = (items: NodeChoice[], hasMore: boolean, nextOffset?: number) => async () =>
  ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore, ...(nextOffset === undefined ? {} : { nextOffset }) } }) });

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

// A real Escape originates at the focused control and bubbles; dispatching
// straight on `window` skips every dialog-level handler. The dialog consumes
// the key when focus is inside it; a focus stranded OUTSIDE (on <body>) is
// recaptured by the restoration effect, with the window-capture fallback
// behind it (see the body-focus pin below).
function pressEscape() {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

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
    // the picker itself closes. Escape is dispatched from the focused
    // control (a real keypress), not from window: the dialog handles it at
    // its own layer and it must not travel past the dialog.
    const box = mockLayout();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    try {
      const { target } = mount();
      await tick(2);
      expect(target.querySelectorAll('[role="dialog"]').length).toBe(2);
      pressEscape();
      flushSync();
      expect(target.querySelectorAll('[role="dialog"]').length).toBe(1);
      pressEscape();
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
    serve({ [url('m2', 'findings', 0)]: [okPage([node(1, { name: 'Findings index', loc: 'findings:index', urn: serverUrn })], false, 1)] });
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
    serve({ [url('m2', 'x', 0)]: [new Error('transport'), okPage([node(1)], false, 1)] });
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
      [url('m2', 'node', 0)]: [okPage(Array.from({ length: 20 }, (_, i) => node(i)), true, 20)],
      [url('m2', 'node', 20)]: [okPage([node(20), node(21), node(22)], false, 23)],
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

  it('a capped page renders the note, not Load more, and never requests past the ceiling (#1585)', async () => {
    // The endpoint owns the ceiling (#1585, PM decision): when the next page
    // would start past MAX_OFFSET the read answers hasMore:false + capped:true
    // instead of advertising an offset it must then 400 — the dead end where
    // Load more failed and Try again resent the same refused offset forever
    // (#1582 carried P3 1). okPage is unchanged (existing pins untouched);
    // this fixture is the read's new shape.
    serve({
      [url('m2', 'node', 0)]: [async () => ({
        ok: true,
        json: async () => ({ kind: 'ok', value: { items: Array.from({ length: 20 }, (_, i) => node(i)), hasMore: false, capped: true, nextOffset: 100_010 } }),
      })],
    });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'node');
    expect(target.textContent).toContain('Node 1'); // the page itself landed
    expect(button(target, 'Load more nodes')).toBeFalsy(); // nothing to press into the 400
    expect(target.textContent).toContain('Showing the first results only. Search to narrow the list.');
    // No request above the ceiling was ever sent: every URL the picker built
    // stays at or below offset 100_000.
    for (const call of fetchMock.mock.calls) {
      const offset = Number(/[?&]offset=(\d+)/.exec(String(call[0]))?.[1] ?? 0);
      expect(offset).toBeLessThanOrEqual(100_000);
    }
  });

  it('paging INTO the cap keeps the rows already loaded and stops there (#1585, #1588 BLIND P3)', async () => {
    // The capped fixture above arrives on the FIRST request; the real user
    // path pages normally first — an ordinary full page, then Load more
    // lands on a capped read. The already-loaded rows must survive the
    // transition and paging must stop there.
    serve({
      [url('m2', 'node', 0)]: [okPage(Array.from({ length: 20 }, (_, i) => node(i)), true, 20)],
      [url('m2', 'node', 20)]: [async () => ({
        ok: true,
        json: async () => ({ kind: 'ok', value: { items: Array.from({ length: 20 }, (_, i) => node(20 + i)), hasMore: false, capped: true, nextOffset: 100_010 } }),
      })],
    });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'node');
    expect(button(target, 'Load more nodes')).toBeTruthy();
    button(target, 'Load more nodes')!.click();
    await tick(5);
    expect(fetchMock).toHaveBeenLastCalledWith(url('m2', 'node', 20));
    expect(target.textContent).toContain('Node 5'); // first page's rows survive the transition
    // 40 rows landed (20 + 20): DataTable's own footer counts them.
    expect(target.textContent).toContain('Page 1 of 4');
    expect(button(target, 'Load more nodes')).toBeFalsy(); // nothing left to press
    expect(target.textContent).toContain('Showing the first results only. Search to narrow the list.');
    // And no URL above the ceiling was ever built.
    for (const call of fetchMock.mock.calls) {
      const offset = Number(/[?&]offset=(\d+)/.exec(String(call[0]))?.[1] ?? 0);
      expect(offset).toBeLessThanOrEqual(100_000);
    }
  });

  it('closing the picker dismisses it; reopening the SAME instance starts over at the memory stage', async () => {
    // The reset is the close $effect's job. A remount proves nothing (a fresh
    // mount is trivially reset — the review's P2: the old test passed with
    // the effect deleted), so the SAME instance is closed and reopened via
    // reactive props, like a route reusing the component.
    serve({ [url('m2', 'one', 0)]: [okPage([node(1)], false, 1)] });
    const props = reactiveProps({ memories, open: true, onselect });
    const m = mountComponent(SelectNode, props);
    mounted.push(m as Mounted<Record<string, unknown>>);
    await tick();
    await chooseMemory(m.target, 'Beta KB');
    await search(m.target, 'one');
    expect(m.target.textContent).toContain('Node 1');
    props.open = false;
    await tick(2);
    expect(m.target.textContent).not.toContain('Choose a node');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    props.open = true;
    await tick(5);
    expect(m.target.textContent).toContain('Pick which memory to search in first.');
    // The close reset dropped the chosen memory: nothing to read until one is
    // chosen again, so no second fetch happened.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an empty query is a legal first page: the browse list, not an error', async () => {
    serve({ [url('m2', '', 0)]: [okPage([node(1)], false, 1)] });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, '');
    expect(fetchMock).toHaveBeenLastCalledWith(url('m2', '', 0));
    expect(target.textContent).toContain('Node 1');
  });
});

describe('SelectNode: review fixes (BLIND Gemma, LOCAL Gizelle, QA Charles at d9d2c8c5)', () => {
  it('changing the memory mid-read cannot strand the picker (pending must not stick)', async () => {
    // LOCAL P2 / BLIND P2-1: a read for memory A is in flight when the user
    // changes to memory B. The generation bump discards A's LATE response,
    // but the old `finally` skipped `pending = false` (generation moved), so
    // pending stuck true and Find/Load more were dead until close-reopen.
    let releaseA: (v: { ok: boolean; json: () => Promise<unknown> }) => void = () => {};
    const readA = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => { releaseA = resolve; });
    serve({
      [url('m1', 'x', 0)]: [() => readA],
      [url('m2', 'y', 0)]: [okPage([node(9)], false, 9)],
    });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Alpha KB');
    await search(target, 'x');
    // While A's read is held, change the memory.
    button(target, 'Change…')!.click();
    await tick(2);
    await chooseMemory(target, 'Beta KB');
    // A's response lands AFTER the change: discarded, and the picker must
    // still be usable — the search in B runs.
    releaseA({ ok: true, json: async () => ({ kind: 'ok', value: { items: [node(1)], hasMore: false } }) });
    await tick(5);
    await search(target, 'y');
    expect(fetchMock).toHaveBeenLastCalledWith(url('m2', 'y', 0));
    expect(target.textContent).toContain('Node 9');
  });

  it('Load more pages the SEARCHED query, not the live input text', async () => {
    // LOCAL P2 / BLIND P2-2: editing the input without pressing Find must not
    // re-target the next page; the query that produced the list owns paging.
    serve({
      [url('m2', 'foo', 0)]: [okPage(Array.from({ length: 20 }, (_, i) => node(i)), true, 20)],
      [url('m2', 'foo', 20)]: [okPage([node(20)], false, 21)],
    });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'foo');
    const input = searchInput(target);
    input.value = 'bar';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    button(target, 'Load more nodes')!.click();
    await tick(5);
    expect(fetchMock).toHaveBeenLastCalledWith(url('m2', 'foo', 20));
  });

  it('paging follows the server\'s nextOffset when the server filtered unusable rows', async () => {
    // BLIND P2-3: the server drops malformed rows but pages by the RAW count;
    // the client must advance by the server\'s nextOffset (20), never by the
    // 19 filtered items it received (19 would re-read a shifted window).
    serve({
      [url('m2', 'q', 0)]: [okPage(Array.from({ length: 19 }, (_, i) => node(i)), true, 20)],
      [url('m2', 'q', 20)]: [okPage([node(20), node(21)], false, 22)],
    });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'q');
    // 19 rows are in the table; its footer pages at 10, so the last of them
    // (Node 18) sits on the table's second page — navigate there to see it.
    button(target, 'Next')!.click();
    await tick();
    expect(target.textContent).toContain('Node 18');
    button(target, 'Load more nodes')!.click();
    await tick(5);
    expect(fetchMock).toHaveBeenLastCalledWith(url('m2', 'q', 20));
    // The paged window landed while the table kept our place on its second
    // page: the new row is right there and the footer now counts 3 pages
    // (21 loaded rows — the count the auto-reset-freeze finding protects).
    expect(target.textContent).toContain('Node 20');
    expect(target.textContent).toContain('Page 2 of 3');
  });

  it('a page that is all duplicates keeps Load more: the server said there is more', async () => {
    // BLIND P2-3 (second half): a shifted list can return a full page of rows
    // the client already has. The raw-count nextOffset still advances, so
    // paging must continue — `fresh.length` must not veto the server\'s hasMore.
    const page = Array.from({ length: 20 }, (_, i) => node(i));
    serve({
      [url('m2', 'q', 0)]: [okPage(page, true, 20)],
      [url('m2', 'q', 20)]: [okPage(page, true, 40)], // every row already loaded
      [url('m2', 'q', 40)]: [okPage([node(40)], false, 41)],
    });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'q');
    button(target, 'Load more nodes')!.click();
    await tick(5);
    expect(button(target, 'Load more nodes')).toBeTruthy();
    button(target, 'Load more nodes')!.click();
    await tick(5);
    expect(fetchMock).toHaveBeenLastCalledWith(url('m2', 'q', 40));
    // 21 rows are in the table (the duplicate page added none): Node 40 is
    // its last row, on the table's third page.
    button(target, 'Next')!.click();
    await tick();
    button(target, 'Next')!.click();
    await tick();
    expect(target.textContent).toContain('Node 40');
  });

  it('retry after a failed Load more keeps the pages already loaded', async () => {
    // BLIND P3: "Try again" re-reads the FAILED page; it must not throw away
    // the rows already on screen by restarting the whole search.
    serve({
      [url('m2', 'q', 0)]: [okPage(Array.from({ length: 20 }, (_, i) => node(i)), true, 20)],
      [url('m2', 'q', 20)]: [new Error('transport'), okPage([node(20)], false, 21)],
    });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    await search(target, 'q');
    expect(target.textContent).toContain('Node 0');
    button(target, 'Load more nodes')!.click();
    await tick(5);
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load nodes');
    expect(target.textContent).toContain('Node 0');
    button(target, 'Try again')!.click();
    await tick(5);
    expect(target.querySelector('[role="alert"]')).toBeNull();
    // Both the first page and the retried page are present: the footer's
    // page count reads all 21 loaded rows (2 pages before the retry).
    expect(target.textContent).toContain('Page 1 of 3');
    // …and the retried page's row is real: Node 20 is the table's 21st row,
    // on its third page.
    button(target, 'Next')!.click();
    await tick();
    button(target, 'Next')!.click();
    await tick();
    expect(target.textContent).toContain('Node 20');
  });

  it('Enter in the node search never leaves the dialog (no implicit form submit)', async () => {
    // BLIND P2-6, hardened: the editor\'s fieldset cancels Enter today, but a
    // picker mounted anywhere else must be safe on its own.
    serve({ [url('m2', 'x', 0)]: [okPage([node(1)], false, 1)] });
    const { target } = mount();
    await tick();
    await chooseMemory(target, 'Beta KB');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    searchInput(target).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Escape stays inside the picker stack: a window-level listener above it never fires', async () => {
    // QA Charles P2 / BLIND P2-7: TaskActionBar also listens for Escape on
    // window (registered first, so it cannot be stopped from below); each
    // dialog layer consumes the key itself, so one keypress closes ONE layer
    // and nothing above the stack ever sees it. Two presses walk the two
    // layers — the auto-opened memory stage first, then the node dialog.
    // (Amended from the red pin, which expected every overlay gone after ONE
    // press: the memory stage is open at mount, so one press must leave the
    // node dialog standing — closing both on one keypress is the defect.)
    const above = vi.fn();
    window.addEventListener('keydown', above);
    try {
      const { target } = mount();
      await tick(2);
      expect(target.querySelectorAll('[role="dialog"]').length).toBe(2);
      pressEscape();
      flushSync();
      expect(target.querySelectorAll('[role="dialog"]').length).toBe(1);
      expect(above).not.toHaveBeenCalled();
      pressEscape();
      flushSync();
      expect(above).not.toHaveBeenCalled();
      expect(target.querySelector('.fixed.inset-0')).toBeNull();
    } finally {
      window.removeEventListener('keydown', above);
    }
  });

  it('Escape with focus dropped to <body> still closes the picker, never the host panel', async () => {
    // BLIND delta P2 at c4a6cba34 (Gemma): the dialog-level Escape handler
    // only sees keydowns whose target is INSIDE the dialog. Clicking Try
    // again unmounts the focused button the moment the retry succeeds, and
    // element REMOVAL moves focus to <body> without firing focusin — the
    // trap's guard never recaptures. The next Escape then skipped the picker
    // entirely and reached the host's earlier-registered window listener
    // (TaskActionBar's edit panel). Two contracts, both pinned here:
    //   (1) the picker never strands focus on <body> after unmounting the
    //       control the user just clicked — it pulls focus back inside;
    //   (2) even if an Escape arrives whose target never entered the dialog,
    //       the picker consumes it: ONE layer closes, the host never fires.
    serve({ [url('m2', 'kb', 0)]: [new Error('transport'), okPage([node(1)], false, 1)] });
    const above = vi.fn();
    window.addEventListener('keydown', above);
    try {
      const { target } = mount();
      await tick(2);
      await chooseMemory(target, 'Beta KB');
      await search(target, 'kb');
      expect(target.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load nodes');
      const retry = button(target, 'Try again')!;
      retry.focus();
      expect(document.activeElement).toBe(retry);
      retry.click();
      await tick(5);
      expect(target.querySelector('[role="alert"]')).toBeNull();
      // (1) focus did not die with the button: it came back into the dialog.
      expect(document.activeElement).not.toBe(document.body);
      expect(target.contains(document.activeElement)).toBe(true);
      // (2) an Escape that never entered the dialog is still the picker's to
      // take — dispatched on <body>, exactly where a stranded focus sends it.
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await tick(2);
      expect(above).not.toHaveBeenCalled();
      expect(target.querySelector('.fixed.inset-0')).toBeNull();
    } finally {
      window.removeEventListener('keydown', above);
    }
  });

  it('while the memory picker is open, the node dialog\'s focus trap stands down', async () => {
    // QA Charles P2 (the RangeError): two document-level focusin guards used
    // to fight — each yanked focus out of the other\'s dialog. While the
    // nested memory dialog is on top, the node dialog\'s trap must not pull.
    const box = mockLayout();
    try {
      const { target } = mount();
      await tick(2);
      // The memory stage opens with the picker; focus inside its search box
      // is legal and must survive a focusin event.
      const memoryDialog = [...target.querySelectorAll('[role="dialog"]')].find(
        (d) => d.getAttribute('aria-label') === 'Choose a memory',
      )!;
      const input = memoryDialog.querySelector('input')!;
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      flushSync();
      expect(document.activeElement === input || document.activeElement === document.body).toBe(true);
    } finally {
      box.mockRestore();
    }
  });
});

// portal#1584 — the guards the shared window fallback must carry (Gemma's P3
// (b) on #1582, folded once in the helper), plus the two carried SelectNode
// P3s (a) and (c). All four pins are red on 2fbaacc7.
describe('SelectNode: #1584 fallback guards and carried P3s', () => {
  it('an Escape someone else already consumed (defaultPrevented) closes nothing', async () => {
    // The fallback runs at window CAPTURE, so "someone else" is an
    // earlier-registered capture listener — e.g. another dialog layer that
    // already took the key. A fallback without the defaultPrevented guard
    // closes the picker anyway, on a keypress that was never its to take.
    const consumer = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', consumer, true); // BEFORE the picker mounts
    try {
      const { target } = mount();
      await tick(2);
      await chooseMemory(target, 'Beta KB');
      expect(target.querySelector('.fixed.inset-0')).not.toBeNull();
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await tick(2);
      // The key was consumed before it reached us: the picker must still stand.
      expect(target.querySelector('.fixed.inset-0')).not.toBeNull();
    } finally {
      window.removeEventListener('keydown', consumer, true);
    }
  });

  it('an Escape during IME composition (isComposing) closes nothing', async () => {
    // Escape while composing cancels the COMPOSITION, not the dialog — at the
    // dialog layer too, since composition happens in the search box inside it.
    const { target } = mount();
    await tick(2);
    await chooseMemory(target, 'Beta KB');
    expect(target.querySelector('.fixed.inset-0')).not.toBeNull();
    searchInput(target).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }),
    );
    await tick(2);
    expect(target.querySelector('.fixed.inset-0')).not.toBeNull();
  });

  it('the last page keeps the viewport still: restoration focus passes preventScroll (carried (a))', async () => {
    // Gemma's P3 (a) at a1ae339f8: Load more vanishing on the last page
    // unmounts the focused button, and the restoration effect focuses the
    // search box WITHOUT preventScroll — a real browser scrolls the list back
    // to the box. jsdom lays out nothing, so the scroll itself is the browser
    // QA leg; what this lane can pin is the mechanism: every focus() the
    // restoration performs passes { preventScroll: true }.
    serve({
      [url('m2', '', 0)]: [okPage([node(0), node(1)], true, 2)],
      [url('m2', '', 2)]: [okPage([node(2)], false, 3)],
    });
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      const { target } = mount();
      await tick(2);
      await chooseMemory(target, 'Beta KB');
      await search(target, '');
      const more = button(target, 'Load more nodes')!;
      expect(more).toBeTruthy();
      more.focus(); // the user's last act: the button that is about to vanish
      const before = focusSpy.mock.calls.length;
      more.click();
      await tick(5);
      // The last page landed and Load more is gone — the focused control was
      // removed, so the restoration effect must have run.
      expect(button(target, 'Load more nodes')).toBeUndefined();
      expect(document.activeElement).not.toBe(document.body);
      const calls = focusSpy.mock.calls.slice(before);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[0]?.preventScroll).toBe(true);
      }
    } finally {
      focusSpy.mockRestore();
    }
  });

  it('the search field carries the name-or-loc hint as visible text, described-by, never overriding the label (carried (c))', async () => {
    // Gemma's P3 (c) at a1ae339f8: the hint that the search matches by name
    // or loc was lost when the accessible name was tightened to the visible
    // label. It comes back as visible hint text tied with aria-describedby —
    // and per hrn:node:hadronmemory.com:hadron-portal:review:visible-label-is-the-accessible-name it must NOT enter
    // the label (that would change the accessible name again) and the input
    // must keep no aria-label of its own.
    const { target } = mount();
    await tick(2);
    await chooseMemory(target, 'Beta KB');
    const input = searchInput(target);
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const hint = document.getElementById(describedBy!);
    expect(hint).toBeTruthy();
    expect(hint!.textContent?.toLowerCase()).toContain('name or loc');
    const label = [...target.querySelectorAll('label')].find((l) => l.textContent?.includes('Search nodes'))!;
    expect(label.contains(hint!)).toBe(false); // the label stays the whole accessible name
    expect(input.hasAttribute('aria-label')).toBe(false);
  });

  it('a per-instance hint id: two pickers never share one description target (#1587 BLIND P3)', async () => {
    // Gizelle's P3: the hint id used to be the literal `node-picker-search-hint`,
    // so with two node pickers open (exactly the stacking this PR builds for)
    // both search inputs described themselves by the FIRST instance's hint —
    // a duplicate id in the document, and aria-describedby resolving across
    // instances. Two instances cannot be mounted SIMULTANEOUSLY in jsdom
    // (their focus traps pull focus at each other, #1582 QA P2), so pin the
    // per-instance generation sequentially: a shared literal — or any
    // module-level constant — yields the SAME id both times.
    const a = mount();
    await tick(2);
    await chooseMemory(a.target, 'Beta KB');
    const ida = searchInput(a.target).getAttribute('aria-describedby');
    expect(ida).toBeTruthy();
    expect(a.target.contains(document.getElementById(ida!))).toBe(true); // resolves inside its own picker
    a.unmount();
    mounted.splice(mounted.indexOf(a), 1);
    const b = mount();
    await tick(2);
    await chooseMemory(b.target, 'Beta KB');
    const idb = searchInput(b.target).getAttribute('aria-describedby');
    expect(idb).toBeTruthy();
    expect(idb).not.toBe(ida); // per-instance: never the shared literal
    expect(b.target.contains(document.getElementById(idb!))).toBe(true);
  });

  it('the per-instance hint id is $props.id()-based: independent of Math.random and unique across client mounts (#1591 item 1; #1600 item 5)', async () => {
    // Gemma's P3 on #1587: `Math.random()` per instance is not deterministic
    // across server render and hydration. `$props.id()` is. With Math.random
    // pinned to one value, a random suffix gives both instances the SAME id;
    // an id from $props.id() stays distinct and owns its own picker.
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const m = mount();
      await tick(2);
      await chooseMemory(m.target, 'Beta KB');
      const id = searchInput(m.target).getAttribute('aria-describedby')!;
      expect(id).toMatch(/^node-picker-search-hint-/);
      expect(m.target.contains(document.getElementById(id))).toBe(true);
      ids.push(id);
      m.unmount();
      mounted.splice(mounted.indexOf(m), 1);
    }
    expect(ids[1]).not.toBe(ids[0]);
    vi.restoreAllMocks();
  });
});
