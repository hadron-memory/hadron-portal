import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_DATA_READ_QUERY, NODE_PROPERTIES_READ_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load, actions } from './+page.server';
import { ClientError } from 'graphql-request';
import { COMPILED_BOOT_PROMPT_TYPE } from '$lib/compiled-boot-prompt';
import { GraphQLError } from 'graphql';
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
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: o.revisions ?? [] };
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
const COMPILED: Opts = { nodeType: COMPILED_BOOT_PROMPT_TYPE, role: 'boot-prompt' };
const SOURCE: Opts = { nodeType: 'info', role: 'boot-prompt' };
const ORDINARY: Opts = { nodeType: 'info' };
const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); await tick(); flushSync(); } };
const row = (name: string | null, urn: string | null, over: Record<string, unknown> = {}) => ({
  name, urn, omitted: false, depth: 0, revNo: 3, selection: { rev: null, approved: false, signed: false }, pruned: false, ...over,
});
const SRC_A = row('Persona source', 'hrn:node:acme.com:mem-a:boot:persona');
const calls: string[] = [];
function stubProvenance(responder: (url: string) => { ok: boolean; body: unknown }) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    calls.push(String(u));
    const r = responder(String(u));
    return { ok: r.ok, json: async () => r.body };
  }));
}
const pageOf = (items: unknown[], extra: Record<string, unknown> = {}) => ({ ok: true, body: { page: { items, total: items.length, hasMore: false, pruned: false, offset: 0, ...extra } } });
const SYSTEM_AGENT = { class: 'system', appId: null, agent: { id: 'ag-1', urn: 'hrn:agent:acme.com:helper', name: 'Helper' } };

describe('portal#1901: the compiled node page explains itself and lists its sources', () => {
  it('shows the note, the recompile guidance and the source list on a compiled node, and none of it on a source or ordinary node', async () => {
    stubProvenance(() => pageOf([SRC_A]));
    const compiled = await mountPage('content', { ...COMPILED });
    await settle();
    expect(compiled.target.querySelector('[data-testid="compiled-prompt-hint"]')?.textContent).toMatch(/generated from the sources/);
    expect(compiled.target.querySelector('[data-testid="compiled-prompt-sources"]')).not.toBeNull();
    expect(calls).toEqual(['/app/boot-prompt?node=leaf-pk&revision=4&offset=0']);
    expect(text(compiled.target)).toContain('Persona source');
    for (const o of [SOURCE, ORDINARY]) {
      calls.length = 0;
      const other = await mountPage('content', o);
      await settle();
      expect(other.target.querySelector('[data-testid="compiled-prompt-sources"]')).toBeNull();
      expect(other.target.querySelector('[data-testid="compiled-prompt-hint"]')).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  it('links a readable source to its node page and names an unreadable one only as unavailable', async () => {
    stubProvenance(() => pageOf([
      SRC_A,
      row(null, null, { omitted: true, revNo: 9, pruned: null }),
      row(null, null, { revNo: 8, pruned: null }),
    ]));
    const { target } = await mountPage('content', { ...COMPILED });
    await settle();
    const links = Array.from(target.querySelectorAll<HTMLAnchorElement>('[data-testid="compiled-prompt-sources"] a')).map((a) => a.getAttribute('href'));
    expect(links.filter((h) => h?.includes('hrn:node:acme.com:mem-a:boot:persona')).length).toBe(1);
    const region = text(target.querySelector('[data-testid="compiled-prompt-sources"]')!);
    // an omitted and an unavailable source read the same, and neither is named
    expect(region.match(/Not available to you/g)).toHaveLength(2);
    expect(region).not.toContain('name not loaded');
    // a hidden source leaks nothing: only the one readable URN appears anywhere in the region (the chip splits its text)
    expect(region.match(/acme\.com:mem-a:boot:persona/g)).toHaveLength(1);
    expect(region.match(/hrn:/g)).toHaveLength(1);
    expect(links.filter((h) => h?.includes('hrn:node:')).length).toBe(1);
  });

  it('portal#1901: shows each occurrence\'s kind and order, and the owner Agent\'s URN beside its name', async () => {
    stubProvenance(() => pageOf([row('Persona source', 'hrn:node:acme.com:mem-a:boot:persona', { kind: 'include', order: 2 })]));
    const { target } = await mountPage('content', { ...COMPILED, graph: SYSTEM_AGENT });
    await settle();
    expect(text(target.querySelector('[data-testid="compiled-prompt-sources"] table')!)).toMatch(/include, order 2/);
    expect(text(target.querySelector('[data-testid="compiled-prompt-recompile"]')!)).toMatch(/acme\.com:helper/);
  });

  it('repeats a source per occurrence, with no merging by name', async () => {
    stubProvenance(() => pageOf([SRC_A, row('Persona source', 'hrn:node:acme.com:mem-a:boot:persona', { depth: 1, revNo: 5 })]));
    const { target } = await mountPage('content', { ...COMPILED });
    await settle();
    expect(text(target).match(/Persona source/g)?.length).toBe(2);
  });

  it('does not drain pages: the next page is read only when asked', async () => {
    stubProvenance((u) => u.includes('offset=20')
      ? pageOf([row('Second page source', 'hrn:node:acme.com:mem-a:boot:two')], { total: 21, offset: 20 })
      : pageOf([SRC_A], { total: 21, hasMore: true }));
    const { target } = await mountPage('content', { ...COMPILED });
    await settle();
    expect(calls).toHaveLength(1);
    const next = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => text(b) === 'Next')!;
    expect(next.disabled).toBe(false);
    next.click(); await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('offset=20');
    expect(text(target)).toContain('Second page source');
  });

  it('says it could not load the sources, and names none, when the read fails', async () => {
    stubProvenance(() => ({ ok: false, body: { failed: true } }));
    const { target } = await mountPage('content', { ...COMPILED });
    await settle();
    const region = text(target.querySelector('[data-testid="compiled-prompt-sources"]')!);
    expect(region).toMatch(/Couldn.t load what this revision was built from/);
    expect(region).not.toMatch(/hrn:/);
  });

  it('word the recompile step by owner, and give an unresolved owner no link and no command', async () => {
    stubProvenance(() => pageOf([]));
    const agent = await mountPage('content', { ...COMPILED, graph: SYSTEM_AGENT });
    await settle();
    const a = agent.target.querySelector('[data-testid="compiled-prompt-recompile"]')!;
    expect(text(a)).toMatch(/boot prompt section on the page of Helper/);
    expect(a.querySelector('a')?.getAttribute('href')).toBe('/app/agents/ag-1');
    const install = await mountPage('content', { ...COMPILED, graph: { class: 'system', appId: 'app-9', agent: null } });
    await settle();
    const i = install.target.querySelector('[data-testid="compiled-prompt-recompile"]')!;
    expect(text(i)).toMatch(/install compile panel on the App.s page/);
    expect(i.querySelector('a')?.getAttribute('href')).toBe('/app/apps/app-9');
    const unresolved = await mountPage('content', { ...COMPILED });
    await settle();
    const u = unresolved.target.querySelector('[data-testid="compiled-prompt-recompile"]')!;
    expect(u.querySelector('a')).toBeNull();
    expect(text(u)).not.toMatch(/hadron /i);
    expect(text(u)).toMatch(/Agent or App it belongs to/);
  });
});
