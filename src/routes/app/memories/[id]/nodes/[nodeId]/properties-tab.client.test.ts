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
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';
import { NODE_STORAGE_FORM_ID, nodeStorageSchema } from './storage-schema';

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
  canWriteMemory: true,
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
  resetStubPage();
});

async function loaded(node: typeof NODE) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
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

  // `hrn:node:hadronmemory.com:hadron-portal:findings:superforms-reset-form-undoes-edit-in-place-save`:
  // the /edit page redirected on success, so superforms' default reset never
  // showed. Inline, it restores the seed the form MOUNTED with, and the hidden
  // bag would post the pre-save value on the next Save. Replays SvelteKit's
  // post-submit order: the loader re-reads, then the action result applies.
  it('after its own save, submits the SAVED bag, not the one it mounted with', async () => {
    const { target, props } = await mountPage();
    const raw = storageForm(target)!.querySelector<HTMLTextAreaElement>('textarea#properties')!;
    raw.value = '{"color": "green"}';
    raw.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    props.data = await loaded({ ...NODE, properties: { color: 'green' } });
    flushSync();
    await tick();
    const result = await superValidate(
      { _kind: 'updateStorage', isRunnable: false, objectType: '', propertiesJson: '{"color": "green"}' },
      zod4(nodeStorageSchema),
      { id: NODE_STORAGE_FORM_ID },
    );
    result.message = { type: 'success', text: 'Saved.' };
    page.update((p) => ({ ...p, status: 200, form: { form: result } }));
    flushSync();
    for (let i = 0; i < 3; i++) await tick();

    expect(target.textContent).toContain('Saved.');
    expect(submittedBag(target)).toEqual({ color: 'green' });

    // Editing again: "Saved." no longer describes what is on screen (Cody on #1035).
    raw.value = '{"color": ';
    raw.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.textContent).not.toContain('Saved.');
  });

  // The same finding's Codex P2 on #971: another form's save re-runs the
  // loader, and a same-node reseed must not take an unsaved edit with it. Here
  // the reseed keys on this form's OWN stored fields, so a Content save leaves
  // it alone.
  it('keeps an unsaved edit when another form on the page saves', async () => {
    const { target, props } = await mountPage();
    const raw = storageForm(target)!.querySelector<HTMLTextAreaElement>('textarea#properties')!;
    raw.value = '{"color": "green"}';
    raw.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    props.data = await loaded({ ...NODE, content: 'edited elsewhere', revision: 5 });
    for (let i = 0; i < 3; i++) await tick();
    flushSync();

    expect(submittedBag(target)).toEqual({ color: 'green' });
  });
});


describe('reader memory editors (#646)', () => {
  it('disables storage and source saves while retaining source and tab navigation', async () => {
    const { target, props } = await mountPage();
    flushSync(() => { props.data = { ...(props.data as any), canWriteMemory: false }; });
    await tick();
    expect(storageForm(target)!.closest('fieldset')!.disabled).toBe(true);
    expect(target.textContent).toContain('Read only');
    buttonNamed(target, 'Source')!.click();
    flushSync();
    const source = target.querySelector<HTMLTextAreaElement>('textarea#node-properties-source');
    const textareas = [...target.querySelectorAll<HTMLTextAreaElement>('textarea')];
    expect(source ?? textareas.find(t => t.readOnly)).toBeTruthy();
    expect(buttonNamed(target, 'Save')?.disabled).toBe(true);
    tabNamed(target, 'Content')!.click();
    flushSync();
    buttonNamed(target, 'Source')!.click();
    flushSync();
    expect([...target.querySelectorAll<HTMLTextAreaElement>('textarea')].some(t => t.readOnly && t.value === 'body')).toBe(true);
    // Restore the server write decision without replacing the page.
    flushSync(() => { props.data = { ...(props.data as any), canWriteMemory: true }; });
    await tick();
    expect(storageForm(target)!.closest('fieldset')!.disabled).toBe(false);
  });
});

