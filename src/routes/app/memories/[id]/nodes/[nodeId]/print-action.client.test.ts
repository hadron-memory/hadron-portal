/**
 * #1073 — "Print" in the node page's ⋯ menu opens the node's PDF render in a
 * new tab (the browser's PDF viewer owns printing; the portal never
 * re-implements layout). Pins the export request shape, the blob handoff to
 * window.open, the bounded object-URL lifetime, and the failure alert.
 *
 * Mounts the REAL page with data from the REAL loader (the #995 harness).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { captureUnhandledRejections, mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
// Static imports: the page is large, and importing it inside a test spent the
// test's whole timeout under full-suite load. `vi.mock` below is hoisted above
// these, so the loader still sees the mocked client.
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
};
const PARENT = {
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountPage() {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  flushSync();
  return { ...m, props };
}

function clickMenuItem(target: HTMLElement, label: string) {
  // Prefix match: the label carries the node name, which changes mid-test
  // in the navigation cases below.
  target.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]')!.click();
  flushSync();
  const item = [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((b) => b.textContent?.trim() === label);
  expect(item, `menu item "${label}"`).toBeDefined();
  item!.click();
  flushSync();
}

/** The print path is a fetch chain — settle it past the microtask queue. */
async function settle() {
  await new Promise((r) => setTimeout(r, 10));
}

/** jsdom has no URL.createObjectURL — stub the pair the print path uses. */
function stubObjectUrls() {
  let n = 0;
  const create = vi.fn(() => `blob:print-${++n}`);
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  return { create, revoke };
}

function stubExportFetch(data = 'JVBERi0xLjQ', ok = true, mimeType = 'application/pdf') {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({
      filename: 'foo.pdf', mimeType, data, encoding: 'BASE64',
    }), { status: ok ? 200 : 500 }));
}

/**
 * A fetch that never resolves on its own — only an abort rejects it. The
 * pending-work probes need an export that is STILL hanging when cleanup
 * must already have happened; a fetch the test resolves (like the
 * late-response tests above) lets the stale continuation do the closing,
 * which is exactly what those tests cannot establish.
 */
function hangingFetch() {
  const signals: AbortSignal[] = [];
  const fn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      signals.push(init?.signal ?? new AbortController().signal);
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
  return { fn, signals };
}

/**
 * window.open fakes, one per call — each printNode opens its OWN window
 * synchronously (see below). `location.href` records the navigation,
 * `close` records the window being given up.
 */
function stubWindowOpen() {
  const wins: Array<{ location: { href: string }; close: ReturnType<typeof vi.fn> }> = [];
  const open = vi.spyOn(window, 'open').mockImplementation(() => {
    const w = { location: { href: '' }, close: vi.fn() };
    wins.push(w);
    return w as unknown as Window;
  });
  return { open, wins };
}

