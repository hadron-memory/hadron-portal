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
  target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Foo"]')!.click();
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

function stubExportFetch(data = 'JVBERi0xLjQ', ok = true) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({
      filename: 'foo.pdf', mimeType: 'application/pdf', data, encoding: 'BASE64',
    }), { status: ok ? 200 : 500 }));
}

/** A truthy stand-in for the Window window.open returns on success. */
const FAKE_WINDOW = {} as unknown as Window;

describe('node menu Print (#1073)', () => {
  it('opens the node\'s PDF render in a new tab, revoking only the previous URL', async () => {
    const { target } = await mountPage();
    const { create, revoke } = stubObjectUrls();
    const open = vi.spyOn(window, 'open').mockReturnValue(FAKE_WINDOW);
    const fetchMock = stubExportFetch();
    vi.stubGlobal('fetch', fetchMock);

    clickMenuItem(target, 'Print');
    await settle();

    // The server-rendered PDF (#421 export path), asked for by PK.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(input).toBe('/api/nodes/export');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ id: 'leaf-pk', format: 'PDF', full: true });
    expect(open).toHaveBeenCalledWith('blob:print-1', '_blank');

    // A second print holds at most one object URL.
    clickMenuItem(target, 'Print');
    await settle();
    expect(open).toHaveBeenLastCalledWith('blob:print-2', '_blank');
    expect(revoke).toHaveBeenCalledWith('blob:print-1');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('renders an alert and opens nothing when the export fails', async () => {
    const { target } = await mountPage();
    stubObjectUrls();
    const open = vi.spyOn(window, 'open').mockReturnValue(FAKE_WINDOW);
    vi.stubGlobal('fetch', stubExportFetch('', false));

    clickMenuItem(target, 'Print');
    await settle();

    expect(open).not.toHaveBeenCalled();
    const alert = target.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Could not open the PDF');
  });

  it('says the popup was blocked and does not strand its object URL', async () => {
    const { target } = await mountPage();
    const { create, revoke } = stubObjectUrls();
    // null is what window.open returns when the browser blocks the popup.
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.stubGlobal('fetch', stubExportFetch());

    clickMenuItem(target, 'Print');
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    // The URL minted for a window that never opened is revoked, not left to
    // live for the tab's lifetime.
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:print-1');
    const alert = target.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/blocked/i);
  });

  it('revokes the live object URL on unmount', async () => {
    const { target, unmount } = await mountPage();
    const { revoke } = stubObjectUrls();
    vi.spyOn(window, 'open').mockReturnValue(FAKE_WINDOW);
    vi.stubGlobal('fetch', stubExportFetch());

    clickMenuItem(target, 'Print');
    await settle();
    // Held for the open tab, not revoked the moment it opens.
    expect(revoke).not.toHaveBeenCalled();

    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:print-1');
  });

  it('opens nothing when the export resolves after unmount', async () => {
    const { target, unmount } = await mountPage();
    const { create } = stubObjectUrls();
    const open = vi.spyOn(window, 'open').mockReturnValue(FAKE_WINDOW);
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

    // A tab opening after the user left the page is the #782-class hazard;
    // a crash there surfaces only as an unhandled rejection.
    expect(create).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });
});
