/**
 * portal#1882 — a Settings save whose location move fails (an occupied
 * destination, a memory that does not exist) SAVES the other edits and answers
 * `metaSaved: true`; the page reloads the node so it shows what was saved. That
 * reload must not wipe the failure: the reader is told the node was not moved,
 * and the location they typed stays in the field to fix.
 *
 * Mounts the REAL page with data from the REAL loader and the REAL action's
 * answer (as `role-refusals.client.test.ts` does), and models what kit does on
 * `invalidateAll`: the load re-runs a network round trip later, the page store's
 * `form` becomes null while the `form` prop is kept (kit client.js:
 * "Reset `form` on navigation, but not invalidation" → `page.form = form ?? null`),
 * and `page.data` carries the loader's fresh superforms. Superforms rebinds from
 * that fresh form, which is what erased the error on main.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import {
  MOVE_NODE_MUTATION,
  NODE_BY_ID_QUERY,
  NODE_DATA_READ_QUERY,
  NODE_PROPERTIES_READ_QUERY,
  NODE_QUERY,
  NODE_REVISIONS_QUERY,
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
const PARENT = {
  canWriteMemory: true,
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false, schema: null },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};
const HREF = 'http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=settings';

const gqlError = (code: string, message: string) =>
  new ClientError({ status: 200, headers: new Headers(), body: '', errors: [new GraphQLError(message, { extensions: { code } })] }, { query: 'mutation fixture' });

// What the server holds: the name edit is saved, the loc is not.
let stored = NODE;
function serve() {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY || doc === NODE_DATA_READ_QUERY || doc === NODE_PROPERTIES_READ_QUERY) return { node: stored };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
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
beforeEach(() => {
  mockRequest.mockReset();
  stored = NODE;
  resetNavigationCalls();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  while (unsubs.length) unsubs.pop()!();
  vi.unstubAllGlobals();
  resetNavigationCalls();
  resetStubPage();
  document.body.innerHTML = '';
});

async function mountSettings() {
  setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
  serve();
  const data = await runLoad();
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...data }, form: null });
  // Kit's applyAction sets BOTH the page store's form and the `form` prop.
  unsubs.push(page.subscribe((p) => { if (p.form) props.form = p.form; }));
  // Kit's invalidateAll, a round trip later: re-run the load; page.form → null
  // (the prop is kept); page.data carries the loader's fresh superforms.
  navigationHooks.onInvalidateAll = async () => {
    await new Promise((r) => setTimeout(r, 0));
    const fresh = { ...PARENT, ...(await runLoad()) };
    props.data = fresh;
    page.update((p) => ({ ...p, form: null, data: fresh }));
  };
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  if (!m.target.isConnected) document.body.appendChild(m.target);
  await tick();
  flushSync();
  return m.target;
}

const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

function type(target: HTMLElement, selector: string, value: string) {
  const input = target.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  return input;
}

async function saveWithFailingMove(target: HTMLElement, loc: string, moveError: unknown) {
  buttonNamed(target, 'Edit')!.click();
  flushSync();
  type(target, '#editName', 'Renamed');
  type(target, '#editLoc', loc);
  const form = target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;
  // The real action: the metadata update succeeds, then the move throws.
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY) return { node: stored };
    if (doc === MOVE_NODE_MUTATION) {
      serve(); // later reads (the reload) see what the server now holds
      throw moveError;
    }
    stored = { ...NODE, name: 'Renamed' };
    return { updateNode: stored };
  });
  const r = (await actions.updateMeta({
    request: { formData: async () => new FormData(form) },
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
  } as never)) as { status: number; data: Record<string, unknown> };
  expect(r.data.metaSaved).toBe(true);
  await submitEnhancedWithResult(form, { type: 'failure', status: r.status, data: r.data });
  for (let i = 0; i < 10; i++) await tick();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
  return r;
}

describe('#1882: a failed location move in Settings says so', () => {
  it('an occupied destination (409) keeps the error and the typed location after the reload', async () => {
    const target = await mountSettings();
    const r = await saveWithFailingMove(target, 'renamed', gqlError('NODE_ALREADY_EXISTS', 'A node already exists at that location.'));
    expect(r.status).toBe(409);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    const alert = target.querySelector('form[action="?/updateMeta"] [role="alert"]');
    expect(alert?.textContent ?? '').toMatch(/^Saved, but the node was not moved: /);
    expect(target.querySelector<HTMLInputElement>('#editLoc')!.value).toBe('renamed');
    expect(target.querySelector<HTMLInputElement>('#editName')!.value).toBe('Renamed');
    // The failure is the page's action data again once it is applied after the reload.
    expect(get(page).form).not.toBeNull();
  });

  it('a move that fails for another reason (500) also keeps its error after the reload', async () => {
    const target = await mountSettings();
    const r = await saveWithFailingMove(target, 'hrn:node:acme.com:no-such-memory:foo', gqlError('NOT_FOUND', 'Memory not found.'));
    expect(r.status).toBe(500);
    const alert = target.querySelector('form[action="?/updateMeta"] [role="alert"]');
    expect(alert?.textContent ?? '').toMatch(/^Saved, but the node was not moved: /);
    expect(target.querySelector<HTMLInputElement>('#editLoc')!.value).toBe('hrn:node:acme.com:no-such-memory:foo');
  });

  it('the reload still runs, so the page shows the saved name', async () => {
    const target = await mountSettings();
    await saveWithFailingMove(target, 'renamed', gqlError('NODE_ALREADY_EXISTS', 'taken'));
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(target.querySelector('h1')?.textContent).toContain('Renamed');
  });
});
