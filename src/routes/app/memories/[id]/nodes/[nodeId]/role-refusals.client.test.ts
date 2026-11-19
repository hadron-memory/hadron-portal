import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load, actions } from './+page.server';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { NODE_DATA_READ_QUERY, NODE_PROPERTIES_READ_QUERY } from '$lib/server/queries';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
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

async function mountPage(tab: 'content' | 'abstract' | 'data' | 'properties' | 'settings') {
  const href = `http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${tab}`;
  setStubPage(href, { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY || doc === NODE_DATA_READ_QUERY || doc === NODE_PROPERTIES_READ_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
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

const reply = (body: unknown) =>
  vi.fn().mockResolvedValue({ text: async () => JSON.stringify(body) });

const codes = [
  { code: 'ROLE_NOT_DECLARED', role: 'review.special', strictParent: 'review' },
  { code: 'ROLE_WRITER_LEVEL_REQUIRED', role: 'review', ruleRole: 'task', level: 'ADMIN', side: 'before' },
  { code: 'ROLE_WRITERS_UNSUPPORTED', role: 'review', ruleRole: 'task', level: 'OWNER' },
  { code: 'ROLE_GOVERNED', kind: 'task', op: 'update', door: 'updateTaskNode', mcpDoor: null },
];
const copy = [/declared sub-role/, /Changing or clearing/, /no one can write/, /update a runnable node/];
for (const field of ['content', 'abstract', 'data', 'properties'] as const) {
  it.each(codes)(`${field} retains edits and retries %j`, async extensions => {
    const { target } = await mountPage(field);
    buttonNamed(target, 'Source')!.click(); flushSync();
    const area = target.querySelector<HTMLTextAreaElement>(field === 'abstract' ? 'textarea[maxlength="2000"]' : 'textarea')!;
    const draft = field === 'data' || field === 'properties' ? '{"draft":"kept"}' : 'kept draft';
    area.value = draft; area.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    const fetchImpl = vi.fn(async (_url: unknown, opts: RequestInit) => {
      const fd = opts.body as FormData;
      mockRequest.mockImplementation(async (doc: string) => {
        if ([NODE_BY_ID_QUERY, NODE_QUERY, NODE_DATA_READ_QUERY, NODE_PROPERTIES_READ_QUERY].includes(doc)) return { node: NODE };
        throw new ClientError({ status: 200, headers: new Headers(), body: '', errors: [new GraphQLError('Server governed reason.', { extensions })] }, { query: 'mutation fixture' });
      });
      const name = `update${field[0].toUpperCase()}${field.slice(1)}`;
      const r = await (actions as unknown as Record<string, (event: never) => Promise<{status: number; data: unknown}>>)[name]({ request: { formData: async () => fd }, params: { id: 'mem-A', nodeId: 'leaf-pk' }, locals: { token: 'tok' } } as never);
      return { text: async () => JSON.stringify({ type: 'failure', status: r.status, data: r.data }) };
    });
    vi.stubGlobal('fetch', fetchImpl);
    buttonNamed(target, 'Save')!.click();
    await vi.waitFor(() => { flushSync(); expect(buttonNamed(target, 'Retry')).toBeDefined(); });
    expect(area.value).toBe(draft);
    expect(target.textContent).toMatch(copy[codes.indexOf(extensions)]);
    const retry = buttonNamed(target, 'Retry'); expect(retry).toBeDefined(); expect(retry!.disabled).toBe(false);
    retry!.click(); await vi.waitFor(() => { flushSync(); expect(fetchImpl).toHaveBeenCalledTimes(2); expect(buttonNamed(target, 'Retry')?.disabled).toBe(false); });
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(area.value).toBe(draft);
  });
}
it.each(codes)('metadata retains edits and retry for %j', async extensions => {
  const { target, props } = await mountPage('settings');
  buttonNamed(target, 'Edit')!.click(); flushSync();
  const input=target.querySelector<HTMLInputElement>('#editName')!;
  input.value='Kept metadata'; input.dispatchEvent(new Event('input',{bubbles:true})); flushSync();
  const form=target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY) return { node: NODE };
    throw new ClientError({ status: 200, headers: new Headers(), body: '', errors: [new GraphQLError('Server governed reason.', { extensions })] }, { query: 'mutation fixture' });
  });
  const r=await actions.updateMeta({ request: { formData: async()=>new FormData(form) },params:{id:'mem-A',nodeId:'leaf-pk'},locals:{token:'tok'} } as never) as {status:number;data:Record<string,unknown>};
  await submitEnhancedWithResult(form,{type:'failure',status:r.status,data:r.data}); props.form=r.data;
  for(let i=0;i<6;i++) await tick(); flushSync();
  expect(input.isConnected).toBe(true); expect(input.value).toBe('Kept metadata');
  expect(target.textContent).toMatch(copy[codes.indexOf(extensions)]);
  expect(buttonNamed(target,'Retry')?.disabled).toBe(false);
});
