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


type Opts = { nodeType: string; role?: string | null; graph?: Record<string, unknown>; revisions?: unknown[] };
async function mountPage(tab: string, o: Opts) {
  const NODE = { ...NODE_BASE, nodeType: o.nodeType, role: o.role ?? null };
  const href = `http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${tab}`;
  setStubPage(href, { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY || doc === NODE_DATA_READ_QUERY || doc === NODE_PROPERTIES_READ_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_PAGE_QUERY) { const items = o.revisions ?? []; return { nodeRevisionsPage: { items, total: items.length, hasMore: false } }; }
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  const parent = { ...PARENT, graph: { ...PARENT.graph, ...(o.graph ?? {}) } };
  const data = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(href),
    parent: vi.fn().mockResolvedValue(parent),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...parent, ...data }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  if (!m.target.isConnected) document.body.appendChild(m.target);
  await tick();
  flushSync();
  return m;
}
const text = (e: Element) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const named = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll<HTMLElement>('button, a, [role="menuitem"]')).filter((b) => text(b) === label);
const enabled = (els: HTMLElement[]) => els.filter((b) => !(b as HTMLButtonElement).disabled && b.getAttribute('aria-disabled') !== 'true');
async function openMenu(target: HTMLElement) {
  const trigger = target.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]');
  expect(trigger).not.toBeNull();
  trigger!.click(); flushSync(); await tick();
}
const COMPILED: Opts = { nodeType: 'compiled-boot-prompt', role: 'boot-prompt' };
const SOURCE: Opts = { nodeType: 'info', role: 'boot-prompt' };
const ORDINARY: Opts = { nodeType: 'info' };
const cases: Array<[string, Opts, boolean]> = [['compiled', COMPILED, false], ['boot source', SOURCE, true], ['ordinary', ORDINARY, true]];

describe('portal#1901: a compiled-boot-prompt node offers no write controls; sources and ordinary nodes keep them', () => {
  for (const [name, o, keeps] of cases) {
    it(`${name}: the actions menu ${keeps ? 'keeps' : 'drops'} Edit, Move, Delete and Convert to task`, async () => {
      const { target } = await mountPage('content', o);
      await openMenu(target);
      for (const label of ['Edit', 'Move', 'Delete', 'Convert to task']) {
        expect(enabled(named(target, label)).length > 0, `${name}: ${label}`).toBe(keeps);
      }
      // reads and non-writes stay for everyone
      for (const label of ['Download', 'Duplicate']) expect(named(target, label).length, `${name}: ${label}`).toBeGreaterThan(0);
    });
    it(`${name}: the Settings tab ${keeps ? 'keeps' : 'drops'} the metadata Edit and Delete node`, async () => {
      const { target } = await mountPage('settings', o);
      expect(enabled(named(target, 'Edit')).length > 0, 'Edit').toBe(keeps);
      expect(enabled(named(target, 'Delete node')).length > 0, 'Delete node').toBe(keeps);
    });
    for (const tab of ['data', 'properties'] as const) {
      it(`${name}: the ${tab} editor ${keeps ? 'is writable' : 'is read-only'}`, async () => {
        const { target } = await mountPage(tab, o);
        const toggle = named(target, 'Source')[0];
        if (toggle) { toggle.click(); flushSync(); await tick(); }
        const area = target.querySelector<HTMLTextAreaElement>(`#panel-${tab} textarea`);
        if (area) {
          area.value = tab === 'data' ? '{"a":1}' : '{"a":1}'; area.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
          expect(area.readOnly, 'readonly').toBe(!keeps);
        } else expect(keeps, 'editor present').toBe(false);
        const save = named(target, 'Save')[0] as HTMLButtonElement | undefined;
        if (save) expect(save.disabled, 'save disabled').toBe(!keeps);
      });
    }
    it(`${name}: the Edges tab ${keeps ? 'keeps' : 'drops'} the edge editor`, async () => {
      const { target } = await mountPage('references', o);
      const edit = enabled(Array.from(target.querySelectorAll<HTMLElement>('button')).filter((b) => /edit edges/i.test(text(b))));
      expect(edit.length > 0).toBe(keeps);
    });
    it(`${name}: the Properties storage form is ${keeps ? 'enabled' : 'disabled'}`, async () => {
      const { target } = await mountPage('properties', o);
      const fs = target.querySelector<HTMLFieldSetElement>('#panel-properties fieldset, fieldset');
      const disabledFieldsets = Array.from(target.querySelectorAll<HTMLFieldSetElement>('fieldset')).filter((f) => f.disabled);
      expect(disabledFieldsets.length > 0, 'a disabled fieldset').toBe(!keeps);
      void fs;
    });
    it(`${name}: the Flow tab is ${keeps ? 'enabled' : 'disabled'}`, async () => {
      const { target } = await mountPage('flow', o);
      const disabledFieldsets = Array.from(target.querySelectorAll<HTMLFieldSetElement>('fieldset')).filter((f) => f.disabled);
      expect(disabledFieldsets.length > 0, 'a disabled fieldset').toBe(!keeps);
    });
  }
});

const REVS = [3, 2].map((n) => ({ id: `r${n}`, revNo: n, nodeId: 'leaf-pk', loc: 'foo', name: 'Foo', alias: null, description: null, tags: [], editedBy: null, revLabel: null, changedFields: [], createdAt: '2026-10-01T00:00:00Z' }));
describe('portal#1901: what a compiled node keeps', () => {
  it('keeps clear-history and delete-revision (deleting history is not writing compiled text) but drops restore', async () => {
    const { target } = await mountPage('history', { ...COMPILED, revisions: REVS });
    await tick(); flushSync();
    const clear = named(target, 'Clear');
    expect(enabled(clear).length, 'Clear history').toBe(1);
    const trigger = target.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"][aria-label*="evision"], #panel-history button[aria-haspopup="menu"]');
    expect(trigger, 'revision row menu').not.toBeNull();
    trigger!.click(); flushSync(); await tick();
    expect(enabled(named(target, 'Delete')).length, 'delete revision').toBe(1);
    expect(enabled(named(target, 'Restore')).length, 'restore').toBe(0);
  });
  it('keeps restore on a source node (positive control)', async () => {
    const { target } = await mountPage('history', { ...SOURCE, revisions: REVS });
    await tick(); flushSync();
    const trigger = target.querySelector<HTMLButtonElement>('#panel-history button[aria-haspopup="menu"]');
    trigger!.click(); flushSync(); await tick();
    expect(enabled(named(target, 'Restore')).length).toBe(1);
    expect(enabled(named(target, 'Delete')).length).toBe(1);
  });
  it('keeps Duplicate and Download in the actions menu', async () => {
    const { target } = await mountPage('content', { ...COMPILED });
    await openMenu(target);
    expect(enabled(named(target, 'Duplicate')).length).toBe(1);
    expect(enabled(named(target, 'Download')).length).toBe(1);
  });
});
