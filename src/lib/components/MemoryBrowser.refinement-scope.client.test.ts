/**
 * portal#1058 V74 (hrn:node:hadronmemory.com:hadron-dev-team-shared:decisions:2026-11-11-vera-rulings-portal-search-guidance):
 * the browser's Node Types and Tags refinements don't apply to comment hits.
 * Under Comments they are disabled; under All they filter only the content
 * rows. A comment node has no tags and the type `comment`, so applying them
 * to it silently emptied the comment results.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import MemoryBrowser from './MemoryBrowser.svelte';

const base = { memoryId: 'mem-1', seq: null, isRunnable: false, description: null, outgoingEdges: [], incomingEdges: [] };
const ALPHA = { ...base, id: 'n1', loc: 'alpha', name: 'Alpha', nodeType: 'info', tags: ['keep'] };
const BETA = { ...base, id: 'n2', loc: 'beta', name: 'Beta', nodeType: 'procedure', tags: [] };
const COMMENT_HIT = {
  ...base, id: 'c1', loc: 'comments:c1', name: 'Needs a source', nodeType: 'comment', tags: [],
  memory: { id: 'mem-1', urn: 'hrn:mem:o:m', name: 'm' },
  comment: {
    id: 'c1', isTopLevel: true, state: 'OPEN', anchorRevision: 1, deleted: false,
    author: { kind: 'USER', user: { id: 'u1', name: 'Ann', handle: 'ann', urn: null }, worker: null, agent: null, app: null },
    target: { id: 'n1', name: 'Alpha', nodeType: 'info', revSeq: 1, urn: 'hrn:node:o:m:alpha' },
  },
};

const mounted: Array<Mounted<Record<string, unknown>>> = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const scope = JSON.parse(init.body as string).filter?.contentScope;
    const nodes = scope === 'COMMENTS' ? [COMMENT_HIT] : scope === 'ALL' ? [ALPHA, BETA, COMMENT_HIT] : [ALPHA, BETA];
    return new Response(JSON.stringify({ nodes, total: nodes.length }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountBrowser() {
  const props = reactiveProps<Record<string, unknown>>({ nodes: [ALPHA, BETA], basePath: '/app/memories/mem-1', forcedView: 'nodes', refreshKey: 0 });
  const m = mountComponent(MemoryBrowser as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
}

async function settle() {
  await vi.advanceTimersByTimeAsync(400);
  await tick();
}

function pickScope(target: HTMLElement, value: string) {
  const select = target.querySelector<HTMLSelectElement>('[data-testid="scope-filter"]')!;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

function refinement(target: HTMLElement, label: 'Node Types' | 'Tags'): HTMLButtonElement {
  const button = [...target.querySelectorAll<HTMLButtonElement>('.filter-dropdown > button')]
    .find((b) => b.textContent?.trim().startsWith(label));
  expect(button, `${label} control`).toBeTruthy();
  return button!;
}

function choose(target: HTMLElement, label: 'Node Types' | 'Tags', option: string) {
  refinement(target, label).click();
  flushSync();
  const box = [...target.querySelectorAll<HTMLLabelElement>('.filter-dropdown label')]
    .find((l) => l.textContent?.trim() === option)!.querySelector<HTMLInputElement>('input')!;
  box.click();
  flushSync();
  refinement(target, label).click();
  flushSync();
}

const rowNames = (target: HTMLElement) =>
  [...target.querySelectorAll('tbody tr')].map((r) => r.querySelector('a')?.textContent?.trim() ?? r.textContent?.trim());
const commentRows = (target: HTMLElement) => target.querySelectorAll('[data-testid="comment-hit"]').length;

describe('V74: Node Types and Tags under each content scope (portal#1058)', () => {
  it('Content: both refinements are enabled and filter the rows', async () => {
    const target = mountBrowser();
    expect(refinement(target, 'Node Types').disabled).toBe(false);
    expect(refinement(target, 'Tags').disabled).toBe(false);
    choose(target, 'Tags', 'keep');
    await settle();
    expect(rowNames(target)).toContain('Alpha');
    expect(rowNames(target)).not.toContain('Beta');
  });

  it('Comments: both refinements are disabled', async () => {
    const target = mountBrowser();
    pickScope(target, 'COMMENTS');
    await settle();
    expect(refinement(target, 'Node Types').disabled).toBe(true);
    expect(refinement(target, 'Tags').disabled).toBe(true);
  });

  it.each([
    ['Tags', 'keep'],
    ['Node Types', 'info'],
  ] as const)('Comments: a %s choice made under Content does not empty the comment results', async (label, option) => {
    const target = mountBrowser();
    choose(target, label, option);
    pickScope(target, 'COMMENTS');
    await settle();
    expect(commentRows(target)).toBe(1);
  });

  it.each([
    ['Tags', 'keep', 'Alpha', 'Beta'],
    ['Node Types', 'procedure', 'Beta', 'Alpha'],
  ] as const)('All: %s filters the content rows only and keeps the comment hits', async (label, option, kept, dropped) => {
    const target = mountBrowser();
    pickScope(target, 'ALL');
    await settle();
    expect(refinement(target, label).disabled).toBe(false);
    choose(target, label, option);
    await settle();
    expect(rowNames(target)).toContain(kept);
    expect(rowNames(target)).not.toContain(dropped);
    expect(commentRows(target)).toBe(1);
  });

  it('Comments: a refinement menu left open is closed, so its choices cannot be changed', async () => {
    const target = mountBrowser();
    refinement(target, 'Tags').click();
    flushSync();
    expect(target.querySelectorAll('.filter-dropdown label input')).not.toHaveLength(0);
    pickScope(target, 'COMMENTS');
    await settle();
    expect(target.querySelectorAll('.filter-dropdown label input')).toHaveLength(0);
  });

  it('back to Content: the controls are enabled again and the kept choice applies', async () => {
    const target = mountBrowser();
    choose(target, 'Tags', 'keep');
    pickScope(target, 'COMMENTS');
    await settle();
    pickScope(target, 'CONTENT');
    await settle();
    expect(refinement(target, 'Tags').disabled).toBe(false);
    expect(rowNames(target)).toContain('Alpha');
    expect(rowNames(target)).not.toContain('Beta');
  });
});
