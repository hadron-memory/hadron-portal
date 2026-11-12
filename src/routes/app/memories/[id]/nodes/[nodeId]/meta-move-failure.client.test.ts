/**
 * portal#1882 — a Settings save whose location move fails (an occupied
 * destination, a memory that does not exist) SAVES the other edits and answers
 * `metaSaved: true`; the page reloads the node so it shows what was saved. That
 * reload must not wipe the failure: the reader is told the node was not moved,
 * and the location they typed stays in the field to fix.
 *
 * portal#1980 — that reload is BEST-EFFORT. When it rejects, the failure and
 * the typed location are still kept (an onResult throw would otherwise be
 * answered by superforms with a generic error result, trading the truthful
 * partial-save failure away).
 *
 * Mounts the REAL page with data from the REAL loader and the REAL action's
 * answer (as `role-refusals.client.test.ts` does), and models what kit does on
 * `invalidateAll`: the load re-runs a network round trip later, the page store's
 * `form` becomes null while the `form` prop is kept (kit client.js:
 * "Reset `form` on navigation, but not invalidation" → `page.form = form ?? null`),
 * and `page.data` carries the loader's fresh superforms. Superforms rebinds from
 * that fresh form, which is what erased the error on main.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { captureUnhandledRejections, mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { fakeFindNodesChildren } from '$lib/test/fakeFindNodesChildren';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { actionResultOf, submitEnhancedWithRawResult, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { COMMENT_THREADS_QUERY, NODE_COMMENT_SUMMARY_QUERY } from '$lib/server/comments';
import {
  MEMORIES_QUERY,
  MOVE_NODE_MUTATION,
  NODE_APPROVAL_QUERY,
  NODE_BY_ID_QUERY,
  NODE_CHILDREN_QUERY,
  NODE_DATA_READ_QUERY,
  NODE_EDGE_REMOVALS_QUERY,
  NODE_PROPERTIES_READ_QUERY,
  NODE_PROVENANCE_QUERY,
  NODE_QUERY,
  NODE_REVISIONS_PROVENANCE_QUERY,
  NODE_REVISIONS_QUERY,
  UPDATE_NODE_MUTATION,
} from '$lib/server/queries';
import Page from './+page.svelte';
import { actions, load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: 'sum',
  tokens: null, tags: [], seq: null, data: {}, properties: {},
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

const gqlError = (code: string, message: string) =>
  new ClientError({ status: 200, headers: new Headers(), body: '', errors: [new GraphQLError(message, { extensions: { code } })] }, { query: 'mutation fixture' });

// What the server holds: the name edit is saved, the loc is not.
let stored = NODE;
// Every document the mounted page and its loader actually send, answered with
// the shape its consumer reads. The node reads carry the stored node; the
// satellite reads carry the empty result their selection set promises (the
// provenance/approval/comment-summary consumers null-guard an absent node).
// Anything else THROWS: a mock that invents a plausible answer for a document
// it does not know can fake a successful mutation or hide a broken consumer
// behind a lying shape — exactly what the old catch-all did.
function serve() {
  // The children answer delegates to the shared fake (one source of truth for
  // the findNodes shape); everything else is explicit below.
  const serveChildren = fakeFindNodesChildren([], 'mem-A');
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    switch (doc) {
      case NODE_BY_ID_QUERY:
      case NODE_QUERY:
      case NODE_DATA_READ_QUERY:
      case NODE_PROPERTIES_READ_QUERY:
        return { node: stored };
      case NODE_REVISIONS_QUERY:
      case NODE_REVISIONS_PROVENANCE_QUERY:
        return { nodeRevisions: [] };
      case NODE_PROVENANCE_QUERY:
      case NODE_APPROVAL_QUERY:
      case NODE_COMMENT_SUMMARY_QUERY:
        return { node: null };
      case NODE_CHILDREN_QUERY:
        return serveChildren(vars);
      case COMMENT_THREADS_QUERY:
        return { commentThreads: { items: [], total: 0 } };
      case NODE_EDGE_REMOVALS_QUERY:
        return { nodeEdgeRemovals: [] };
      case MEMORIES_QUERY:
        return { memories: { items: [], total: 0 } };
      default:
        throw new Error(`serve(): unexpected document "${String(doc).match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? 'unnamed'}" — extend the explicit cases, never add a catch-all`);
    }
  });
}
const runLoad = async () =>
  (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(HREF),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;

const mounted: Array<Mounted<Record<string, unknown>>> = [];
const unsubs: Array<() => void> = [];
const consoleMsgs: Array<{ level: string; text: string }> = [];
beforeEach(() => {
  mockRequest.mockReset();
  stored = NODE;
  resetNavigationCalls();
  consoleMsgs.length = 0;
  // Recording, not silencing: an unexpected console message fails the test in
  // afterEach below, so a regression that starts logging (a broken consumer
  // reading a field off an undefined shape) cannot hide behind a quiet spy.
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { consoleMsgs.push({ level: 'error', text: a.map(String).join(' ') }); });
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { consoleMsgs.push({ level: 'warn', text: a.map(String).join(' ') }); });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(async () => {
  // Teardown continuations land on later microtasks/timers, and a crash in an
  // unawaited one surfaces only as an unhandled rejection — so the noise gate
  // below must assert AFTER a flush, and the whole teardown runs inside the
  // unhandled-rejection capture (the client-lane rules in CLAUDE.md).
  const rejections = await captureUnhandledRejections(async () => {
    while (mounted.length) mounted.pop()!.unmount();
    while (unsubs.length) unsubs.pop()!();
    for (let i = 0; i < 10; i++) await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 10; i++) await tick();
    flushSync();
  });
  expect(rejections, rejections.map(String).join(' | ')).toEqual([]);
  // The one allowed line is the capabilities probe, whose fetch cannot leave
  // the jsdom lane (no serverBaseUrl there); it fires at most once, cached
  // module-wide. Everything else — including messages a test EXPECTED — is
  // noise unless the test asserted and consumed it (see the #1980 test).
  const noise = consoleMsgs.filter((m) => !m.text.startsWith('[capabilities]'));
  expect(noise, noise.map((m) => `${m.level}: ${m.text}`).join(' | ')).toEqual([]);
  vi.unstubAllGlobals();
  resetNavigationCalls();
  resetStubPage();
  document.body.innerHTML = '';
});

async function mountSettings() {
  setStubPage(HREF, { id: 'mem-A', nodeId: 'leaf-pk' });
  serve();
  const data = await runLoad();
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...data }, form: null });
  // Kit's applyAction sets BOTH the page store's form and the `form` prop.
  unsubs.push(page.subscribe((p) => { if (p.form) props.form = p.form; }));
  // Kit's invalidateAll, a round trip later: re-run the load; page.form → null
  // (the prop is kept); page.data carries the loader's fresh superforms.
  navigationHooks.onInvalidateAll = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fresh = { ...PARENT, ...(await runLoad()) };
    props.data = fresh;
    page.update((p) => ({ ...p, form: null, data: fresh }));
  };
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  if (!m.target.isConnected) document.body.appendChild(m.target);
  await tick();
  flushSync();
  return m.target;
}

const buttonNamed = (target: HTMLElement, label: string) =>
  Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

function type(target: HTMLElement, selector: string, value: string) {
  const input = target.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  return input;
}

// Open the Settings editor and run the REAL updateMeta action on its form, with
// a test-chosen mock: `install` replaces mockRequest after the action's own
// node read, so each branch (move fails / update fails / success) answers its
// own documents truthfully.
async function runMetaSave(target: HTMLElement, edit: { name?: string; loc?: string }, mock: (doc: string) => unknown) {
  buttonNamed(target, 'Edit')!.click();
  flushSync();
  if (edit.name !== undefined) type(target, '#editName', edit.name);
  if (edit.loc !== undefined) type(target, '#editLoc', edit.loc);
  const form = target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY) return { node: stored }; // the action's own read
    return mock(doc);
  });
  const r = (await actions.updateMeta({
    request: { formData: async () => new FormData(form) },
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
  } as never)) as Record<string, unknown>;
  // actionResultOf encodes the fail()/message() discrimination once for every
  // test that drives a real action through the stubbed enhance.
  const result = actionResultOf(r);
  await submitEnhancedWithResult(form, result);
  for (let i = 0; i < 10; i++) await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
  return { r, result };
}

// The #1882 branch: the metadata update commits, then the move throws — the
// action answers fail(status, { form, metaSaved: true }).
const saveWithFailingMove = async (target: HTMLElement, loc: string, moveError: unknown) => {
  const { r, result } = await runMetaSave(target, { name: 'Renamed', loc }, (doc) => {
    if (doc === MOVE_NODE_MUTATION) {
      serve(); // later reads (the reload) see what the server now holds
      throw moveError;
    }
    if (doc !== UPDATE_NODE_MUTATION) throw new Error(`unexpected document between update and move: ${String(doc).slice(0, 60)}`);
    stored = { ...NODE, name: 'Renamed' };
    return { updateNode: stored };
  });
  expect((r.data as Record<string, unknown>).metaSaved).toBe(true);
  expect(result.type).toBe('failure');
  return r as { status: number; data: Record<string, unknown> };
};

describe('#1882: a failed location move in Settings says so', () => {
  it('an occupied destination (409) keeps the error and the typed location after the reload', async () => {
    const target = await mountSettings();
    const r = await saveWithFailingMove(target, 'renamed', gqlError('NODE_ALREADY_EXISTS', 'A node already exists at that location.'));
    expect(r.status).toBe(409);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    const alert = target.querySelector('form[action="?/updateMeta"] [role="alert"]');
    expect(alert?.textContent ?? '').toMatch(/^Saved, but the node was not moved: /);
    expect(target.querySelector<HTMLInputElement>('#editLoc')!.value).toBe('renamed');
    expect(target.querySelector<HTMLInputElement>('#editName')!.value).toBe('Renamed');
    // The failure is the page's action data again once it is applied after the reload.
    expect(get(page).form).not.toBeNull();
  });

  it('a move that fails for another reason (500) also keeps its error after the reload', async () => {
    const target = await mountSettings();
    const r = await saveWithFailingMove(target, 'hrn:node:acme.com:no-such-memory:foo', gqlError('NOT_FOUND', 'Memory not found.'));
    expect(r.status).toBe(500);
    const alert = target.querySelector('form[action="?/updateMeta"] [role="alert"]');
    expect(alert?.textContent ?? '').toMatch(/^Saved, but the node was not moved: /);
    expect(target.querySelector<HTMLInputElement>('#editLoc')!.value).toBe('hrn:node:acme.com:no-such-memory:foo');
  });

  it('the reload still runs, so the page shows the saved name', async () => {
    const target = await mountSettings();
    await saveWithFailingMove(target, 'renamed', gqlError('NODE_ALREADY_EXISTS', 'taken'));
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(target.querySelector('h1')?.textContent).toContain('Renamed');
  });

  // portal#1980 (Juliet's LOCAL F1, Bianca's BLIND F1 on #1967): the reload is
  // best-effort. When invalidateAll rejects, superforms answers the onResult
  // throw with an error result and rethrows it (its default onError), which
  // replaces the already-known partial-save failure — the message and the typed
  // location are lost. Red-first: without the try/catch in the page's onResult
  // this test fails with the injected rejection escaping through superforms.
  //
  // The rejecting stub models invalidateAll's REAL rejection class (kit client
  // rethrows when the root error page itself fails to load, or handleError
  // throws — load_route otherwise resolves a handled load failure through the
  // error boundary without rejecting). The boundary case unmounts this page
  // entirely and is out of scope here; see
  // hrn:node:hadronmemory.com:hadron-portal:review:uncertain-mutation-outcome-outlives-action.
  it('a rejecting reload keeps the failure and the typed location (#1980)', async () => {
    const target = await mountSettings();
    navigationHooks.onInvalidateAll = async () => {
      // Kit's invalidation reruns the load a round trip later (the yield below)
      // and resets the page store's form — the form PROP is kept — before the
      // rejected load surfaces. The rejection is what reaches the page's
      // `await invalidateAll()`.
      await new Promise((resolve) => setTimeout(resolve, 0));
      page.update((p) => ({ ...p, form: null }));
      throw new Error('reload rejected (fixture)');
    };
    const r = await saveWithFailingMove(target, 'renamed', gqlError('NODE_ALREADY_EXISTS', 'A node already exists at that location.'));
    expect(r.status).toBe(409);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    const alert = target.querySelector('form[action="?/updateMeta"] [role="alert"]');
    expect(alert?.textContent ?? '').toMatch(/^Saved, but the node was not moved: /);
    expect(target.querySelector<HTMLInputElement>('#editLoc')!.value).toBe('renamed');
    expect(target.querySelector<HTMLInputElement>('#editName')!.value).toBe('Renamed');
    expect(get(page).form).not.toBeNull();
    // The best-effort swallow WARNS: for the rejection classes that reach the
    // catch, kit's own reporting is what failed, so this is the only record.
    // Assert it here, then consume it so the strict afterEach gate holds for
    // every other test.
    const warn = consoleMsgs.find((m) => m.text.includes('saved, but the reload after it failed'));
    expect(warn?.level).toBe('warn');
    expect(warn?.text).toContain('reload rejected (fixture)');
    consoleMsgs.length = 0;
  });

  // The two branches onResult must NOT touch (the #1967 review asked for them
  // alongside the guard): neither may reload, and only a success may close
  // the editor (#2014). A plain failure — the update itself failed, no `metaSaved` — is
  // not a partial save: nothing was saved, the reader must not be told the node
  // "was not moved", and the editor stays open for a retry.
  it('a plain failure (no metaSaved) keeps the editor open and never reloads', async () => {
    const target = await mountSettings();
    const { r } = await runMetaSave(target, { name: 'Renamed' }, () => {
      throw gqlError('BAD_USER_INPUT', 'update failed (fixture)');
    });
    expect(r.status).toBe(500);
    expect((r.data as Record<string, unknown>).metaSaved).toBeUndefined();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    // Editor still open with the typed name, and no partial-save claim.
    expect(target.querySelector('#editLoc')).not.toBeNull();
    expect(target.querySelector<HTMLInputElement>('#editName')!.value).toBe('Renamed');
    const alert = target.querySelector('form[action="?/updateMeta"] [role="alert"]');
    expect(alert?.textContent ?? '').not.toMatch(/^Saved, but the node was not moved/);
    expect(get(page).form).not.toBeNull();
  });

  // portal#2014: superforms runs onResult for EVERY result type, `error`
  // included (no action response arrived: the fetch died, or a non-action JSON
  // came back). The save was not confirmed, so the editor must stay open with
  // the typed values for a retry. Not "nothing was saved": a response can be
  // lost after the write. The rethrow is superforms' own default onError,
  // driven through the real result handler, not a mock.
  it('an error result (the request itself failed) keeps the editor open for a retry (#2014)', async () => {
    const target = await mountSettings();
    buttonNamed(target, 'Edit')!.click();
    flushSync();
    type(target, '#editName', 'Renamed');
    const form = target.querySelector<HTMLFormElement>('form[action="?/updateMeta"]')!;
    let rethrown: unknown;
    await captureUnhandledRejections(async () => {
      await submitEnhancedWithRawResult(form, { type: 'error', error: new Error('fetch died (fixture)'), status: 500 }).catch((e: unknown) => { rethrown = e; });
      for (let i = 0; i < 10; i++) await tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (let i = 0; i < 10; i++) await tick();
      flushSync();
    });
    expect(rethrown).toBeDefined(); // superforms' default onError rethrows: kit-accurate
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    expect(target.querySelector('#editLoc')).not.toBeNull();
    expect(target.querySelector<HTMLInputElement>('#editName')!.value).toBe('Renamed');
    const alert = target.querySelector('form[action="?/updateMeta"] [role="alert"]');
    expect(alert?.textContent ?? '').not.toMatch(/^Saved, but the node was not moved/);
  });

  it('a successful save closes the editor; the metaSaved reload branch never runs', async () => {
    const target = await mountSettings();
    const { r, result } = await runMetaSave(target, { name: 'Renamed' }, (doc) => {
      if (doc !== UPDATE_NODE_MUTATION) throw new Error(`unexpected document after update: ${String(doc).slice(0, 60)}`);
      stored = { ...NODE, name: 'Renamed' };
      // Closing the editor re-renders the Node section (memory picker, children
      // doors), which reads again — later reads see the saved node.
      serve();
      return { updateNode: stored };
    });
    expect(result.type).toBe('success');
    expect(r.status).toBeUndefined(); // message() without a status: not a fail()
    // Exactly ONE invalidateAll — superforms' own default success invalidation
    // (superForm.js: `invalidateAll: true`). The page's metaSaved reload cannot
    // be this call: `metaSavedDespiteFailure` requires type === 'failure', so
    // on success the onResult runs only `isEditing = false`.
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    // Editor closed: the inputs are gone, the Edit button is back, and the
    // success cue renders — without coupling to the i18n copy.
    expect(target.querySelector('#editLoc')).toBeNull();
    expect(target.querySelector('#editName')).toBeNull();
    expect(buttonNamed(target, 'Edit')).toBeTruthy();
    expect(target.querySelector('[role="status"]')?.textContent ?? '').not.toBe('');
  });
});
