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

// portal#1930 (F3/F4 from #1928's blind review; Uma's UX decision 6787706001).
describe('#1930: refinement menus and the disabled-control reason', () => {
  const HINT = 'Node Types and Tags filter content, not comments. Your selections are kept for Content.';
  const menuOpen = (target: HTMLElement) => target.querySelectorAll('.filter-dropdown label input').length > 0;
  const hint = (target: HTMLElement) => target.querySelector<HTMLElement>('#refinement-off-hint');
  const scopeSelect = (target: HTMLElement) => target.querySelector<HTMLSelectElement>('[data-testid="scope-filter"]')!;

  it.each([
    ['Node Types', 'CONTENT'],
    ['Node Types', 'ALL'],
    ['Tags', 'CONTENT'],
    ['Tags', 'ALL'],
  ] as const)('a %s menu open when Comments is picked stays closed on return to %s', async (label, back) => {
    const target = mountBrowser();
    refinement(target, label).click();
    flushSync();
    expect(menuOpen(target)).toBe(true);
    pickScope(target, 'COMMENTS');
    await settle();
    expect(menuOpen(target)).toBe(false);
    pickScope(target, back);
    await settle();
    expect(menuOpen(target)).toBe(false);
  });

  it('selections and badge counts survive Comments and back to Content', async () => {
    const target = mountBrowser();
    choose(target, 'Tags', 'keep');
    choose(target, 'Node Types', 'info');
    pickScope(target, 'COMMENTS');
    await settle();
    expect(refinement(target, 'Tags').textContent).toMatch(/Tags\s*1/);
    expect(refinement(target, 'Node Types').textContent).toMatch(/Node Types\s*1/);
    pickScope(target, 'CONTENT');
    await settle();
    expect(refinement(target, 'Tags').textContent).toMatch(/Tags\s*1/);
    expect(refinement(target, 'Node Types').textContent).toMatch(/Node Types\s*1/);
    expect(rowNames(target)).toEqual(['Alpha']);
  });

  it('under Comments a visible hint describes both disabled controls and the Show select, with no title', async () => {
    const target = mountBrowser();
    pickScope(target, 'COMMENTS');
    await settle();
    const p = hint(target);
    expect(p).not.toBeNull();
    expect(p!.textContent?.trim()).toBe(HINT);
    for (const el of [refinement(target, 'Node Types'), refinement(target, 'Tags'), scopeSelect(target)]) {
      const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/);
      expect(ids).toContain('refinement-off-hint');
    }
    expect(refinement(target, 'Node Types').hasAttribute('title')).toBe(false);
    expect(refinement(target, 'Tags').hasAttribute('title')).toBe(false);
  });

  it.each(['CONTENT', 'ALL'])('under %s there is no hint and nothing points at one', async (scope) => {
    const target = mountBrowser();
    pickScope(target, scope);
    await settle();
    expect(hint(target)).toBeNull();
    expect(target.querySelector('[aria-describedby~="refinement-off-hint"]')).toBeNull();
  });

  it('under Comments with neither refinement control rendered, no hint is shown', async () => {
    const props = reactiveProps<Record<string, unknown>>({ nodes: [{ ...ALPHA, tags: [] }], basePath: '/app/memories/mem-1', forcedView: 'nodes', refreshKey: 0 });
    const m = mountComponent(MemoryBrowser as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    pickScope(m.target, 'COMMENTS');
    await settle();
    expect(hint(m.target)).toBeNull();
    expect(m.target.querySelector('[aria-describedby~="refinement-off-hint"]')).toBeNull();
  });

  it('picking Comments leaves focus on the Show select', async () => {
    const target = mountBrowser();
    scopeSelect(target).focus();
    pickScope(target, 'COMMENTS');
    await settle();
    expect(document.activeElement).toBe(scopeSelect(target));
  });
});
