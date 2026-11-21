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
import { navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
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
  resetNavigationCalls();
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

  it('a reopened popup cannot save a revision whose earlier write is still in flight', async () => {
    const pending: Array<(r: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((res) => { pending.push(res); }));
    vi.stubGlobal('fetch', fetchMock);
    const { target } = await mountPage();
    const save = () => target.querySelector<HTMLButtonElement>('[data-testid="revision-label-save"]')!;
    await openLabelDialog(target);
    typeInto(input(target)!, 'first');
    await click(save()); // write A, left pending
    await click(target.querySelector('[data-testid="revision-label-cancel"]'));
    await click(target.querySelector('button[aria-label="Revision actions"]'));
    await click(byText(target, '[role="menuitem"]', 'Edit label'));
    typeInto(input(target)!, 'second');

    expect(save().disabled).toBe(true); // same revision, write in flight
    input(target)!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second write can overtake the first

    pending[0](new Response(JSON.stringify({ error: 'late' }), { status: 403 })); // A settles
    await settle();
    expect(target.textContent).not.toContain('late');
    expect(save().disabled).toBe(false);
    expect(input(target)?.value).toBe('second');

    await click(save()); // now B may go, after A
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body)).revLabel).toBe('second');
  });

  it('closing the popup does not clear another History action\'s busy state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))); // a restore that never settles
    const { target } = await mountPage();
    await click(target.querySelector('button[aria-label="Revision actions"]'));
    await click(byText(target, '[role="menuitem"]', 'Restore'));
    const confirm = () => byText(target, 'h3', 'Restore this revision?')?.parentElement?.querySelector<HTMLButtonElement>('button.bg-amber-500');
    await click(confirm());
    expect(confirm()?.disabled).toBe(true); // the restore is in flight
    await click(target.querySelector('button[aria-label="Revision actions"]'));
    await click(byText(target, '[role="menuitem"]', 'Edit label'));
    await click(target.querySelector('[data-testid="revision-label-cancel"]'));
    expect(input(target)).toBeNull();
    expect(confirm()?.disabled).toBe(true); // closing the label popup did not clear its busy flag
  });

  it('the popup is already closed while the refresh is still pending, so it cannot be submitted again', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    let release!: () => void;
    navigationHooks.onInvalidateAll = () => new Promise<void>((res) => { release = res; });
    const { target } = await mountPage();
    await openLabelDialog(target);
    typeInto(input(target)!, 'once');
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    await settle();
    expect(input(target)).toBeNull(); // closed on the stored write, refresh still pending
    release();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('after a save and refresh, focus is on the edited row\'s action button, not the body (#2402)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const { target } = await mountPage();
    document.body.appendChild(target);
    await openLabelDialog(target);
    // The refresh replaced the rows: the trigger focus went back to is gone.
    navigationHooks.onInvalidateAll = () => { (document.activeElement as HTMLElement | null)?.blur(); };
    typeInto(input(target)!, 'renamed');
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    await settle();
    expect(input(target)).toBeNull();
    expect(document.activeElement?.getAttribute('data-revision-id')).toBe('rev-A');
  });

  it('a stored label is a success even when the refresh that follows fails', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    navigationHooks.onInvalidateAll = () => { throw new Error('refresh failed'); };
    const { target } = await mountPage();
    await openLabelDialog(target);
    typeInto(input(target)!, 'kept');
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry of a write that already happened
    expect(input(target)).toBeNull(); // closed, not stuck on an error
    expect(target.textContent).toContain('Label saved, but the list could not refresh');
    expect(target.textContent).not.toContain('refresh failed');
  });

  it('keyboard: Tab and Shift+Tab cycle inside the popup', async () => {
    const { target } = await mountPage();
    document.body.appendChild(target);
    await click(target.querySelector('button[aria-label="Revision actions"]'));
    await click(byText(target, '[role="menuitem"]', 'Edit label'));
    await settle();
    const dialog = target.querySelector('[role="dialog"]')!;
    const key = (k: string, shiftKey = false) => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })); };
    const save = target.querySelector<HTMLButtonElement>('[data-testid="revision-label-save"]')!;
    save.focus();
    key('Tab');
    expect(dialog.contains(document.activeElement)).toBe(true); // wraps, never reaches the page
    input(target)!.focus();
    key('Tab', true);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('keyboard: focus moves into the popup, Escape closes it, focus returns to the row button', async () => {
    const { target } = await mountPage();
    document.body.appendChild(target);
    const trigger = target.querySelector<HTMLButtonElement>('button[aria-label="Revision actions"]')!;
    await click(trigger);
    await click(byText(target, '[role="menuitem"]', 'Edit label'));
    await settle();
    expect(document.activeElement).toBe(input(target));

    input(target)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(input(target)).toBeNull();
    expect(document.activeElement).toBe(trigger);
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

  it('a save posts the revision id and the typed label, and closes the popup', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { target } = await mountPage();
    await openLabelDialog(target);
    typeInto(input(target)!, 'new label');
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    await settle();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/app/memories/mem-A/nodes/A/revisions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'label', revisionId: 'rev-A', revLabel: 'new label' });
    expect(input(target)).toBeNull();
  });

  it('emptying the field through the UI posts a blank label (the endpoint clears it)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { target } = await mountPage();
    await openLabelDialog(target);
    expect(input(target)!.value).toBe('old');
    typeInto(input(target)!, '');
    await click(target.querySelector('[data-testid="revision-label-save"]'));
    await settle();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ action: 'label', revisionId: 'rev-A', revLabel: '' });
  });
});
