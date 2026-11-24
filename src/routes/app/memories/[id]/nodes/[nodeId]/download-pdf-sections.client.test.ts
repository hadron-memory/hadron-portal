/**
 * portal#426 — Download → PDF surfaces a section picker. A PDF is always the
 * title and content; the reader may add Abstract, Data, Properties, Edges and
 * Metadata (Comments waits on a ruling). Pins what the dialog shows and the
 * request it sends. Mounts the REAL page with data from the REAL loader.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
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
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:x'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
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
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
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
  return m;
}

function openDownload(target: HTMLElement) {
  target.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]')!.click();
  flushSync();
  [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.trim() === 'Download')!.click();
  flushSync();
}
const radio = (target: HTMLElement, value: string) => target.querySelector<HTMLInputElement>(`input[name="dlFormat"][value="${value}"]`)!;
const choose = (target: HTMLElement, value: string) => { radio(target, value).click(); flushSync(); };
const checkbox = (target: HTMLElement, label: string) =>
  [...target.querySelectorAll<HTMLLabelElement>('label')].find((l) => l.textContent?.trim() === label)?.querySelector<HTMLInputElement>('input[type="checkbox"]');
const download = (target: HTMLElement) => [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith('Download .'))!;

function stubFetch() {
  const fn = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ filename: 'foo.pdf', mimeType: 'application/pdf', data: 'JVBERi0xLjQ', encoding: 'BASE64' }), { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const sent = (fn: ReturnType<typeof stubFetch>) => JSON.parse((fn.mock.calls[0] as [string, RequestInit])[1].body as string);

describe('Download → PDF section picker (portal#426)', () => {
  it('offers the sections a PDF can add, none ticked, and no Content toggle', async () => {
    const { target } = await mountPage();
    openDownload(target);
    choose(target, 'PDF');
    for (const label of ['Abstract', 'Data', 'Properties', 'Edges', 'Metadata']) {
      const box = checkbox(target, label);
      expect(box, label).toBeDefined();
      expect(box!.checked, label).toBe(false);
    }
    expect(checkbox(target, 'Content')).toBeUndefined();
    expect(checkbox(target, 'Comments')).toBeUndefined();
    expect(target.textContent).toContain('The title and content are always included.');
  });

  it('sends the chosen sections with full:false, and nothing chosen is the content-only PDF', async () => {
    const { target } = await mountPage();
    const fn = stubFetch();
    openDownload(target);
    choose(target, 'PDF');
    download(target).click();
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(sent(fn)).toEqual({ id: 'leaf-pk', format: 'PDF', full: false, sections: [] });

    fn.mockClear();
    await vi.waitFor(() => expect(target.querySelector('input[name="dlFormat"]')).toBeNull()); // the first download closed the dialog
    openDownload(target);
    choose(target, 'PDF');
    checkbox(target, 'Edges')!.click();
    checkbox(target, 'Data')!.click();
    flushSync();
    download(target).click();
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(sent(fn)).toEqual({ id: 'leaf-pk', format: 'PDF', full: false, sections: ['DATA', 'EDGES'] });
  });

  it('keeps the Markdown picks and the PDF picks apart, in both directions', async () => {
    const { target } = await mountPage();
    openDownload(target);
    choose(target, 'PDF');
    checkbox(target, 'Edges')!.click(); // PDF: Edges on, Data off
    flushSync();
    choose(target, 'MD');
    target.querySelector<HTMLInputElement>('input[name="dlScope"][value="false"]')!.click();
    flushSync();
    expect(checkbox(target, 'Data')!.checked).toBe(true); // Markdown's own default: every section on
    checkbox(target, 'Data')!.click(); // Markdown: Data off
    flushSync();
    choose(target, 'PDF');
    expect(checkbox(target, 'Edges')!.checked).toBe(true);
    expect(checkbox(target, 'Data')!.checked).toBe(false); // PDF's own default, not Markdown's pick
    choose(target, 'MD');
    expect(checkbox(target, 'Data')!.checked).toBe(false); // Markdown kept its own pick
    expect(checkbox(target, 'Content')).toBeDefined();
  });
});
