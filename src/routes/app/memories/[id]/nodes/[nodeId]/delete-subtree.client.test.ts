/**
 * #621 — the delete confirm dialog turns a NODE_HAS_DESCENDANTS refusal into
 * an explicit subtree choice. Before any refusal the dialog offers no
 * recursive option (a leaf delete never needs one); after the server refuses,
 * the count arrives on the action result and the dialog gains the "also delete
 * descendants" checkbox the refusal message points at.
 *
 * Mounts the REAL page with data from the REAL loader, and drives a result the
 * REAL action returned through superforms' own submit handling (the #995
 * harness).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { DELETE_NODE_MUTATION, NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
// Static imports: the page is large, and importing it inside a test spent the
// test's whole timeout under full-suite load. `vi.mock` below is hoisted above
// these, so the loader still sees the mocked client.
import Page from './+page.svelte';
import { actions, load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'parent-pk', memoryId: 'mem-A', loc: 'findings', name: 'Findings', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
};
const PARENT = {
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false },
  graphNodes: [{ id: 'parent-pk', memoryId: 'mem-A', loc: 'findings', name: 'Findings', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/parent-pk', { id: 'mem-A', nodeId: 'parent-pk' });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

/** Serve a healthy page; the delete mutation refuses with the given count. */
function serveRefusal(count: number) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    if (doc === DELETE_NODE_MUTATION) {
      return Promise.reject({
        name: 'ClientError',
        response: { errors: [{ message: `Node "parent-pk" has ${count} descendant(s). Pass recursive: true to delete the whole subtree.`, extensions: { code: 'NODE_HAS_DESCENDANTS', count } }] },
      });
    }
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
}

async function mountPage() {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'parent-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/parent-pk'),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  flushSync();
  return { ...m, props };
}

/** Open the ⋯ menu, pick Delete, and return the now-open confirm popover. */
function openDeleteConfirm(target: HTMLElement) {
  target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Findings"]')!.click();
  flushSync();
  const item = [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((b) => b.textContent?.trim() === 'Delete')!;
  item.click();
  flushSync();
  const form = target.querySelector<HTMLFormElement>('form[action="?/delete"]');
  expect(form).not.toBeNull();
  return form!;
}

/** Run the real delete action against the refusing server, as a failure result. */
async function refusalResult(count: number) {
  serveRefusal(count);
  const fd = new FormData();
  fd.set('_kind', 'deleteNode');
  const r = (await actions.delete({
    request: { formData: async () => fd },
    params: { id: 'mem-A', nodeId: 'parent-pk' },
    locals: { token: 'tok' },
  } as never)) as { status: number; data: Record<string, unknown> };
  return { type: 'failure' as const, status: r.status, data: r.data };
}

async function submitWith(target: HTMLElement, props: Record<string, unknown>, actionPath: string, result: Awaited<ReturnType<typeof refusalResult>>) {
  const form = target.querySelector<HTMLFormElement>(`form[action="${actionPath}"]`);
  expect(form).not.toBeNull();
  await submitEnhancedWithResult(form!, result);
  props.form = result.data; // kit's applyAction also sets the page's `form` prop
  for (let i = 0; i < 5; i++) await tick();
  flushSync();
}

describe('delete confirm dialog (#621)', () => {
  it('offers no subtree option before the server has refused', async () => {
    const { target } = await mountPage();
    const form = openDeleteConfirm(target);
    expect(form.querySelector('input[name="recursive"]')).toBeNull();
  });

  it('after a NODE_HAS_DESCENDANTS refusal, shows the count and the subtree checkbox', async () => {
    const { target, props } = await mountPage();
    openDeleteConfirm(target);
    const result = await refusalResult(3);
    expect(result.status).toBe(409);
    await submitWith(target, props, '?/delete', result);
    // The actionable message renders…
    const alert = target.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('3 descendant');
    expect(alert?.textContent).toContain('Also delete');
    // …and the checkbox it points at exists, labelled with the server's count.
    const box = target.querySelector<HTMLInputElement>('form[action="?/delete"] input[name="recursive"]');
    expect(box).not.toBeNull();
    expect(box?.closest('label')?.textContent).toContain('3 descendant');
  });
});
