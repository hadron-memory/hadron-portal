/**
 * #995 — every form on the node page gets its own action result.
 *
 * Superforms derives a form's id from its schema's SHAPE, and a schema that is
 * only a defaulted `_kind` hashes the same whatever the literal. With
 * applyAction on, a result reaches the forms through the page store, and the
 * FIRST form with the posted id consumes it. Duplicate and Convert to task were
 * both `_kind`-only, so Convert to task's error landed in Duplicate's store
 * and never rendered (Charles's browser repro on #995). #993 fixed the same
 * thing for Verify.
 *
 * This mounts the REAL page with data from the REAL loader, and drives a
 * result the REAL action returned through superforms' own submit handling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY, MOVE_NODE_MUTATION } from '$lib/server/queries';
// Static imports: the page is large, and importing it inside a test spent the
// test's whole timeout under full-suite load. `vi.mock` below is hoisted above
// these, so the loader still sees the mocked client.
import Page from './+page.svelte';
import { actions, load } from './+page.server';

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

let warnSpy: { mockRestore: () => void } | undefined;
beforeEach(() => {
  mockRequest.mockReset();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  warnSpy?.mockRestore();
  vi.unstubAllGlobals();
});

function serveNode(node: typeof NODE | null) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
}

async function mountPage(node = NODE) {
  serveNode(node);
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  // #1320: the shared guard, on the real loader's result.
  expectDistinctFormIds(loaded, 4);
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  flushSync();
  return { ...m, props };
}

/** Run the real action against a node that has gone (Charles's repro), and return its failure. */
async function failingResult(action: 'convertToTask' | 'duplicate', kind: string) {
  serveNode(null);
  const fd = new FormData();
  fd.set('_kind', kind);
  const r = (await actions[action]({
    request: { formData: async () => fd },
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
  } as never)) as { status: number; data: Record<string, unknown> };
  return { type: 'failure' as const, status: r.status, data: r.data };
}

async function submitWith(target: HTMLElement, props: Record<string, unknown>, actionPath: string, result: Awaited<ReturnType<typeof failingResult>>) {
  const form = target.querySelector<HTMLFormElement>(`form[action="${actionPath}"]`);
  expect(form).not.toBeNull();
  await submitEnhancedWithResult(form!, result);
  props.form = result.data; // kit's applyAction also sets the page's `form` prop
  for (let i = 0; i < 5; i++) await tick();
  flushSync();
}

it('#1167 Settings dates match the memory Info format', async () => {
  // The UI deliberately formats local dates; create a local-calendar fixture.
  const localDate = new Date(2026, 9, 1, 12).toISOString();
  const {target} = await mountPage({...NODE, createdAt: localDate, updatedAt: localDate});
  const settings = [...target.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Settings');
  expect(settings).toBeDefined();
  settings!.click();
  flushSync();
  await tick();
  expect(target.textContent).toContain('Oct 1, 2026');
  expect(target.textContent).not.toContain('10/1/2026');
});

describe('node page form ids (#995)', () => {
  it("Convert to task's error renders, with Duplicate's form on the page", async () => {
    const { target, props } = await mountPage();
    expect(target.querySelector('form[action="?/duplicate"]')).not.toBeNull();
    const result = await failingResult('convertToTask', 'convertToTask');
    expect(result.status).toBe(404);
    await submitWith(target, props, '?/convertToTask', result);
    expect(target.textContent).toContain('Node not found');
  });

  it("Duplicate's error still renders", async () => {
    const { target, props } = await mountPage();
    const result = await failingResult('duplicate', 'duplicateNode');
    await submitWith(target, props, '?/duplicate', result);
    expect(target.textContent).toContain('Node not found');
  });
});

// #1902: Refresh changes only the draft; the existing updateMeta action moves on Save.
async function openMetaEditor(target: HTMLElement) {
  [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Settings')!.click();
  await tick(3);
  [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Edit')!.click();
  await tick(3);
}
async function typeMeta(target: HTMLElement, id: string, value: string) {
  const input = target.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await tick(3);
}
const refreshButton = (target: HTMLElement) => target.querySelector<HTMLButtonElement>('[data-testid="refresh-node-loc"]');
it('#1902 offers Refresh only after renaming and fills the draft without a write', async () => {
  const { target } = await mountPage(); await openMetaEditor(target);
  expect(refreshButton(target)).toBeNull();
  await typeMeta(target, 'editName', 'New Foo');
  expect(refreshButton(target)).not.toBeNull();
  expect(target.querySelector<HTMLInputElement>('#editLoc')!.value).toBe('foo');
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: [{ id: NODE.id, loc: 'foo' }], hasMore: false })));
  vi.stubGlobal('fetch', fetcher);
  refreshButton(target)!.click(); for (let i = 0; i < 12; i++) await tick();
  expect(target.querySelector<HTMLInputElement>('#editLoc')!.value).toBe('new-foo');
  expect(mockRequest.mock.calls.filter(([q]) => q === MOVE_NODE_MUTATION)).toEqual([]);
  expect(target.textContent).toContain('Old URNs of minted nodes keep working; others may stop working.');
  await typeMeta(target, 'editName', 'Foo'); expect(refreshButton(target)).toBeNull();
});
it('#1902 keeps the saved parent, skips sibling collisions, then Save uses the existing move', async () => {
  const saved = { ...NODE, loc: 'p:old', name: 'Old', memory: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a' } };
  const { target } = await mountPage(saved); await openMetaEditor(target);
  await typeMeta(target, 'editName', 'Foo');
  expect(refreshButton(target)).not.toBeNull();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: [{ id: saved.id, loc: saved.loc }, { id: 'sibling', loc: 'p:foo' }], hasMore: false }))));
  refreshButton(target)!.click(); for (let i = 0; i < 12; i++) await tick();
  expect(target.querySelector<HTMLInputElement>('#editLoc')!.value).toBe('p:foo-2');
  const form = target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;
  const fd = new FormData(form);
  await actions.updateMeta({ request: { formData: async () => fd }, params: { id: 'mem-A', nodeId: saved.id }, locals: { token: 'tok' } } as never);
  expect(mockRequest.mock.calls.filter(([q]) => q === MOVE_NODE_MUTATION).map(([, vars]) => vars))
    .toEqual([{ sourceRef: saved.id, targetUrn: 'hrn:node:acme.com:mem-a:p:foo-2' }]);
});
it('#1902 warns only for a changed location, including a manually edited one', async () => {
  const { target } = await mountPage(); await openMetaEditor(target);
  expect(target.querySelector('[data-testid="node-loc-move-warning"]')).toBeNull();
  await typeMeta(target, 'editLoc', 'another');
  expect(target.querySelector('[data-testid="node-loc-move-warning"]')).not.toBeNull();
  await typeMeta(target, 'editLoc', 'foo');
  expect(target.querySelector('[data-testid="node-loc-move-warning"]')).toBeNull();
});
