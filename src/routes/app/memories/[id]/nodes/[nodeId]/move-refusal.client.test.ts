/**
 * #1989 — Save's move refusal must survive the reload that follows it.
 *
 * Settings → Edit → a new loc → Save runs updateMeta: the metadata update
 * commits, then the move is refused (here NODE_ALREADY_EXISTS, the occupied
 * destination a tombstone also causes). The action answers 409 with
 * `metaSaved`, and the page reloads so it shows what was saved. In SvelteKit 2
 * that reload drops the action's `form` (`_invalidate` rebuilds props without
 * it), so superForm rebinds from the fresh loader form: the typed loc went back
 * to the node's old one and the refusal disappeared. The user saw the editor
 * "return to its old loc without a visible refusal" (Cooper's QA on #1977).
 *
 * This mounts the REAL page with data from the REAL loader, builds the failure
 * with the REAL action, and models the reload as kit does it: fresh loader
 * data through the page store, the action `form` gone.
 *
 * ## Await the reload, not a count of ticks
 *
 * The reload is async (the loader runs, then the page store and props change,
 * then superForm reseeds), so a test must wait for it to FINISH before it
 * reads the draft. `reloaded()` resolves once the fresh loader data is in;
 * `settle()` then lets the page's continuation and superForm's reseed run.
 * An earlier version only counted ticks, read the draft before the reseed,
 * and so passed whether or not the typed loc survived (Gizelle's LOCAL F1 on
 * #2002). Awaited, the draft assertion discriminates: it fails when the page
 * does not await the reload (portal#1882's fix), and the alert assertions fail
 * when the page does not hold the refusal (#1989's).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { nodeMetaBaseline } from '$lib/node-meta-seed';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { actionResultOf, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { MOVE_NODE_MUTATION, NODE_BY_ID_QUERY, NODE_DATA_READ_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY, UPDATE_NODE_MUTATION } from '$lib/server/queries';
import Page from './+page.svelte';
import { actions, load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: 'sum',
  tokens: null, tags: [], seq: null, data: null, properties: null,
  objectType: null, ownerRepo: null, role: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
  memory: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a' },
};
const PARENT = {
  canWriteMemory: true,
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'org', isEncrypted: false, schema: null },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};
const HREF = 'http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=settings';
const OCCUPIED = Object.assign(new Error('occupied'), {
  response: { errors: [{ message: 'A node already occupies loc taken', extensions: { code: 'NODE_ALREADY_EXISTS' } }] },
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
/** Resolves when the most recent reload has put the fresh loader data in place. */
let reloaded: () => Promise<void> = async () => {};
/** Kit hands the page store's action data to the page as its `form` prop; the stub's applyAction sets only the store. */
let mirrorKitForm: () => void = () => {};
/** Restored in afterEach: a spy left installed would hide a real warning in every later test file's run order (portal#2005 F8). */
let warnSpy: MockInstance<typeof console.warn>;
beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY || doc === NODE_DATA_READ_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    if (doc === MOVE_NODE_MUTATION) throw OCCUPIED;
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
  resetNavigationCalls();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  warnSpy.mockRestore();
  while (mounted.length) mounted.pop()!.unmount();
  delete navigationHooks.onInvalidateAll;
  vi.unstubAllGlobals();
  resetStubPage();
  document.body.innerHTML = '';
});

async function loaderData() {
  const data = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(HREF),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  return { ...PARENT, ...data };
}

async function mountSettings() {
  setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
  const data = await loaderData();
  page.update((p) => ({ ...p, data }));
  const props = reactiveProps<Record<string, unknown>>({ data, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mirrorKitForm = () => {
    props.form = (get(page) as { form?: unknown }).form ?? null;
  };
  mounted.push(m);
  if (!m.target.isConnected) document.body.appendChild(m.target);
  await tick();
  flushSync();
  // The reload, as kit runs it: fresh loader data, and no action `form`.
  // One promise per mount, resolved by the first reload and never replaced: each test saves once, and since
  // portal#1882 awaits the reload inside onResult, the submit can settle after the reload has finished.
  let done!: () => void;
  const reload = new Promise<void>((r) => (done = r));
  reloaded = () => reload;
  navigationHooks.onInvalidateAll = async () => {
    const fresh = await loaderData();
    page.update((p) => ({ ...p, data: fresh, form: null }));
    props.data = fresh;
    props.form = null;
    done();
  };
  return m;
}

/** The real action's answer to a Save that renames the node and moves it to `loc`. */
async function realRefusal(loc: string) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ _kind: 'updateMeta', name: 'Foo renamed', nodeType: 'info', description: '', alias: '', seq: '', tags: '', loc, baseline: nodeMetaBaseline(NODE) })) fd.set(k, v);
  const r = (await (actions as Record<string, (e: never) => Promise<unknown>>).updateMeta({
    request: { formData: async () => fd },
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
  } as never)) as { status: number; data: Record<string, unknown> };
  return r;
}

/** The metadata form's own alert, found by role, not by a test id main never had. */
const metaAlert = (target: HTMLElement) =>
  target.querySelector('form[action="?/updateMeta"] > [role="alert"]');

const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

/**
 * portal#2005 (Glen's delta F2): wait for the reload, but fail with a message that says so if the page
 * never reloads, instead of hanging into the vitest timeout.
 */
