/**
 * portal#2057 — after a full-page (no-JS) updateMeta refusal the page restores
 * the kept draft and the echoed baseline, but the conflict alert never shows:
 * the alert's text is read from the superForm message store, and nothing seeds
 * that store from the refused action form the page mounted with.
 *
 * Mounts the REAL page with the REAL loader's data and the REAL action's
 * refused answer as the `form` prop at INITIAL mount — what a native form POST
 * hands the component on hydration: no enhancer, no page-store sync, the
 * reader's own draft carried by the action's form. Then the reader opens the
 * editor and must be told WHY the save was refused.
 *
 * The kept-draft and echoed-baseline halves are already pinned
 * (meta-draft-fence.client.test.ts); this file pins the VISIBLE refusal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { captureUnhandledRejections, mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { fakeFindNodesChildren } from '$lib/test/fakeFindNodesChildren';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { COMMENT_THREADS_QUERY, NODE_COMMENT_SUMMARY_QUERY } from '$lib/server/comments';
import {
  MEMORIES_QUERY,
  NODE_APPROVAL_QUERY,
  NODE_BY_ID_QUERY,
  NODE_CHILDREN_QUERY,
  NODE_DATA_READ_QUERY,
  NODE_EDGE_REMOVALS_QUERY,
  NODE_PROPERTIES_READ_QUERY,
  NODE_PROVENANCE_QUERY,
  NODE_QUERY,
  NODE_REVISIONS_PAGE_QUERY,
  NODE_REVISIONS_PROVENANCE_PAGE_QUERY,
} from '$lib/server/queries';
import Page from './+page.svelte';
import { actions, load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: 'sum',
  tokens: null, tags: [], seq: null, data: {}, properties: {},
  objectType: null, ownerRepo: null, role: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
  memory: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a' },
};
// The external edit that stales the baseline: another editor renamed the node
// while our draft was open, so nodeMetaBaseline(stored) no longer matches the
// token the editor opened against.
const RENAMED = { ...NODE, name: 'Renamed elsewhere', revision: 5 };
const PARENT = {
  canWriteMemory: true,
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false, schema: null },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};
const HREF = 'http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=settings';

let stored = NODE;
function serve() {
  const serveChildren = fakeFindNodesChildren([], 'mem-A');
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    switch (doc) {
      case NODE_BY_ID_QUERY:
      case NODE_QUERY:
      case NODE_DATA_READ_QUERY:
      case NODE_PROPERTIES_READ_QUERY:
        return { node: stored };
      case NODE_REVISIONS_PAGE_QUERY:
      case NODE_REVISIONS_PROVENANCE_PAGE_QUERY:
        return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
      case NODE_PROVENANCE_QUERY:
      case NODE_APPROVAL_QUERY:
      case NODE_COMMENT_SUMMARY_QUERY:
        return { node: null };
      case NODE_CHILDREN_QUERY:
        return serveChildren(vars);
      case COMMENT_THREADS_QUERY:
        return { commentThreads: { items: [], total: 0 } };
      case NODE_EDGE_REMOVALS_QUERY:
        return { nodeEdgeRemovals: [] };
      case MEMORIES_QUERY:
        return { memories: { items: [], total: 0 } };
      default:
        throw new Error(`serve(): unexpected document "${String(doc).match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? 'unnamed'}" — extend the explicit cases, never add a catch-all`);
    }
  });
}
const runLoad = async () =>
  (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(HREF),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;

const mounted: Array<Mounted<Record<string, unknown>>> = [];
const unsubs: Array<() => void> = [];
const consoleMsgs: Array<{ level: string; text: string }> = [];
beforeEach(() => {
  mockRequest.mockReset();
  stored = NODE;
  resetNavigationCalls();
  consoleMsgs.length = 0;
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { consoleMsgs.push({ level: 'error', text: a.map(String).join(' ') }); });
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { consoleMsgs.push({ level: 'warn', text: a.map(String).join(' ') }); });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(async () => {
  const rejections = await captureUnhandledRejections(async () => {
    while (mounted.length) mounted.pop()!.unmount();
    while (unsubs.length) unsubs.pop()!();
    for (let i = 0; i < 10; i++) await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 10; i++) await tick();
    flushSync();
  });
  expect(rejections, rejections.map(String).join(' | ')).toEqual([]);
  const noise = consoleMsgs.filter((m) => !m.text.startsWith('[capabilities]'));
  expect(noise, noise.map((m) => `${m.level}: ${m.text}`).join(' | ')).toEqual([]);
  vi.unstubAllGlobals();
  resetNavigationCalls();
  resetStubPage();
  document.body.innerHTML = '';
});

const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

async function settle() {
  // The client-lane rules: superforms' post-mount validation and the seeding
  // effects land on later microtasks; asserting right after mount can pass on
  // broken code (mount-time-store-write-erases-server-error's lesson).
  for (let i = 0; i < 10; i++) await tick();
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

describe('full-page updateMeta refusal (portal#2057)', () => {
  it('shows the conflict alert beside the kept draft after a no-JS refusal hydration', async () => {
    setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
    serve();

    // ── First mount: open the editor, type a draft against the stored node.
    const first = mountComponent(Page as never, reactiveProps<Record<string, unknown>>({
      data: { ...PARENT, ...(await runLoad()) },
      form: null,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(first);
    if (!first.target.isConnected) document.body.appendChild(first.target);
    await settle();
    buttonNamed(first.target, 'Edit')!.click();
    flushSync();
    const nameInput = first.target.querySelector<HTMLInputElement>('#editName')!;
    nameInput.value = 'My unsent draft';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const formEl = first.target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;

    // ── The external rename stales the baseline, then the reader's browser
    // posts the form natively (no JS): the REAL action refuses with 409.
    stored = RENAMED;
    const refused = await actions.updateMeta({
      request: { formData: async () => new FormData(formEl) },
      params: { id: 'mem-A', nodeId: 'leaf-pk' },
      locals: { token: 'tok' },
    } as never) as Record<string, unknown>;
    // The refusal this test drives: a conflict, nothing written. Kit hands the
    // page the Fail's DATA as the `form` prop (the ActionResult wrapper is the
    // enhancer's shape, not the full-page one).
    const actionData = (refused as unknown as { status: number; data: Record<string, unknown> }).data;
    expect((actionData as { form?: { message?: { text?: string } } }).form?.message?.text)
      .toContain('changed since you opened the editor');

    // ── The full-page answer: Kit re-runs the loader against the renamed node
    // and renders the page with the refused action data as the `form` prop.
    // That is the hydration mount: fresh data, refused form, no enhancer.
    mounted.pop()!.unmount();
    const freshData = { ...PARENT, ...(await runLoad()) };
    const hydrated = mountComponent(Page as never, reactiveProps<Record<string, unknown>>({
      data: freshData,
      form: actionData,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(hydrated);
    if (!hydrated.target.isConnected) document.body.appendChild(hydrated.target);
    await settle();

    // The reader opens the editor as QA did (Settings ▸ Edit).
    buttonNamed(hydrated.target, 'Edit')!.click();
    flushSync();
    await settle();

    // The kept draft (already pinned elsewhere; re-asserted so the alert leg
    // cannot pass against a fixture that lost the draft).
    expect(hydrated.target.querySelector<HTMLInputElement>('#editName')!.value).toBe('My unsent draft');
    // portal#2057: the alert carries the server's refusal text.
    const alert = hydrated.target.querySelector<HTMLElement>('[data-testid="node-meta-error"]');
    expect(alert, 'the refusal alert must render beside the kept draft').not.toBeNull();
    expect(alert!.textContent).toContain('changed since you opened the editor');
  });

  it('control: Cancel then Edit does not show the refusal again', async () => {
    setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
    serve();
    const first = mountComponent(Page as never, reactiveProps<Record<string, unknown>>({
      data: { ...PARENT, ...(await runLoad()) },
      form: null,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(first);
    if (!first.target.isConnected) document.body.appendChild(first.target);
    await settle();
    buttonNamed(first.target, 'Edit')!.click();
    flushSync();
    const nameInput = first.target.querySelector<HTMLInputElement>('#editName')!;
    nameInput.value = 'My unsent draft';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const formEl = first.target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;

    stored = RENAMED;
    const refused = await actions.updateMeta({
      request: { formData: async () => new FormData(formEl) },
      params: { id: 'mem-A', nodeId: 'leaf-pk' },
      locals: { token: 'tok' },
    } as never) as Record<string, unknown>;
    const actionData = (refused as unknown as { status: number; data: Record<string, unknown> }).data;

    mounted.pop()!.unmount();
    const freshData = { ...PARENT, ...(await runLoad()) };
    const hydrated = mountComponent(Page as never, reactiveProps<Record<string, unknown>>({
      data: freshData,
      form: actionData,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(hydrated);
    if (!hydrated.target.isConnected) document.body.appendChild(hydrated.target);
    await settle();
    buttonNamed(hydrated.target, 'Edit')!.click();
    flushSync();
    await settle();
    expect(hydrated.target.querySelector('[data-testid="node-meta-error"]')?.textContent)
      .toContain('changed since you opened the editor');

    // Cancel drops every trace of the failed save (Clark's browser QA F1 on
    // #2002): reopening the editor must not show the old refusal again.
    buttonNamed(hydrated.target, 'Cancel')!.click();
    flushSync();
    await settle();
    buttonNamed(hydrated.target, 'Edit')!.click();
    flushSync();
    await settle();
    expect(hydrated.target.querySelector('[data-testid="node-meta-error"]')).toBeNull();
  });
  it('a refusal hydrated on one node does not follow the reader to the next node (the real node change still clears it)', async () => {
    setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
    serve();
    const first = mountComponent(Page as never, reactiveProps<Record<string, unknown>>({
      data: { ...PARENT, ...(await runLoad()) },
      form: null,
    }) as never) as Mounted<Record<string, unknown>>;
    mounted.push(first);
    if (!first.target.isConnected) document.body.appendChild(first.target);
    await settle();
    buttonNamed(first.target, 'Edit')!.click();
    flushSync();
    const nameInput = first.target.querySelector<HTMLInputElement>('#editName')!;
    nameInput.value = 'My unsent draft';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const formEl = first.target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;
    stored = RENAMED;
    const refused = await actions.updateMeta({
      request: { formData: async () => new FormData(formEl) },
      params: { id: 'mem-A', nodeId: 'leaf-pk' },
      locals: { token: 'tok' },
    } as never) as Record<string, unknown>;
    const actionData = (refused as unknown as { status: number; data: Record<string, unknown> }).data;

    mounted.pop()!.unmount();
    const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...(await runLoad()) }, form: actionData });
    const hydrated = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(hydrated);
    if (!hydrated.target.isConnected) document.body.appendChild(hydrated.target);
    await settle();
    buttonNamed(hydrated.target, 'Edit')!.click();
    flushSync();
    await settle();
    expect(hydrated.target.querySelector('[data-testid="node-meta-error"]')?.textContent, 'the refusal shows on the node it was for')
      .toContain('changed since you opened the editor');

    // The reader goes to another node and the page component stays mounted. `form` is deliberately NOT
    // cleared here: with it cleared, the page's own `scopedActionError` and superforms' form sync already
    // hide the alert, so the test would pass without the node effect's clearMetaRefusal() (mutant checked:
    // deleting that call fails only with the superform's refusal still held, as below).
    const OTHER = { ...NODE, id: 'leaf-2', loc: 'bar', name: 'Bar' };
    stored = OTHER;
    setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-2?tab=settings', { id: 'mem-A', nodeId: 'leaf-2' });
    const otherParent = { ...PARENT, graphNodes: [...PARENT.graphNodes, { id: 'leaf-2', memoryId: 'mem-A', loc: 'bar', name: 'Bar', nodeType: 'info', tags: [] }] };
    const otherData = { ...otherParent, ...((await load({
      params: { id: 'mem-A', nodeId: 'leaf-2' },
      locals: { token: 'tok' },
      url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-2?tab=settings'),
      parent: vi.fn().mockResolvedValue(otherParent),
    } as never)) as Record<string, unknown>) };
    props.data = otherData;
    await settle();
    // Open the editor on the new node, whichever state the previous one left it in.
    const edit = buttonNamed(hydrated.target, 'Edit');
    if (edit) { edit.click(); flushSync(); await settle(); }
    expect(hydrated.target.querySelector('[data-testid="node-meta-error"]')?.textContent ?? '', 'node A\'s refusal must not follow the reader to node B')
      .not.toContain('changed since you opened the editor');
  });
});
