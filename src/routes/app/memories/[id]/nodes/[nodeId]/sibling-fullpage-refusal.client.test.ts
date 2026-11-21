/**
 * portal#2446 — the inverse half of #2057. A full-page (no-JS) refusal hydrates
 * each sibling superForm from the refused action's answer: the message store
 * (the alert) AND the data store (the reader's draft). The node page's
 * reset-on-node-change effect also runs on FIRST mount, and its unguarded
 * resets wiped the draft while the alert survived.
 *
 * Mounts the REAL page with the REAL loader's data and the REAL action's
 * refused answer as the `form` prop at initial mount (hydration, no enhancer),
 * following meta-fullpage-refusal.client.test.ts. Move and delete are not
 * pinned here: their drafts are only reachable through the actions menu, whose
 * own handler re-seeds them (`$moveFormData.target = fullUrn`, `hard = false`),
 * so the wipe is not observable in the DOM; the guards are applied regardless.
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
  ORG_APPS_RUNNABLE_QUERY,
  RUN_TASK_APP_MUTATION,
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
  isRunnable: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
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
  org: { id: 'org-1' },
  user: { id: 'u1' },
};
const HREF = 'http://localhost/app/memories/mem-A/nodes/leaf-pk';

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
      case ORG_APPS_RUNNABLE_QUERY:
        return { apps: { items: [{ id: 'app-1', name: 'App One', appAgents: [] }], total: 1 } };
      case MEMORIES_QUERY:
        return { memories: { items: [], total: 0 } };
      case RUN_TASK_APP_MUTATION:
        throw new Error('the server refuses the run');
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


const field = (target: HTMLElement, sel: string) => target.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(sel);

async function refusedAction(name: 'testFlow' | 'updateFlow', fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await (actions as Record<string, (e: never) => Promise<unknown>>)[name]({
    request: { formData: async () => fd },
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
  } as never) as { status: number; data: Record<string, unknown> };
  return res.data;
}

async function mountHydrated(form: Record<string, unknown> | null) {
  setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
  serve();
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...(await runLoad()) }, form });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  if (!m.target.isConnected) document.body.appendChild(m.target);
  await settle();
  return { m, props };
}

describe('full-page sibling-form refusals keep the refused draft (portal#2446)', () => {
  it('testFlow: the refused App and payload survive hydration beside the alert', async () => {
    setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
    serve();
    const actionData = await refusedAction('testFlow', { _kind: 'testFlow', appId: 'app-1', orgId: 'org-1', agentRef: '', payload: '{"keep":"me"}' });
    expect((actionData as { form?: { message?: { type?: string } } }).form?.message?.type).toBe('error');
    const { m } = await mountHydrated(actionData);
    m.target.querySelector<HTMLElement>('button[aria-label="Actions for Foo"]')!.click();
    flushSync();
    const run = Array.from(m.target.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((b) => b.textContent?.trim() === 'Run');
    expect(run, 'the Run menu item').toBeTruthy();
    run!.click();
    flushSync();
    await settle();
    expect(field(m.target, '#testFlowPayload')!.value, 'the refused payload').toBe('{"keep":"me"}');
    expect((field(m.target, '#testFlowApp') as HTMLSelectElement).value, 'the refused App').toBe('app-1');
  });

  it('testFlow control: with no refusal the form opens at its defaults', async () => {
    const { m } = await mountHydrated(null);
    m.target.querySelector<HTMLElement>('button[aria-label="Actions for Foo"]')!.click();
    flushSync();
    Array.from(m.target.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((b) => b.textContent?.trim() === 'Run')!.click();
    flushSync();
    await settle();
    expect(field(m.target, '#testFlowPayload')!.value).toBe('');
    expect((field(m.target, '#testFlowApp') as HTMLSelectElement).value).toBe('');
  });

  it('testFlow: a refusal hydrated on one node does not follow the reader to the next node (a real node change still resets)', async () => {
    setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
    serve();
    const actionData = await refusedAction('testFlow', { _kind: 'testFlow', appId: 'app-1', orgId: 'org-1', agentRef: '', payload: '{"keep":"me"}' });
    const { m, props } = await mountHydrated(actionData);

    // Before the switch the refused draft IS there (hydration kept it), so the
    // empty payload asserted after it can only come from the node-change reset.
    m.target.querySelector<HTMLElement>('button[aria-label="Actions for Foo"]')!.click();
    flushSync();
    Array.from(m.target.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((b) => b.textContent?.trim() === 'Run')!.click();
    flushSync();
    await settle();
    expect(field(m.target, '#testFlowPayload')!.value, 'the refused payload before the node change').toBe('{"keep":"me"}');

    // The reader goes to another node and the page component stays mounted
    // (SvelteKit reuses it). `form` is left as is: the reset effect, not the
    // action data, is what must clear the draft.
    const OTHER = { ...NODE, id: 'leaf-2', loc: 'bar', name: 'Bar' };
    stored = OTHER;
    const url = 'http://localhost/app/memories/mem-A/nodes/leaf-2';
    setStubPage(url, { id: 'mem-A', nodeId: 'leaf-2' });
    const otherParent = { ...PARENT, graphNodes: [...PARENT.graphNodes, { id: 'leaf-2', memoryId: 'mem-A', loc: 'bar', name: 'Bar', nodeType: 'info', tags: [] }] };
    props.data = { ...otherParent, ...((await load({
      params: { id: 'mem-A', nodeId: 'leaf-2' },
      locals: { token: 'tok' },
      url: new URL(url),
      parent: vi.fn().mockResolvedValue(otherParent),
    } as never)) as Record<string, unknown>) };
    await settle();

    m.target.querySelector<HTMLElement>('button[aria-label="Actions for Bar"]')!.click();
    flushSync();
    Array.from(m.target.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((b) => b.textContent?.trim() === 'Run')!.click();
    flushSync();
    await settle();
    expect(field(m.target, '#testFlowPayload')!.value, 'node A\'s refused payload must not follow the reader to node B').toBe('');
    expect((field(m.target, '#testFlowApp') as HTMLSelectElement).value).toBe('');
  });

  it('updateFlow: the refused flow draft is still what the form will submit', async () => {
    setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
    serve();
    const rows = JSON.stringify([{ field: 'kept', shape: 'string', description: 'refused draft' }]);
    const actionData = await refusedAction('updateFlow', { _kind: 'updateFlow', extractionRows: rows, outputWriteTo: '', outputMode: 'replace' });
    expect((actionData as { form?: { message?: { type?: string } } }).form?.message?.type).toBe('error');
    const { m } = await mountHydrated(actionData);
    Array.from(m.target.querySelectorAll('button')).find((b) => /^Flow/.test(b.textContent?.trim() ?? ''))!.click();
    flushSync();
    await settle();
    expect(field(m.target, 'input[name="extractionRows"]')!.value).toBe(rows);
  });
});