describe('node menu Print (#1073)', () => {
  it('keeps Print usable for a reader while hiding mutation actions', async () => {
    const { target, props } = await mountPage();
    props.data = { ...props.data as Record<string, unknown>, canWriteMemory: false };
    flushSync();
    stubObjectUrls();
    const { open } = stubWindowOpen();
    const fetchMock = stubExportFetch();
    vi.stubGlobal('fetch', fetchMock);
    target.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]')!.click();
    flushSync();
    const items = [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const print = items.find((item) => item.textContent?.trim() === 'Print');
    expect(print).toBeDefined();
    expect(items.some((item) => ['Delete', 'Add child', 'Move', 'Duplicate'].includes(item.textContent?.trim() ?? ''))).toBe(false);
    print!.click();
    flushSync();
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ id: 'leaf-pk', format: 'PDF', full: true });
  });

  it('opens the node\'s PDF render in a new tab, revoking only the previous URL', async () => {
    const { target } = await mountPage();
    const { create, revoke } = stubObjectUrls();
    const { open, wins } = stubWindowOpen();
    const fetchMock = stubExportFetch();
    vi.stubGlobal('fetch', fetchMock);

    clickMenuItem(target, 'Print');
    await settle();

    // The window opens synchronously, inside the click's user gesture —
    // after the export await, Safari/Firefox treat window.open as a popup.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('', '_blank');
    // The server-rendered PDF (#421 export path), asked for by PK.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(input).toBe('/api/nodes/export');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ id: 'leaf-pk', format: 'PDF', full: true });
    // Its location is assigned only once the PDF arrives.
    expect(wins[0].location.href).toBe('blob:print-1');

    // A second print holds at most one object URL.
    clickMenuItem(target, 'Print');
    await settle();
    expect(wins[1].location.href).toBe('blob:print-2');
    expect(revoke).toHaveBeenCalledWith('blob:print-1');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('closes the blank window and says so when the export fails', async () => {
    const { target } = await mountPage();
    const { create } = stubObjectUrls();
    const { wins } = stubWindowOpen();
    vi.stubGlobal('fetch', stubExportFetch('', false));

    clickMenuItem(target, 'Print');
    await settle();

    expect(create).not.toHaveBeenCalled();
    expect(wins[0].location.href).toBe('');
    expect(wins[0].close).toHaveBeenCalled();
    const alert = target.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Could not open the PDF');
  });

  it('says the popup was blocked, without fetching or minting a URL', async () => {
    const { target } = await mountPage();
    const { create } = stubObjectUrls();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const fetchMock = stubExportFetch();
    vi.stubGlobal('fetch', fetchMock);

    clickMenuItem(target, 'Print');
    await settle();

    // The blank window opens synchronously, so a blocked popup is known
    // before the export is even asked for.
    expect(open).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    const alert = target.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/blocked/i);
  });

  it('revokes the live object URL on unmount', async () => {
    const { target, unmount } = await mountPage();
    const { revoke } = stubObjectUrls();
    stubWindowOpen();
    vi.stubGlobal('fetch', stubExportFetch());

    clickMenuItem(target, 'Print');
    await settle();
    // Held for the open tab, not revoked the moment it opens.
    expect(revoke).not.toHaveBeenCalled();

    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:print-1');
  });

  it('navigates the blank window nowhere when the export resolves after unmount', async () => {
    const { target, unmount } = await mountPage();
    const { create } = stubObjectUrls();
    const { wins } = stubWindowOpen();
    // Hold the export open so the unmount lands inside the await window —
    // resolving it early would let the continuation finish first and the test
    // would pass without ever entering the gap.
    let resolveFetch!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(
      () => new Promise<Response>((r) => { resolveFetch = r; }),
    ));

    const rejections = await captureUnhandledRejections(async () => {
      clickMenuItem(target, 'Print');
      unmount();
      resolveFetch(new Response(JSON.stringify({
        filename: 'foo.pdf', mimeType: 'application/pdf',
        data: 'JVBERi0xLjQ', encoding: 'BASE64',
      }), { status: 200 }));
      await settle();
    });

    // The window was already opened synchronously; the stale run must close
    // it, mint no URL and navigate it nowhere. A crash there surfaces only
    // as an unhandled rejection.
    expect(create).not.toHaveBeenCalled();
    expect(wins[0].location.href).toBe('');
    expect(wins[0].close).toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });

  it('a non-PDF export closes the window and says so instead of navigating to it', async () => {
    const { target } = await mountPage();
    const { create } = stubObjectUrls();
    const { wins } = stubWindowOpen();
    vi.stubGlobal('fetch', stubExportFetch('PGh0bWw+', true, 'text/html'));

    clickMenuItem(target, 'Print');
    await settle();

    expect(create).not.toHaveBeenCalled();
    expect(wins[0].location.href).toBe('');
    expect(wins[0].close).toHaveBeenCalled();
    const alert = target.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('did not return a PDF');
  });

  // ── Reused-page navigation (#1193 READ P2s: Gustav 6308078003, George
  // 6308087332). SvelteKit reuses this component between nodes, so an
  // export for A must not open over B, and A's catch/finally must not
  // write B's state. ────────────────────────────────────────────────────

  const NODE_B = {
    ...NODE, id: 'other-pk', memoryId: 'mem-A', loc: 'bar', name: 'Bar',
  };
  const NODE_C = {
    ...NODE, id: 'third-pk', memoryId: 'mem-A', loc: 'baz', name: 'Baz',
  };

  async function navigateTo(props: Record<string, unknown>, node: typeof NODE) {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node };
      if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
      return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
    });
    props.data = {
      ...(props.data as object),
      node,
      graphNodes: [
        { id: node.id, memoryId: node.memoryId, loc: node.loc, name: node.name, nodeType: 'info', tags: [] },
      ],
    };
    for (let i = 0; i < 5; i++) await tick();
    flushSync();
    // The rerender happened: the menu now labels itself for the new node.
    document.querySelector(`button[aria-label="Actions for ${node.name}"]`);
  }

  const navigateToNodeB = (props: Record<string, unknown>) => navigateTo(props, NODE_B);

  it('navigates nowhere when the export resolves after a node change', async () => {
    const { target, props } = await mountPage();
    const { create } = stubObjectUrls();
    const { wins } = stubWindowOpen();
    let resolveFetch!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(
      () => new Promise<Response>((r) => { resolveFetch = r; }),
    ));

    const rejections = await captureUnhandledRejections(async () => {
      clickMenuItem(target, 'Print');
      await navigateToNodeB(props);
      resolveFetch(new Response(JSON.stringify({
        filename: 'foo.pdf', mimeType: 'application/pdf',
        data: 'JVBERi0xLjQ', encoding: 'BASE64',
      }), { status: 200 }));
      await settle();
    });

    // A's PDF must not open over B; the blank window A opened is closed.
    expect(create).not.toHaveBeenCalled();
    expect(wins[0].location.href).toBe('');
    expect(wins[0].close).toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });

  it('revokes the previous node\'s live object URL on node change', async () => {
    const { target, props } = await mountPage();
    const { revoke } = stubObjectUrls();
    stubWindowOpen();
    vi.stubGlobal('fetch', stubExportFetch());

    clickMenuItem(target, 'Print');
    await settle();
    expect(revoke).not.toHaveBeenCalled();

    await navigateToNodeB(props);
    expect(revoke).toHaveBeenCalledWith('blob:print-1');
  });

  it('an old export\'s error does not touch the new node\'s print in flight', async () => {
    const { target, props } = await mountPage();
    const { create } = stubObjectUrls();
    const { wins } = stubWindowOpen();
    // A's export is held; after the navigation B's export is held too.
    const resolvers: Array<(r: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(
      () => new Promise<Response>((r) => { resolvers.push(r); }),
    ));

    clickMenuItem(target, 'Print'); // A, held
    await navigateToNodeB(props);
    clickMenuItem(target, 'Print'); // B, held (busy was reset by the change)
    expect(wins.length).toBe(2);

    // A's export now fails: its catch must not write B's error state or
    // close B's window.
    resolvers[0](new Response('Internal Server Error', { status: 500 }));
    await settle();
    expect(target.querySelector('[role="alert"]')).toBeNull();
    expect(wins[1].close).not.toHaveBeenCalled();
    expect(wins[0].close).toHaveBeenCalled();

    // B's export succeeds and navigates its own window.
    resolvers[1](new Response(JSON.stringify({
      filename: 'bar.pdf', mimeType: 'application/pdf',
      data: 'JVBERi0xLjQ', encoding: 'BASE64',
    }), { status: 200 }));
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(wins[1].location.href).toBe('blob:print-1');
    expect(wins[1].close).not.toHaveBeenCalled();
  });

  // ── Pending-work ownership (#1193 READ P2 residual, George 6308253956):
  // invalidation must cancel the in-flight export and close its blank
  // window immediately — not when the request settles — and repeated
  // navigation must not accumulate outstanding exports. These probes hang
  // the fetch on purpose (see hangingFetch).
  // ────────────────────────────────────────────────────────────────────

  it('closes the pending blank window on unmount without the export ever settling', async () => {
    const { target, unmount } = await mountPage();
    const { create } = stubObjectUrls();
    const { wins } = stubWindowOpen();
    const { fn } = hangingFetch();
    vi.stubGlobal('fetch', fn);

    const rejections = await captureUnhandledRejections(async () => {
      clickMenuItem(target, 'Print');
      unmount();
      await settle();
    });

    // The hang must not gate cleanup: the blank window closes at unmount,
    // no URL is minted, and the aborted request throws nothing into the void.
    expect(wins[0].close).toHaveBeenCalled();
    expect(wins[0].location.href).toBe('');
    expect(create).not.toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });

  it('closes the previous node\'s pending window on node change, without settling its export', async () => {
    const { target, props } = await mountPage();
    const { create } = stubObjectUrls();
    const { wins } = stubWindowOpen();
    const { fn } = hangingFetch();
    vi.stubGlobal('fetch', fn);

    const rejections = await captureUnhandledRejections(async () => {
      clickMenuItem(target, 'Print'); // A, hangs
      await navigateToNodeB(props);
      await settle();
    });

    expect(wins[0].close).toHaveBeenCalled();
    expect(wins[0].location.href).toBe('');
    expect(create).not.toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });

  it('aborts the abandoned export at each node change, bounding outstanding prints', async () => {
    const { target, props } = await mountPage();
    const { wins } = stubWindowOpen();
    const { fn, signals } = hangingFetch();
    vi.stubGlobal('fetch', fn);

    const rejections = await captureUnhandledRejections(async () => {
      clickMenuItem(target, 'Print'); // A, hangs
      await navigateTo(props, NODE_B);
      clickMenuItem(target, 'Print'); // B, hangs
      await navigateTo(props, NODE_C);
      clickMenuItem(target, 'Print'); // C, hangs
      await settle();
    });

    // A's and B's exports were left behind by navigation: their requests
    // are cancelled and their windows closed, so at most one live export —
    // the current node's — is outstanding at any time.
    expect(fn).toHaveBeenCalledTimes(3);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(true);
    expect(signals[2].aborted).toBe(false);
    expect(wins[0].close).toHaveBeenCalled();
    expect(wins[1].close).toHaveBeenCalled();
    expect(wins[2].close).not.toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });
});
