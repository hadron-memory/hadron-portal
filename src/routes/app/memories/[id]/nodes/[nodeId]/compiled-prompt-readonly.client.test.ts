import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load, actions } from './+page.server';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { NODE_DATA_READ_QUERY, NODE_PROPERTIES_READ_QUERY } from '$lib/server/queries';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE_BASE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: 'sum',
  tokens: null, tags: [], seq: null, data: {}, properties: {},
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

const mounted: Array<Mounted<Record<string, unknown>>> = [];
beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  resetStubPage();
  document.body.innerHTML = '';
});

async function mountPage(tab: 'content' | 'abstract', nodeType: string) {
  const NODE = { ...NODE_BASE, nodeType };
  const href = `http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${tab}`;
  setStubPage(href, { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY || doc === NODE_DATA_READ_QUERY || doc === NODE_PROPERTIES_READ_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const data = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(href),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...data }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  // The editors measure/focus against the document, so attach the mount point.
  if (!m.target.isConnected) document.body.appendChild(m.target);
  await tick();
  flushSync();
  return Object.assign(m, { props });
}


const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
// portal#1899: a compiled boot prompt's text and abstract are read-only with the source/recompile hint;
// an ordinary node keeps its editors.
for (const tab of ['content', 'abstract'] as const) {
  it(`${tab}: a compiled-boot-prompt is read-only with the recompile hint`, async () => {
    const { target } = await mountPage(tab, 'compiled-boot-prompt');
    expect(target.querySelector('[data-testid="compiled-prompt-hint"]')?.textContent).toMatch(/boot source and compile again/);
    buttonNamed(target, 'Source')?.click(); flushSync();
    const area = target.querySelector<HTMLTextAreaElement>(tab === 'abstract' ? 'textarea[maxlength="2000"]' : 'textarea');
    if (area) expect(area.readOnly).toBe(true);
    expect(buttonNamed(target, 'Save')?.disabled ?? true).toBe(true);
  });
  it(`${tab}: an ordinary node keeps its editor and no hint`, async () => {
    const { target } = await mountPage(tab, 'info');
    expect(target.querySelector('[data-testid="compiled-prompt-hint"]')).toBeNull();
    buttonNamed(target, 'Source')?.click(); flushSync();
    const area = target.querySelector<HTMLTextAreaElement>(tab === 'abstract' ? 'textarea[maxlength="2000"]' : 'textarea')!;
    expect(area.readOnly).toBe(false);
  });
}
