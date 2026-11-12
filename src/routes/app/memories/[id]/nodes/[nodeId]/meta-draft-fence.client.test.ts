/**
 * portal#2023 — an unsaved Settings draft survives a loader refresh, and a save
 * from a draft that is older than the node is refused.
 *
 * Superforms rebinds a form to the fresh loader form on every page-data
 * invalidation, with no taint check, unless the form opts out with
 * `applyAction: 'never'` (hrn:node:hadronmemory.com:hadron-portal:findings:stable-form-id-opts-into-invalidate-rebind).
 * So an awaited loader refresh carrying ANOTHER editor's change replaced the
 * name the user was typing (Gizelle's probe on #2022).
 *
 * The harness delivers `page.data` wholesale with `page.form` still empty, which
 * is kit's real invalidateAll order. A harness that delivers an ActionResult
 * first never exercises the rebind and passes on the unfixed page (the false
 * green the finding documents).
 *
 * Keeping the draft makes a stale write possible, so the form also carries the
 * name and loc it was seeded from and the REAL action refuses a mismatch before
 * any write (no update, no moveNode).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { actionResultOf, submitEnhancedWithRawResult, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { MOVE_NODE_MUTATION, NODE_BY_ID_QUERY, NODE_DATA_READ_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY, UPDATE_NODE_MUTATION } from '$lib/server/queries';
import { nodeMetaBaseline } from '$lib/node-meta-seed';
import Page from './+page.svelte';
import { actions, load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: 'sum',
  tokens: null, tags: [], seq: null, data: null, properties: null,
  objectType: null, ownerRepo: null, role: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
  memory: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a' },
};
const PARENT = {
  canWriteMemory: true,
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false, schema: null },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};
const HREF = 'http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=settings';

/** What the server holds right now: tests replace it to model another editor's change. */
let stored: typeof NODE = NODE;
const mounted: Array<Mounted<Record<string, unknown>>> = [];

beforeEach(() => {
  stored = NODE;
  mockRequest.mockReset();
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY || doc === NODE_DATA_READ_QUERY) return { node: stored };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    if (doc === UPDATE_NODE_MUTATION) return { updateNode: stored };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  resetNavigationCalls();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  delete navigationHooks.onInvalidateAll;
  vi.unstubAllGlobals();
  resetStubPage();
  document.body.innerHTML = '';
});

async function loaderData() {
  const data = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(HREF),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  return { ...PARENT, ...data };
}

