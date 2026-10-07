/**
 * #1031 — the Properties tab holds the storage form (object type, typed
 * properties, skill export) that used to be the separate `/edit` page.
 *
 * Mounts the REAL node page with data from the REAL loader, as
 * `form-ids.client.test.ts` does, because what is pinned here is the page's
 * arrangement and lifetime: which controls are on the tab, and that the form
 * outlives a tab switch and follows a save made by the Source view beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: { color: 'red' } as Record<string, unknown> | null,
  objectType: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
};
const PARENT = {
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false, schema: null },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // The Source view's textarea autosizes through a ResizeObserver, which jsdom
  // does not implement.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=properties', { id: 'mem-A', nodeId: 'leaf-pk' });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

async function loaded(node: typeof NODE) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const data = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=properties'),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  return { ...PARENT, ...data };
}

async function mountPage(node = NODE) {
  const props = reactiveProps<Record<string, unknown>>({ data: await loaded(node), form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  flushSync();
  return { ...m, props };
}

const storageForm = (target: HTMLElement) =>
  target.querySelector<HTMLFormElement>('form[action="?tab=properties&/updateStorage"]');
const submittedBag = (target: HTMLElement) =>
  JSON.parse(storageForm(target)!.querySelector<HTMLInputElement>('input[name=propertiesJson]')!.value || 'null');
const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
// A tab button's text can carry an "Empty" badge after its label.
const tabNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(label));

describe('Properties tab (#1031)', () => {
  it('shows the storage form in place of the Edit link and the Add properties button', async () => {
    const { target } = await mountPage({ ...NODE, properties: null });
    const form = storageForm(target);
    expect(form).not.toBeNull();
    expect(form!.closest('[hidden]')).toBeNull();
    expect(target.querySelector('a[href$="/edit"]')).toBeNull();
    expect(buttonNamed(target, 'Add properties')).toBeUndefined();
    expect(target.textContent).toContain('Structured storage');
  });

  it('hides the form under the Source view, which edits the same bag', async () => {
    const { target } = await mountPage();
    buttonNamed(target, 'Source')!.click();
    flushSync();
    expect(storageForm(target)!.closest('[hidden]')).not.toBeNull();
    buttonNamed(target, 'Rendered')!.click();
    flushSync();
    expect(storageForm(target)!.closest('[hidden]')).toBeNull();
  });

  it('keeps an unsaved edit through a switch to another tab and back', async () => {
    const { target } = await mountPage();
    const objectType = storageForm(target)!.querySelector<HTMLInputElement>('#objectType')!;
    objectType.value = 'competitor';
    objectType.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    tabNamed(target, 'Data')!.click();
    flushSync();
    expect(storageForm(target)!.closest('[hidden]')).not.toBeNull();
    tabNamed(target, 'Properties')!.click();
    flushSync();

    expect(storageForm(target)!.querySelector<HTMLInputElement>('#objectType')!.value).toBe('competitor');
  });

  it('follows a save made by the Source view, so its own next Save cannot undo it', async () => {
    const { target, props } = await mountPage();
    expect(submittedBag(target)).toEqual({ color: 'red' });

    // The Source view saved a new bag; the loader re-ran for the SAME node.
    props.data = await loaded({ ...NODE, properties: { color: 'blue', size: 3 } });
    for (let i = 0; i < 3; i++) await tick();
    flushSync();

    expect(submittedBag(target)).toEqual({ color: 'blue', size: 3 });
  });
});
