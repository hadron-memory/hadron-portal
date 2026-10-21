/**
 * portal#1175 — the page of a comment node, on the REAL node page with data
 * from the REAL loader (the #995 harness pattern). A comment is feedback on
 * another node, so its page links back to that target, offers no node-authoring
 * surfaces, and hides editing from anyone but its author
 * (`Comment.viewerIsAuthor`; the server stays the authority).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const TARGET = { id: 'tgt-pk', name: 'Target node', nodeType: 'info', urn: 'hrn:node:acme.com:mem-a:target' };
const COMMENT = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'A comment', revision: 4,
  nodeType: 'comment', alias: null, description: null, content: 'the comment body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
  memory: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', appId: null },
  asComment: { id: 'c1', deleted: false, viewerIsAuthor: true, revSeq: 3, target: TARGET },
};
const PLAIN = { ...COMMENT, nodeType: 'info', name: 'A plain node', asComment: null };
const PARENT = {
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'knowledge', isEncrypted: false },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'A comment', nodeType: 'comment', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};

let served: Record<string, unknown> = COMMENT;
beforeEach(() => {
  served = COMMENT;
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: served };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

async function mountPage(node: Record<string, unknown>, search = '', canWriteMemory = true) {
  served = node;
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/memories/mem-A/nodes/leaf-pk${search}`),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded, canWriteMemory }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return m;
}

const tabLabels = (t: HTMLElement) =>
  // The button's own text, without its count / "Empty" badge span.
  [...t.querySelectorAll<HTMLButtonElement>('div.scroll-hint > button')].map(
    (b) => [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
  );
async function menuLabels(t: HTMLElement): Promise<string[]> {
  t.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
  await settle();
  return [...t.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent?.trim() ?? '');
}

describe('portal#1175 — the page of a comment node', () => {
  it('the breadcrumb links to the node the comment is for', async () => {
    const { target } = await mountPage(COMMENT);
    const link = [...target.querySelectorAll<HTMLAnchorElement>('nav a')].find((a) => a.textContent?.includes('Target node'));
    expect(link?.getAttribute('href')).toBe('/app/memories/mem-A/nodes/tgt-pk');
  });

  it('drops the "comments are never approved or minted" note', async () => {
    const { target } = await mountPage(COMMENT);
    expect(target.textContent).not.toContain('This node is a comment in a discussion');
    expect(target.querySelector('[data-testid="comment-node-note"]')).toBeNull();
  });

  it('offers Info first, then Content, and none of the node-authoring tabs', async () => {
    const { target } = await mountPage(COMMENT);
    const labels = tabLabels(target);
    expect(labels[0]).toBe('Info');
    expect(labels).toContain('Content');
    for (const gone of ['Abstract', 'Data', 'Properties', 'Flow', 'Edges', 'Settings', 'Revisions']) {
      expect(labels).not.toContain(gone);
    }
  });

  it('a deep link to a removed tab lands on Content', async () => {
    const { target } = await mountPage(COMMENT, '?tab=settings');
    expect(target.querySelector('.prose')?.textContent).toContain('the comment body');
  });

  it.each([false, true])('Info stays read-only with memory canWrite=%s: no edit, no danger zone', async (canWrite) => {
    const { target } = await mountPage(COMMENT, '', canWrite);
    [...target.querySelectorAll<HTMLButtonElement>('div.scroll-hint > button')].find((b) => b.textContent?.trim() === 'Info')?.click();
    await settle();
    expect(target.textContent).toContain('Type');
    expect(target.textContent).toContain('comment');
    expect(target.textContent).not.toContain('Danger zone');
    expect([...target.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Edit')).toBe(false);
    expect(target.querySelector('#editName')).toBeNull();
  });

  it('the actions menu loses Add child, Move, Duplicate and Convert to task', async () => {
    const { target } = await mountPage(COMMENT);
    const items = await menuLabels(target);
    for (const gone of ['Add child', 'Move', 'Duplicate', 'Convert to task']) expect(items).not.toContain(gone);
    expect(items).toContain('Delete');
  });

  it("the author keeps Edit, and it opens the content source rather than the removed Settings tab", async () => {
    const { target } = await mountPage(COMMENT);
    expect(await menuLabels(target)).toContain('Edit');
    [...target.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.trim() === 'Edit')!.click();
    await settle();
    expect(target.querySelector('textarea')).not.toBeNull();
    expect(target.querySelector('#editName')).toBeNull();
  });

  it("another user's comment offers no Edit and no Source editor", async () => {
    const { target } = await mountPage({ ...COMMENT, asComment: { ...COMMENT.asComment, viewerIsAuthor: false } });
    expect(await menuLabels(target)).not.toContain('Edit');
    expect([...target.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Source')).toBe(false);
  });

  it('a comment whose details were not returned is treated as not the viewer\'s', async () => {
    const { target } = await mountPage({ ...COMMENT, asComment: null });
    expect(await menuLabels(target)).not.toContain('Edit');
    expect([...target.querySelectorAll<HTMLAnchorElement>('nav a')].some((a) => a.textContent?.includes('Target node'))).toBe(false);
  });
});

describe('portal#1175 — an ordinary node is unchanged', () => {
  it('keeps its authoring tabs and menu', async () => {
    const { target } = await mountPage(PLAIN);
    const labels = tabLabels(target);
    for (const kept of ['Content', 'Abstract', 'Data', 'Properties', 'Flow', 'Edges', 'Settings']) expect(labels).toContain(kept);
    expect(labels).not.toContain('Info');
    const items = await menuLabels(target);
    for (const kept of ['Edit', 'Add child', 'Move', 'Duplicate', 'Convert to task']) expect(items).toContain(kept);
  });
});

describe('portal#1175 — saving a comment (Glen on #1180)', () => {
  it("the author's save posts the comment's own write counter, not the node revision", async () => {
    const posted: FormData[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      posted.push(init!.body as FormData);
      return new Response(JSON.stringify({ type: 'success', status: 200, data: '[{"contentSaved":1},true]' }), { status: 200 });
    }));
    const { target } = await mountPage(COMMENT);
    await menuLabels(target);
    [...target.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.trim() === 'Edit')!.click();
    await settle();
    const box = target.querySelector<HTMLTextAreaElement>('textarea')!;
    box.value = 'edited';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^save/i.test(b.textContent?.trim() ?? ''))!.click();
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0].get('content')).toBe('edited');
    // revSeq 3, while the node's own revision is 4
    expect(posted[0].get('expectedRevision')).toBe('3');
    vi.unstubAllGlobals();
  });

  const STUB = { ...COMMENT, content: null };
  it("a non-author never sees a 'Write content' call to action on a textless comment", async () => {
    for (const asComment of [{ ...COMMENT.asComment, viewerIsAuthor: false }, null, { ...COMMENT.asComment, deleted: true }]) {
      const { target, unmount } = await mountPage({ ...STUB, asComment });
      expect(target.textContent).not.toContain('Write content');
      unmount();
      mounted.pop();
    }
  });

  it('the author of a textless comment still can, and an ordinary empty node keeps its call to action', async () => {
    const own = await mountPage(STUB);
    expect(own.target.textContent).toContain('Write content');
    const plain = await mountPage({ ...PLAIN, content: null });
    expect(plain.target.textContent).toContain('Write content');
  });
});