async function mountSettings() {
  setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
  const data = await loaderData();
  page.update((p) => ({ ...p, data }));
  const props = reactiveProps<Record<string, unknown>>({ data, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  if (!m.target.isConnected) document.body.appendChild(m.target);
  await tick();
  flushSync();
  return { m, props };
}

/** An awaited loader refresh, as kit runs invalidateAll: new data through the store AND the props, no action form. */
async function refreshLoader(props: Record<string, unknown>) {
  const fresh = await loaderData();
  page.update((p) => ({ ...p, data: fresh, form: null }));
  props.data = fresh;
  props.form = null;
  await settle();
}

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
const input = (target: HTMLElement, id: string) => target.querySelector<HTMLInputElement>(`#${id}`)!;
const metaForm = (target: HTMLElement) => target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;
const hidden = (target: HTMLElement, name: string) => metaForm(target).querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value;

function type(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** The REAL action, fed what the browser would post from the mounted form. */
async function postForm(target: HTMLElement) {
  const fd = new FormData(metaForm(target));
  return (await (actions as Record<string, (e: never) => Promise<unknown>>).updateMeta({
    request: { formData: async () => fd },
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
  } as never)) as { status?: number; data?: Record<string, unknown> };
}

const OTHER = { ...NODE, name: 'Other tab saved', loc: 'moved:elsewhere' };

describe('an unsaved draft survives a loader refresh (portal#2023)', () => {
  it("keeps the typed name when the refresh carries another editor's change (Gizelle's scenario)", async () => {
    const { m, props } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), 'Unsaved draft');

    stored = OTHER;
    await refreshLoader(props);

    expect(input(m.target, 'editName').value).toBe('Unsaved draft');
  });

  it('keeps the draft loc too, and the baseline stays on what the editor opened on', async () => {
    const { m, props } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editLoc'), 'my:typed:loc');

    stored = OTHER;
    await refreshLoader(props);

    expect(input(m.target, 'editLoc').value).toBe('my:typed:loc');
    expect(hidden(m.target, 'baseline')).toBe(nodeMetaBaseline(NODE));
  });
});

describe('saving a draft older than the node is refused, not written (portal#2023)', () => {
  it('another editor moved the node: the save refuses with 409 and sends no update and no moveNode', async () => {
    const { m, props } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), 'Unsaved draft');
    stored = OTHER;
    await refreshLoader(props);
    mockRequest.mockClear();

    const r = await postForm(m.target);

    expect(r.status).toBe(409);
    const sent = mockRequest.mock.calls.map(([q]) => q);
    expect(sent).not.toContain(UPDATE_NODE_MUTATION);
    expect(sent).not.toContain(MOVE_NODE_MUTATION);
  });

  it('the refusal is visible on the page', async () => {
    const { m, props } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), 'Unsaved draft');
    stored = OTHER;
    await refreshLoader(props);

    const r = await postForm(m.target);
    await submitEnhancedWithResult(metaForm(m.target), actionResultOf(r as never));
    // Kit hands the page store's action data to the page as its `form` prop.
    props.form = (get(page) as { form?: unknown }).form ?? null;
    await settle();

    expect(m.target.querySelector('[data-testid="node-meta-error"]')?.textContent).toMatch(/nothing was saved/i);
  });

  it('Cancel is the explicit resolution: it loads the node as it now is and the next save is accepted', async () => {
    const { m, props } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), 'Unsaved draft');
    stored = OTHER;
    await refreshLoader(props);

    buttonNamed(m.target, 'Cancel')!.click();
    flushSync();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();

    expect(input(m.target, 'editName').value).toBe('Other tab saved');
    expect(hidden(m.target, 'baseline')).toBe(nodeMetaBaseline(OTHER));
    mockRequest.mockClear();
    const r = await postForm(m.target);
    expect(r.status).toBeUndefined();
    expect(mockRequest.mock.calls.map(([q]) => q)).toContain(UPDATE_NODE_MUTATION);
  });
});

describe('a failed save that wrote nothing leaves the baseline alone (Glen on #2027)', () => {
  it('an invalid name is refused, and the corrected retry is accepted, not refused as a conflict', async () => {
    const { m } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), '');
    const refused = await postForm(m.target);
    expect(refused.status).toBe(400);
    await submitEnhancedWithResult(metaForm(m.target), actionResultOf(refused as never));
    await settle();

    expect(hidden(m.target, 'baseline')).toBe(nodeMetaBaseline(NODE));
    type(input(m.target, 'editName'), 'Foo corrected');
    mockRequest.mockClear();
    const retried = await postForm(m.target);
    expect(retried.status).toBeUndefined();
    expect(mockRequest.mock.calls.map(([q]) => q)).toContain(UPDATE_NODE_MUTATION);
  });
});

describe('an unconfirmed save under the fence (portal#2014 composed with portal#2023)', () => {
  const UNCONFIRMED = /save wasn't confirmed/i;

  it('keeps the draft and the baseline, shows the unconfirmed text, and the retry is accepted', async () => {
    const { m } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), 'Unsaved draft');

    // No action response arrived (a dropped request): kit hands superforms an `error` result.
    await submitEnhancedWithRawResult(metaForm(m.target), { type: 'error', error: new Error('network') });
    await settle();

    expect(m.target.querySelector('[data-testid="node-meta-error"]')?.textContent).toMatch(UNCONFIRMED);
    expect(input(m.target, 'editName').value).toBe('Unsaved draft');
    expect(hidden(m.target, 'baseline')).toBe(nodeMetaBaseline(NODE));
    // Save is usable again (the point of #2014's no-rethrow onError).
    expect(Array.from(m.target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save')?.disabled ?? false).toBe(false);

    mockRequest.mockClear();
    const retried = await postForm(m.target);
    expect(retried.status).toBeUndefined();
    expect(mockRequest.mock.calls.map(([q]) => q)).toContain(UPDATE_NODE_MUTATION);
  });

  it('an unconfirmed save followed by another editor\'s change is still refused on retry, not written over', async () => {
    const { m, props } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), 'Unsaved draft');
    await submitEnhancedWithRawResult(metaForm(m.target), { type: 'error', error: new Error('network') });
    await settle();
    stored = OTHER;
    await refreshLoader(props);

    mockRequest.mockClear();
    const retried = await postForm(m.target);
    expect(retried.status).toBe(409);
    const sent = mockRequest.mock.calls.map(([q]) => q);
    expect(sent).not.toContain(UPDATE_NODE_MUTATION);
    expect(sent).not.toContain(MOVE_NODE_MUTATION);
  });
});