async function reloadRan(ms = 2000): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  const never = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the page did not reload within ${ms}ms (invalidateAll never delivered fresh data)`)), ms);
  });
  try {
    await Promise.race([reloaded(), never]);
  } finally {
    clearTimeout(timer!);
  }
}

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

describe('a refused move after a committed Save stays visible (#1989)', () => {
  it('the action says the edits saved, nothing moved, and where the node still is', async () => {
    const r = await realRefusal('taken');
    expect(r.status).toBe(409);
    expect(r.data.metaSaved).toBe(true);
    const errors = (r.data.form as { errors: { loc?: string[] } }).errors;
    expect(errors.loc?.[0]).toBe(
      'Saved, but the node was not moved: A node already occupies loc taken. It is still at hrn:node:acme.com:mem-a:foo.',
    );
  });

  it('keeps the refusal and the typed loc across the reload that reseeds the form', async () => {
    const m = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    const locInput = () => m.target.querySelector<HTMLInputElement>('#editLoc');
    locInput()!.value = 'taken';
    locInput()!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    const r = await realRefusal('taken');
    await submitEnhancedWithResult(m.target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!, {
      type: 'failure', status: r.status, data: r.data,
    });
    await reloadRan();
    await settle();

    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true); // the reload ran
    // The reseed would put the old loc back; the awaited reload keeps the typed one.
    expect(locInput()?.value).toBe('taken');
    const alert = metaAlert(m.target);
    expect(alert?.textContent).toContain('Saved, but the node was not moved');
    expect(alert?.textContent).toContain('It is still at hrn:node:acme.com:mem-a:foo.');
    expect(m.target.querySelector('[data-testid="node-loc-move-warning"]')).not.toBe(null);
    // No follow-up write: the page issued no second move on its own.
    expect(mockRequest.mock.calls.filter(([q]) => q === MOVE_NODE_MUTATION)).toHaveLength(1);
  });

  it('a saved-but-failed result still reloads when it carries no refusal the page can keep (BLIND P2)', async () => {
    const m = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    const r = await realRefusal('taken');
    const form = { ...(r.data.form as Record<string, unknown>), errors: {}, message: undefined };
    await submitEnhancedWithResult(m.target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!, {
      type: 'failure', status: r.status, data: { ...r.data, form },
    });
    await settle();
    // The metadata committed, so the page must show what was saved even without a refusal to hold.
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
  });

  it.each([
    ['an occupied destination (409, a loc error)', null],
    ['any other move failure (500, the form message)', new Error('boom')],
  ])('Cancel clears the refusal superforms applied too, so reopening Edit shows none: %s (Clark QA F1 on #2002)', async (_label, moveError) => {
    if (moveError) {
      const base = mockRequest.getMockImplementation()!;
      mockRequest.mockImplementation(async (doc: string, ...rest: unknown[]) => {
        if (doc === MOVE_NODE_MUTATION) throw moveError;
        return base(doc, ...rest);
      });
    }
    const m = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    const r = await realRefusal('taken');
    await submitEnhancedWithResult(m.target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!, {
      type: 'failure', status: r.status, data: r.data,
    });
    await reloadRan();
    await settle();
    // As in a browser: superforms applies the failure after the awaited reload, and kit passes it to the page.
    mirrorKitForm();
    await settle();
    expect(metaAlert(m.target)?.textContent).toContain('Saved, but the node was not moved');
    expect(r.status).toBe(moveError ? 500 : 409);
    buttonNamed(m.target, 'Cancel')!.click();
    flushSync();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    await settle();
    expect(metaAlert(m.target)).toBe(null);
  });

  it('Cancel clears the kept refusal', async () => {
    const m = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    const r = await realRefusal('taken');
    await submitEnhancedWithResult(m.target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!, {
      type: 'failure', status: r.status, data: r.data,
    });
    await settle();
    expect(metaAlert(m.target)).not.toBe(null);
    buttonNamed(m.target, 'Cancel')!.click();
    flushSync();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    expect(metaAlert(m.target)).toBe(null);
  });

  it('Retry that succeeds leaves no stale refusal (Glen BLIND ask, #2002)', async () => {
    const m = await mountSettings();
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    const r = await realRefusal('taken');
    // The first Save DID commit the rename (only its move failed), so the reload after it reads the saved
    // name and the retry is typed against that node (portal#2023): without the baseline refresh the retry
    // would be refused as a conflict with a change nobody else made.
    const SAVED = { ...NODE, name: 'Foo renamed' };
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY || doc === NODE_DATA_READ_QUERY) return { node: SAVED };
      if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
      if (doc === MOVE_NODE_MUTATION) throw OCCUPIED;
      return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
    });
    const form = m.target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;
    await submitEnhancedWithResult(form, { type: 'failure', status: r.status, data: r.data });
    await settle();
    expect(metaAlert(m.target)).not.toBe(null);
    // Retry: the second Save commits (no move this time), so the editor closes and the refusal must not outlive it.
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === UPDATE_NODE_MUTATION) return { updateNode: { ...NODE, name: 'Foo renamed' } };
      if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY || doc === NODE_DATA_READ_QUERY) return { node: SAVED };
      if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
      return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
    });
    const fd = new FormData(form);
    const ok = (await (actions as Record<string, (e: never) => Promise<unknown>>).updateMeta({
      request: { formData: async () => fd },
      params: { id: 'mem-A', nodeId: 'leaf-pk' },
      locals: { token: 'tok' },
    } as never)) as Record<string, unknown>;
    const okResult = actionResultOf(ok);
    expect(okResult.type).toBe('success');
    await submitEnhancedWithResult(form, okResult);
    await settle();
    expect(metaAlert(m.target)).toBe(null);
    buttonNamed(m.target, 'Edit')!.click();
    flushSync();
    expect(metaAlert(m.target)).toBe(null);
  });
});
