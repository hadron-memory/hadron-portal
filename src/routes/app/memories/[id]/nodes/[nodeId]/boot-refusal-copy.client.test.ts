/**
 * portal#1903: the page words each typed boot-prompt refusal itself. The action tests pin the codes the server
 * route answers with; this pins what a reader sees for each, on both text editors. Mounts the REAL node page and
 * answers the save request with the failure the route returns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: 'sum',
  tokens: null, tags: [], seq: null, data: null, properties: null,
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
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  resetStubPage();
  document.body.innerHTML = '';
});

async function mountPage(tab: 'content' | 'abstract') {
  const href = `http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${tab}`;
  setStubPage(href, { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
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
  if (!m.target.isConnected) document.body.appendChild(m.target);
  await tick();
  flushSync();
  return m;
}

const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

/**
 * What the route answers with: `fail(400, { <field>Failed: { code, detail: null } })`. The client lane aliases
 * `$app/forms` to a stub whose `deserialize` is `JSON.parse`, so `data` is the plain object, not kit's devalue string.
 */
const refusal = (field: string, code: string) => ({
  type: 'failure',
  status: 400,
  data: { [`${field}Failed`]: { code, detail: null } },
});

async function saveRefusedWith(target: HTMLElement, field: 'content' | 'abstract', code: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: async () => JSON.stringify(refusal(field, code)) }));
  buttonNamed(target, 'Source')!.click();
  flushSync();
  const area = target.querySelector<HTMLTextAreaElement>('textarea')!;
  area.value = `${field} edited`;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  buttonNamed(target, 'Save')!.click();
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
  // Other live regions on the page can be present and empty: the save error is the alert that has text.
  return Array.from(target.querySelectorAll('[role="alert"]')).map((e) => e.textContent?.trim()).find(Boolean);
}

const COPY = [
  ['compiled-prompt', 'A compiled boot prompt is never edited directly. Edit the boot source and compile again. Nothing was saved.'],
  ['boot-prompt-worker-session-refused', 'A worker session cannot edit a boot prompt; its manager does that. Nothing was saved.'],
] as const;

describe('portal#1903 a typed boot-prompt refusal on a text save shows its own fixed copy', () => {
  for (const field of ['content', 'abstract'] as const) {
    for (const [code, copy] of COPY) {
      it(`${field}: ${code}`, async () => {
        const { target } = await mountPage(field);
        const shown = await saveRefusedWith(target, field, code);
        expect(shown).toBe(copy);
        // The code is the page's own key, never the words a reader sees.
        expect(shown).not.toContain(code);
      });
    }
  }
  it('a code the page does not know falls to the generic copy, so the two above are not a catch-all', async () => {
    const { target } = await mountPage('content');
    const shown = await saveRefusedWith(target, 'content', 'something-else');
    expect(shown).toBe('Your edit could not be saved.');
  });
});
