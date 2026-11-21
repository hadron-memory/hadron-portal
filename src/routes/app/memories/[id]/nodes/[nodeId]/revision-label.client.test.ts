/**
 * #534 — the Edit label popup on the REAL node page (the #995 harness pattern).
 * The route component is reused across nodes and a save outlives its popup, so
 * both are pinned here: a popup opened on node A must not survive onto node B,
 * and a late save for A must neither close nor wipe a popup opened afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';
import { SELF_MEMORY_ACCESS_QUERY } from '$lib/server/comments';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const node = (id: string) => ({
  id, memoryId: 'mem-A', loc: id, name: `Node ${id}`, revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [], asComment: null,
  memory: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', appId: null },
});
const rev = (id: string, label: string | null) => ({
  id, revNo: 1, loc: 'x', name: 'x', alias: null, description: null, tags: [],
  editedBy: null, editedByInfo: null, editedByUser: null, editedByWorker: null, editedByAgent: null,
  revLabel: label, changes: [], createdAt: '2026-10-01T00:00:00Z',
});
const PARENT = {
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'knowledge', isEncrypted: false },
  graphNodes: [],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};

let served = node('A');
beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: served };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [rev(`rev-${served.id}`, 'old')], total: 1, hasMore: false } };
    if (doc === SELF_MEMORY_ACCESS_QUERY) return { effectiveAccess: { canWrite: true, canManage: false } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}
async function loaded(id: string) {
  served = node(id);
  setStubPage(`http://localhost/app/memories/mem-A/nodes/${id}`, { id: 'mem-A', nodeId: id });
  return {
    ...PARENT,
    ...((await load({
      params: { id: 'mem-A', nodeId: id },
      locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
      url: new URL(`http://localhost/app/memories/mem-A/nodes/${id}?tab=history`),
      parent: vi.fn().mockResolvedValue(PARENT),
    } as never)) as Record<string, unknown>),
  };
}
async function mountPage() {
  const props = reactiveProps<Record<string, unknown>>({ data: await loaded('A'), form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return { target: m.target, props };
}
const click = async (el: Element | null | undefined) => { (el as HTMLElement).click(); await settle(); };
const byText = (t: HTMLElement, sel: string, text: string) =>
  [...t.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.trim() === text);
const input = (t: HTMLElement) => t.querySelector<HTMLInputElement>('[data-testid="revision-label-input"]');

async function openLabelDialog(target: HTMLElement) {
  await click(target.querySelector('button[aria-label="Revision actions"]'));
  await click(byText(target, '[role="menuitem"]', 'Edit label'));
  expect(input(target)).not.toBeNull();
}
function typeInto(el: HTMLInputElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('#534 — Edit label popup on the real node page', () => {
  it('does not survive a move to another node (Save would post A\'s revisionId to B)', async () => {
    const { target, props } = await mountPage();
    await openLabelDialog(target);

    props.data = await loaded('B');
    await settle();

    expect(input(target)).toBeNull();
  });

  it('a save for a cancelled popup neither closes nor wipes the popup opened after it', async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { finish = res; })));
    const { target } = await mountPage();
    await openLabelDialog(target);

    typeInto(input(target)!, 'first');
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    await click(target.querySelector('[data-testid="revision-label-cancel"]'));
    expect(input(target)).toBeNull();

    await click(target.querySelector('button[aria-label="Revision actions"]'));
    await click(byText(target, '[role="menuitem"]', 'Edit label'));
    typeInto(input(target)!, 'second draft');

    finish(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await settle();

    expect(input(target)?.value).toBe('second draft');
  });

  it('a cancelled save\'s late refusal does not render in the popup opened after it', async () => {
    let fail!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { fail = res; })));
    const { target } = await mountPage();
    await openLabelDialog(target);
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    await click(target.querySelector('[data-testid="revision-label-cancel"]'));
    await click(target.querySelector('button[aria-label="Revision actions"]'));
    await click(byText(target, '[role="menuitem"]', 'Edit label'));
    typeInto(input(target)!, 'new draft');

    fail(new Response(JSON.stringify({ error: 'old refusal' }), { status: 403 }));
    await settle();

    expect(target.textContent).not.toContain('old refusal');
    expect(input(target)?.value).toBe('new draft');
    expect(target.querySelector<HTMLButtonElement>('[data-testid="revision-label-save"]')!.disabled).toBe(false);
  });

  it('a late refusal from node A does not render on node B\'s popup', async () => {
    let fail!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { fail = res; })));
    const { target, props } = await mountPage();
    await openLabelDialog(target);
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    props.data = await loaded('B');
    await settle();
    await openLabelDialog(target);

    fail(new Response(JSON.stringify({ error: 'node A refusal' }), { status: 403 }));
    await settle();

    expect(target.textContent).not.toContain('node A refusal');
  });

  it('a stale save finishing while the newer popup\'s save is in flight leaves that save busy', async () => {
    const pending: Array<(r: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { pending.push(res); })));
    const { target } = await mountPage();
    const save = () => target.querySelector<HTMLButtonElement>('[data-testid="revision-label-save"]')!;
    await openLabelDialog(target);
    await click(save()); // save A, left pending
    await click(target.querySelector('[data-testid="revision-label-cancel"]'));
    await click(target.querySelector('button[aria-label="Revision actions"]'));
    await click(byText(target, '[role="menuitem"]', 'Edit label'));
    typeInto(input(target)!, 'second');
    await click(save()); // save B, also pending
    expect(save().disabled).toBe(true);

    pending[0](new Response(JSON.stringify({ error: 'late' }), { status: 403 })); // A settles first
    await settle();

    expect(save().disabled).toBe(true); // B is still saving: no second submit
    expect(target.textContent).not.toContain('late');
  });

  it('a refusal for the CURRENT popup still shows and keeps the draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not allowed' }), { status: 403 })));
    const { target } = await mountPage();
    await openLabelDialog(target);
    typeInto(input(target)!, 'keep me');
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    expect(target.textContent).toContain('not allowed');
    expect(input(target)?.value).toBe('keep me');
  });

  it('control: a normal save closes the popup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const { target } = await mountPage();
    await openLabelDialog(target);
    typeInto(input(target)!, 'new label');
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    await settle();
    expect(input(target)).toBeNull();
  });
});
