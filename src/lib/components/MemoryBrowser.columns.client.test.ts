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

  it('reads only the displayed page of a large list, never the whole memory', async () => {
    const many = Array.from({ length: 450 }, (_, i) => mk(i));
    mountBrowser(many);
    await settle();
    expect(columnBodies).toHaveLength(1);
    expect(columnBodies[0].refs).toHaveLength(25);
    expect(columnBodies[0].refs[0]).toBe('n0');
    expect(columnBodies.flatMap((b) => b.refs)).not.toContain('n300');
  });

  it('asks for the next page only when the reader pages to it', async () => {
    const many = Array.from({ length: 60 }, (_, i) => mk(i));
    const { target } = mountBrowser(many);
    await settle();
    expect(columnBodies).toHaveLength(1);
    const next = [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => /next/i.test(b.textContent ?? ''))!;
    next.click();
    await settle();
    expect(columnBodies).toHaveLength(2);
    expect(columnBodies[1].refs[0]).toBe('n25');
    expect(columnBodies[1].refs).toHaveLength(25);
    // The page's columns landing must not bounce the reader back to page 1 (Gemma on #1181).
    await vi.waitFor(() => expect(target.textContent).toContain('spec'));
    expect(target.textContent).toContain('Node 25');
    expect(target.textContent).not.toContain('Node 0');
  });

  it('never claims a whole-memory sort over columns that only the page has: they are not sortable', async () => {
    const { target } = mountBrowser();
    await settle();
    const headers = [...target.querySelectorAll<HTMLElement>('thead th')];
    for (const name of ['Role', 'Last changed', 'Changed by', 'Revision', 'Approved', 'Signed']) {
      const th = headers.find((h) => h.textContent?.includes(name));
      expect(th, name).toBeDefined();
      expect(th!.className).not.toContain('cursor-pointer');
    }
  });

  it('asks again only for rows it has not asked about', async () => {
    const { props } = mountBrowser();
    await settle();
    props.nodes = [...NODES, mk(3)];
    await settle();
    expect(columnBodies.map((b) => b.refs)).toEqual([['n0', 'n1', 'n2'], ['n3']]);
  });

  it('reads the visible page again when the memory refreshes (approval or mint changed), not from the old cache', async () => {
    const { props } = mountBrowser();
    await settle();
    expect(columnBodies).toHaveLength(1);
    props.refreshKey = 1;
    await settle();
    expect(columnBodies).toHaveLength(2);
    expect(columnBodies[1].refs).toEqual(['n0', 'n1', 'n2']);
  });

  it('says which scope the Content / Comments control is, beside the Node Types dropdown', async () => {
    const { target } = mountBrowser();
    await settle();
    const select = target.querySelector<HTMLSelectElement>('[data-testid="scope-filter"]')!;
    const label = select.closest('label');
    expect(label).not.toBeNull();
    // an aria-label would override the visible 'Show' label for assistive tech (WCAG 2.5.3)
    expect(select.hasAttribute('aria-label')).toBe(false);
    expect(label?.querySelector('span')?.textContent?.trim()).toBe('Show');
  });
});