it('disables missing-parent creation for a reader and preserves it for a writer (#646 LOCAL P2)', async () => {
  const { target, props } = await mountPage();
  flushSync(() => { props.data = { ...(props.data as any), canWriteMemory: false, ancestorsKnown: true, breadcrumb: [
    { label: 'Missing', path: 'missing', nodeId: null },
    { label: 'Foo', path: 'missing:foo', nodeId: NODE.id },
  ] }; });
  await tick();
  const create = target.querySelector<HTMLButtonElement>('form[action="?/createParent"] button')!;
  expect(create).not.toBeNull();
  expect(create.disabled).toBe(true);
  flushSync(() => { props.data = { ...(props.data as any), canWriteMemory: true }; });
  await tick();
  expect(create.disabled).toBe(false);
});


it('portal#1524: with the node list off, a crumb without a node id is NOT offered for creation (it was never looked up)', async () => {
  const { target, props } = await mountPage();
  flushSync(() => { props.data = { ...(props.data as any), canWriteMemory: true, ancestorsKnown: false, breadcrumb: [
    { label: 'Maybe', path: 'maybe', nodeId: null },
    { label: 'Foo', path: 'maybe:foo', nodeId: NODE.id },
  ] }; });
  await tick();
  expect(target.querySelector('form[action="?/createParent"]')).toBeNull();
  expect(target.textContent).not.toContain('Create parent node');
});

it('portal#1524: children read unavailable says so; it never reads as "no children" or a 0 count', async () => {
  const { target, props } = await mountPage();
  flushSync(() => { props.data = { ...(props.data as any), children: null, childrenUnavailable: true }; });
  await tick();
  expect(target.querySelector('[data-testid="children-unavailable"]')?.textContent).toContain('Children unavailable');
  expect(target.textContent).not.toMatch(/No children|Children\s*0/);
});

it('portal#1524: a complete childless read shows no Children tab and no unavailable note', async () => {
  const { target, props } = await mountPage();
  flushSync(() => { props.data = { ...(props.data as any), children: [], childrenUnavailable: false }; });
  await tick();
  expect(target.querySelector('[data-testid="children-unavailable"]')).toBeNull();
});

it('keeps reader Settings read-only and restores writer metadata and delete controls', async () => {
  const { target, props } = await mountPage();
  props.data = { ...props.data as Record<string, unknown>, canWriteMemory: false };
  flushSync();
  tabNamed(target, 'Settings')!.click();
  flushSync();
  expect(buttonNamed(target, 'Edit')).toBeUndefined();
  expect(buttonNamed(target, 'Delete node')).toBeUndefined();
  expect(target.querySelector('#editName')).toBeNull();
  props.data = { ...props.data as Record<string, unknown>, canWriteMemory: true };
  flushSync();
  expect(buttonNamed(target, 'Delete node')?.disabled).toBe(false);
  buttonNamed(target, 'Edit')!.click();
  flushSync();
  expect(target.querySelector('#editName')).not.toBeNull();
});

it('portal#2316: the typed-object field list renders through the shared DataTable, not a hand-rolled table', async () => {
  const schema = { objectTypes: { competitor: { fields: { name: { type: 'text', required: true }, stage: { type: 'text' } } } } };
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: { ...NODE, objectType: 'competitor', properties: { name: 'Acme' } } };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const parent = { ...PARENT, graph: { ...PARENT.graph, schema } };
  const data = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=properties'),
    parent: vi.fn().mockResolvedValue(parent),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...parent, ...data }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  flushSync();
  const rows = m.target.querySelectorAll('[data-testid="typed-property-row"]');
  expect([...rows].map((r) => r.getAttribute('data-field'))).toEqual(['name', 'stage']);
  expect(rows[0]!.textContent).toContain('Acme');
  expect(rows[1]!.textContent).toContain('—');
});

