import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { buildGraphViewData } from '$lib/graph-utils';
import MemoryBrowser from './MemoryBrowser.svelte';
vi.mock('$app/stores', async () => {
  const {readable} = await import('svelte/store');
  return {page: readable({url: new URL('http://localhost/app/memories/mem-1'), params: {}, data: {}})};
});
vi.mock('$app/navigation', () => ({invalidateAll: vi.fn(), goto: vi.fn(), replaceState: vi.fn()}));
vi.mock('$app/environment', () => ({browser: false, dev: false}));
vi.mock('$app/forms', () => ({enhance: () => ({destroy() {}})}));
const nodes = [
  {id: 'root', loc: 'root', name: 'Root'},
  {id: 'child', loc: 'root:child', name: 'Child'},
  {id: 'other', loc: 'root:other', name: 'Other'},
].map(n => ({...n, memoryId: 'mem-1', nodeType: 'info', tags: [], description: '', incomingEdges: [], outgoingEdges: n.id === 'child' ? [{id: 'link', loc: 'link', name: 'References', target: {id: 'other', name: 'Other'}}] : []}));

describe('small memory graph (#1165)', () => {
  it('renders a definite graph frame with a usable minimum height', () => {
    const {body} = render(MemoryBrowser, {props: {nodes, basePath: '/app/memories/mem-1', forcedView: 'graph'} as never});
    expect(body).toMatch(/data-testid="graph-canvas-frame"[^>]*style="[^"]*min-height: 400px/);
    expect(body).toMatch(/data-testid="graph-canvas-frame"[^>]*style="[^"]*height: calc\(100dvh - 320px\)/);
    expect(body).toContain('Dashed lines show hierarchy; arrows show stored links.');
  });
  it('keeps labels, implicit hierarchy and stored links in the graph model', () => {
    const data = buildGraphViewData(nodes as never, 'hrn:mem:acme:docs');
    expect(data.topics.map(n => n.name)).toEqual(['Root', 'Child', 'Other']);
    expect(data.hierEdges).toEqual([{from: 'root', to: 'child'}, {from: 'root', to: 'other'}]);
    expect(data.topics[1].nodes).toMatchObject([{loc: 'other', rel: 'References'}]);
  });
  it('omits unreadable or missing relationship targets', () => {
    const data = buildGraphViewData([{...nodes[0], outgoingEdges: [{id: 'hidden', loc: 'hidden', target: null}]}] as never, 'hrn:mem:acme:docs');
    expect(data.topics[0].nodes).toEqual([]);
  });
});
