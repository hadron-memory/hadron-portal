/**
 * #1446 — after a successful Content or Abstract save the editor closes, which
 * unmounts the focused Save button and used to leave focus on <body>. Focus now
 * lands on that section's Source toggle, the control that reopens the editor.
 * A conflict or an error keeps focus in the editor.
 *
 * Mounts the REAL node page with data from the REAL loader, as
 * `properties-tab.client.test.ts` does: the behaviour lives in the page's save
 * handlers and the lifetime of the controls they unmount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
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
  return m;
}

const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

const reply = (body: unknown) =>
  vi.fn().mockResolvedValue({ text: async () => JSON.stringify(body) });
const SUCCESS = { type: 'success', status: 200, data: '[]' };

async function editAndSave(target: HTMLElement, field: 'content' | 'abstract') {
  buttonNamed(target, 'Source')!.click();
  flushSync();
  // The page carries other textareas (composers); the editor is the one with the draft.
  const area = target.querySelector<HTMLTextAreaElement>(field === 'content' ? 'textarea[rows="6"], textarea' : 'textarea[maxlength="2000"]')!;
  area.value = `${field} edited`;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  const save = buttonNamed(target, 'Save')!;
  save.focus();
  expect(document.activeElement).toBe(save);
  save.click();
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
  return area;
}

describe('focus after a Source save (#1446)', () => {
  for (const field of ['content', 'abstract'] as const) {
    it(`${field}: a successful save puts focus on the Source toggle, not <body>`, async () => {
      const { target } = await mountPage(field);
      vi.stubGlobal('fetch', reply(SUCCESS));
      const area = await editAndSave(target, field);

      // The editor closed...
      expect(area.isConnected).toBe(false);
      // ...and focus is on the control that reopens it.
      const source = buttonNamed(target, 'Source')!;
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(source);
    });

    it(`${field}: a refused save keeps focus in the editor`, async () => {
      const { target } = await mountPage(field);
      vi.stubGlobal(
        'fetch',
        reply({ type: 'failure', status: 400, data: JSON.stringify([{ [`${field}Failed`]: 1 }, { code: 2, detail: 3 }, 'invalid', null]) }),
      );
      const area = await editAndSave(target, field);

      expect(area.isConnected).toBe(true);
      expect(document.activeElement).not.toBe(buttonNamed(target, 'Source'));
    });
  }
});
