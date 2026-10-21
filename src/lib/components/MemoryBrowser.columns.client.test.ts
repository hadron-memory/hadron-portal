/**
 * portal#1174 — the Nodes tab reads Role, Last changed, Changed by, Revision,
 * Approved and Signed lazily through /api/nodes/columns, in batches of the
 * server's cap, after the list is on screen; and the scope filter next to the
 * Node Types dropdown now says what it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import MemoryBrowser from './MemoryBrowser.svelte';

const mk = (i: number) => ({ id: `n${i}`, memoryId: 'mem-1', loc: `l${i}`, name: `Node ${i}`, nodeType: 'info', tags: [], seq: null, isRunnable: false, description: null });
const NODES = Array.from({ length: 3 }, (_, i) => mk(i));

const mounted: Array<Mounted<Record<string, unknown>>> = [];
let fetchMock: ReturnType<typeof vi.fn>;
let columnBodies: Array<{ refs: string[] }>;
beforeEach(() => {
  columnBodies = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/nodes/columns') {
      const body = JSON.parse(init!.body as string) as { refs: string[] };
      columnBodies.push(body);
      return new Response(JSON.stringify({
        rows: body.refs.map((id) => ({
          id, role: 'spec', updatedAt: '2026-10-20T10:00:00Z', revision: 7, approval: 'APPROVED', signature: 'CURRENT',
          agent: null, worker: { id: 'w1', name: 'Gil', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:gil' },
        })),
        unavailable: [], omitted: [],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ nodes: [], total: 0 }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

function mountBrowser(nodes = NODES) {
  const props = reactiveProps<Record<string, unknown>>({ nodes, basePath: '/app/memories/mem-1', forcedView: 'nodes', refreshKey: 0 });
  const m = mountComponent(MemoryBrowser as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return { ...m, props };
}
async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

describe('Nodes tab extra columns (#1174)', () => {
  it('reads the columns of the listed nodes in one batch and shows them', async () => {
    const { target } = mountBrowser();
    await settle();
    expect(columnBodies).toHaveLength(1);
    expect(columnBodies[0].refs).toEqual(['n0', 'n1', 'n2']);
    for (const h of ['Role', 'Last changed', 'Changed by', 'Revision', 'Approved', 'Signed']) expect(target.textContent).toContain(h);
    expect(target.textContent).toContain('spec');
    expect(target.textContent).toContain('Gil');
  });

  it('splits a large list at the server cap of 200', async () => {
    const many = Array.from({ length: 450 }, (_, i) => mk(i));
    mountBrowser(many);
    await vi.waitFor(() => expect(columnBodies).toHaveLength(3));
    expect(columnBodies.map((b) => b.refs.length)).toEqual([200, 200, 50]);
  });

  it('asks again only for nodes it has not asked about', async () => {
    const { props } = mountBrowser();
    await settle();
    props.nodes = [...NODES, mk(3)];
    await settle();
    expect(columnBodies.map((b) => b.refs)).toEqual([['n0', 'n1', 'n2'], ['n3']]);
  });

  it('says which scope the Content / Comments control is, beside the Node Types dropdown', async () => {
    const { target } = mountBrowser();
    await settle();
    const select = target.querySelector<HTMLSelectElement>('[data-testid="scope-filter"]')!;
    const label = target.querySelector<HTMLLabelElement>('label[for="' + select.id + '"]');
    expect(select.id).not.toBe('');
    expect(label?.textContent?.trim()).toBe('Show');
  });
});