describe('a full-page refusal keeps the draft AND the baseline it was typed against (Gene on #2027)', () => {
  /** The refused action's answer, delivered as a fresh page load (no JS, or a remount), as kit does. */
  async function remountWith(refused: { data?: Record<string, unknown> }) {
    while (mounted.length) mounted.pop()!.unmount();
    resetStubPage();
    setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
    const fresh = await loaderData();
    page.update((p) => ({ ...p, data: fresh, form: refused.data }));
    const props = reactiveProps<Record<string, unknown>>({ data: fresh, form: refused.data });
    const next = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(next);
    document.body.appendChild(next.target);
    await settle();
    return next;
  }

  it('a retry from the remounted draft is refused again, with no update and no moveNode', async () => {
    const { m } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), 'Unsaved draft');
    stored = OTHER;
    const refused = await postForm(m.target);
    expect(refused.status).toBe(409);

    const next = await remountWith(refused);
    buttonNamed(next.target, 'Edit')!.click();
    flushSync();
    expect(input(next.target, 'editName').value).toBe('Unsaved draft');
    expect(hidden(next.target, 'baseline')).toBe(nodeMetaBaseline(NODE));

    mockRequest.mockClear();
    const retried = await postForm(next.target);
    expect(retried.status).toBe(409);
    const sent = mockRequest.mock.calls.map(([q]) => q);
    expect(sent).not.toContain(UPDATE_NODE_MUTATION);
    expect(sent).not.toContain(MOVE_NODE_MUTATION);
  });

  it('a save that carried NO baseline is refused again after a remount, not accepted against the fresh node (Gene on #2027)', async () => {
    const { m } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), 'Unsaved draft');
    stored = OTHER;
    // A caller that posts the form without the hidden baseline (a stale bundle, a script).
    const fd = new FormData(metaForm(m.target));
    fd.delete('baseline');
    const refused = (await (actions as Record<string, (e: never) => Promise<unknown>>).updateMeta({
      request: { formData: async () => fd },
      params: { id: 'mem-A', nodeId: 'leaf-pk' },
      locals: { token: 'tok' },
    } as never)) as { status?: number; data?: Record<string, unknown> };
    expect(refused.status).toBe(400);

    const next = await remountWith(refused);
    buttonNamed(next.target, 'Edit')!.click();
    flushSync();
    mockRequest.mockClear();
    const retried = await postForm(next.target);
    expect(retried.status).toBe(409);
    const sent = mockRequest.mock.calls.map(([q]) => q);
    expect(sent).not.toContain(UPDATE_NODE_MUTATION);
    expect(sent).not.toContain(MOVE_NODE_MUTATION);
  });

  it('a validation refusal also keeps its baseline (an empty name, then the node changes)', async () => {
    const { m } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), '');
    const refused = await postForm(m.target);
    expect(refused.status).toBe(400);
    stored = OTHER;

    const next = await remountWith(refused);
    buttonNamed(next.target, 'Edit')!.click();
    flushSync();
    expect(hidden(next.target, 'baseline')).toBe(nodeMetaBaseline(NODE));
  });

  it('control: a fresh load with no refusal takes its baseline from the node', async () => {
    stored = OTHER;
    const { m } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    expect(hidden(m.target, 'baseline')).toBe(nodeMetaBaseline(OTHER));
  });
});

describe('controls', () => {
  it('an ordinary save from an untouched baseline is accepted', async () => {
    const { m } = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    type(input(m.target, 'editName'), 'Foo renamed');
    const r = await postForm(m.target);
    expect(r.status).toBeUndefined();
    expect(mockRequest.mock.calls.map(([q]) => q)).toContain(UPDATE_NODE_MUTATION);
  });

  it('a closed editor still follows a loader refresh (no draft to protect)', async () => {
    const { m, props } = await mountSettings();
    stored = OTHER;
    await refreshLoader(props);
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    expect(input(m.target, 'editName').value).toBe('Other tab saved');
    expect(hidden(m.target, 'baseline')).toBe(nodeMetaBaseline(OTHER));
  });
});
