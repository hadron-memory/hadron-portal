import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
import type { BootSourceView, SourceLintItem } from '$lib/server/boot-source';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
import { bootSourceSchema, bootStartSchema } from './schema';

const TAG = '# Boot\n{{> policies:conduct}}\n';
const RESOLVED = '# Boot\nBe kind.\n';
const SOURCE: BootSourceView = { mode: 'source', node: { id: 'n1', urn: 'hrn:node:ada:sys:boot:source', revision: 3, content: TAG }, compiled: null, noPointer: true };

type Route = () => Response | Promise<Response>;
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const refused = () => new Response('{"error":"Unavailable"}', { status: 502 });
const noLint = ok({ id: 'n1', revision: 3, page: { items: [], total: 0, nextCursor: null } });
const saved = (revision = 3, content = RESOLVED, id = 'n1') => ok({ node: { id, revision, content } });
const warn = (kind: string, over: Partial<SourceLintItem> = {}): SourceLintItem => ({ kind, position: 8, targetUrn: null, pinnedRevision: null, newerRevision: null, ...over });
const page = (items: SourceLintItem[], total = items.length, nextCursor: string | null = null, revision = 3) => ok({ id: 'n1', revision, page: { items, total, nextCursor } });

/** Routes by endpoint, a fresh Response per call; anything else fails the test. */
function routes(resolved: Route, lint: Route = noLint) {
  const calls: string[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (/^\/app\/agents\/[ab]\/boot-source\/resolved/.test(url)) return resolved();
    if (/^\/app\/agents\/[ab]\/boot-source\/lint/.test(url)) return lint();
    if (url.startsWith('/app/boot-prompt?node=')) return new Response(JSON.stringify({ page: { items: [], total: 0, hasMore: false, pruned: false } }));
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; vi.unstubAllGlobals(); });
beforeEach(() => { routes(saved()); });

async function open(bootSource: BootSourceView = SOURCE, canManageAgent: boolean | null = true, tab = true) {
  const data = await pageData('a', { mentionOnly: false }, {});
  const src = bootSource.mode === 'source' ? bootSource.node : null;
  const bootSourceForm = await superValidate({ nodeId: src?.id ?? '', content: src?.content ?? '', expectedRevision: src?.revision ?? 1 }, zod4(bootSourceSchema), { id: 'bootSource:a', errors: false });
  const bootStartForm = await superValidate({}, zod4(bootStartSchema), { id: 'bootStart:a', errors: false });
  mounted = mountComponent(Page as never, { data: { ...data, canManageAgent, bootSource, bootSourceForm, bootStartForm }, form: null } as never) as Mounted<Record<string, unknown>>;
  await tick();
  if (tab) { button(mounted.target, 'Boot prompt').click(); await settle(); }
  return mounted.target;
}
const settle = async () => { await wait(0); await tick(3); flushSync(); };
const button = (root: HTMLElement, name: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === name)!;
const draft = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>('#bootSourceText')!;
const resolved = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-boot-resolved]');
const lintBox = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-boot-source-lint]');
async function switchTo(root: HTMLElement, name: string) { button(root, name).click(); await settle(); }
async function type(root: HTMLElement, text: string) {
  const area = draft(root);
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

describe('the source switch (portal#1667)', () => {
  it('shows the source first, and reads nothing resolved until the viewer asks', async () => {
    const calls = routes(saved());
    const root = await open();
    expect(button(root, 'Source').getAttribute('aria-pressed')).toBe('true');
    expect(button(root, 'As readers see it').getAttribute('aria-pressed')).toBe('false');
    expect(button(root, 'As readers see it').closest('[role=group]')?.getAttribute('aria-label')).toBeTruthy();
    expect(calls.filter((u) => u.includes('/resolved'))).toEqual([]);
  });
  it('shows the server text read-only, labelled with the revision the response returned', async () => {
    routes(saved(7));
    const root = await open();
    await switchTo(root, 'As readers see it');
    expect(root.querySelector('[data-boot-resolved] pre')?.textContent).toBe(RESOLVED);
    expect(root.querySelector('[data-boot-resolved] textarea, [data-boot-resolved] input')).toBeNull();
    expect(resolved(root)?.textContent).toContain('Saved revision 7, as you can read it');
    expect(resolved(root)?.textContent).toContain('isn’t what workers are served');
    expect(draft(root).closest('[hidden]')).not.toBeNull();
    expect(resolved(root)?.closest('[hidden]')).toBeNull();
  });
  it('reads once, and not again on switching back and forth', async () => {
    const calls = routes(saved());
    const root = await open();
    await switchTo(root, 'As readers see it');
    await switchTo(root, 'Source');
    await switchTo(root, 'As readers see it');
    expect(calls.filter((u) => u.includes('/resolved'))).toHaveLength(1);
  });
  it('leaves a dirty draft byte-for-byte alone, says so, and a save posts the raw tag', async () => {
    const root = await open();
    const edited = `${TAG}more {{> policies:conduct rev=2}}\n\t  `;
    await type(root, edited);
    await switchTo(root, 'As readers see it');
    expect(root.querySelector('[data-boot-resolved-dirty]')?.textContent).toContain('not your unsaved changes');
    expect(draft(root).value).toBe(edited);
    const form = draft(root).closest('form')!;
    expect(new FormData(form).get('content')).toBe(edited);
    await switchTo(root, 'Source');
    expect(draft(root).value).toBe(edited);
    expect(resolved(root)?.closest('[hidden]')).not.toBeNull();
  });
  it('offers Cancel and Save only with the source showing, and a draft survives the round trip', async () => {
    const root = await open();
    await type(root, `${TAG}more`);
    const actions = () => [...root.querySelectorAll<HTMLButtonElement>('form[action="?/saveBootSource"] button')].map((b) => b.textContent?.trim());
    expect(actions()).toEqual(['Cancel', 'Save']);
    await switchTo(root, 'As readers see it');
    expect(actions()).toEqual([]);
    await switchTo(root, 'Source');
    expect(actions()).toEqual(['Cancel', 'Save']);
    expect(draft(root).value).toBe(`${TAG}more`);
  });
  it('says nothing of unsaved changes on a clean draft', async () => {
    const root = await open();
    await switchTo(root, 'As readers see it');
    expect(root.querySelector('[data-boot-resolved-dirty]')).toBeNull();
    expect(root.querySelector('[data-boot-resolved-changed]')).toBeNull();
  });
  it('says the source changed elsewhere, and leaves the draft and its revision alone', async () => {
    routes(saved(4));
    const root = await open();
    await type(root, 'mine');
    await switchTo(root, 'As readers see it');
    expect(root.querySelector('[data-boot-resolved-changed]')?.textContent).toContain('changed since you opened it (now revision 4)');
    expect(draft(root).value).toBe('mine');
    expect(root.querySelector<HTMLInputElement>('input[name=expectedRevision]')?.value).toBe('3');
  });
  it('a failed read says so, and is never an empty view', async () => {
    routes(refused);
    const root = await open();
    await switchTo(root, 'As readers see it');
    expect(resolved(root)?.querySelector('[role=alert]')?.textContent).toBe('Couldn’t load the source as readers see it.');
    expect(root.querySelector('[data-boot-resolved] pre')).toBeNull();
  });
  it('a rejected fetch and an unparseable body fail the same way', async () => {
    routes(() => { throw new Error('offline'); });
    let root = await open();
    await switchTo(root, 'As readers see it');
    expect(resolved(root)?.querySelector('[role=alert]')).not.toBeNull();
    mounted?.unmount();
    routes(() => new Response('<html>', { status: 200 }));
    root = await open();
    await switchTo(root, 'As readers see it');
    expect(resolved(root)?.querySelector('[role=alert]')).not.toBeNull();
  });
  it('drops a response for another node', async () => {
    routes(saved(3, 'SOMEONE ELSES TEXT', 'other'));
    const root = await open();
    await switchTo(root, 'As readers see it');
    expect(root.textContent).not.toContain('SOMEONE ELSES TEXT');
    expect(resolved(root)?.querySelector('[role=alert]')).not.toBeNull();
  });
  it('renders include markup and the notice as inert text, exactly as returned', async () => {
    const text = 'a [Include unavailable] <img src=x onerror=1> b';
    routes(saved(3, text));
    const root = await open();
    await switchTo(root, 'As readers see it');
    expect(root.querySelector('[data-boot-resolved] pre')?.textContent).toBe(text);
    expect(root.querySelector('[data-boot-resolved] img')).toBeNull();
  });
  it('never requests or shows a target the server withheld', async () => {
    const calls = routes(saved(3, 'a [Include unavailable] b'), page([warn('BROKEN_INCLUDE')]));
    const root = await open();
    await switchTo(root, 'As readers see it');
    expect(calls.every((u) => /\/boot-source\/(resolved|lint)$/.test(u))).toBe(true);
    expect(root.innerHTML).not.toContain('policies:conduct"');
    expect(lintBox(root)?.querySelector('code')).toBeNull();
    expect(lintBox(root)?.textContent).toContain('This include can’t be filled in.');
  });
});

describe('late responses (portal#1667)', () => {
  function held() {
    const pending: Array<(r: Response) => void> = [];
    return { route: () => new Promise<Response>((resolve) => pending.push(resolve)), pending };
  }
  it('a late response after switching back never touches the draft', async () => {
    const h = held();
    routes(h.route);
    const root = await open();
    await switchTo(root, 'As readers see it');
    await switchTo(root, 'Source');
    await type(root, 'typed meanwhile');
    h.pending[0](saved(9, 'LATE')() as Response);
    await settle();
    expect(draft(root).value).toBe('typed meanwhile');
  });
  it('a response after leaving the Agent neither lands nor rejects into the void', async () => {
    const h = held();
    routes(h.route);
    const root = await open();
    await switchTo(root, 'As readers see it');
    mounted?.unmount();
    mounted = null;
    h.pending[0](saved(9, 'LATE')() as Response);
    await settle();
    expect(root.textContent ?? '').not.toContain('LATE');
  });
  it('a teardown aborts the read in flight', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => { signal ??= init.signal ?? undefined; return new Promise<Response>(() => {}); }));
    await open();
    mounted?.unmount();
    mounted = null;
    expect(signal?.aborted).toBe(true);
  });
});

describe('after a save or a navigation (portal#1667)', () => {
  const sourceData = async (agent: string, revision: number, content = TAG) => {
    const data = await pageData(agent, { mentionOnly: false }, {});
    const id = agent === 'a' ? 'n1' : 'n2';
    const bootSource: BootSourceView = { mode: 'source', node: { id, urn: 'hrn:node:ada:sys:boot:source', revision, content }, compiled: null, noPointer: true };
    const bootSourceForm = await superValidate({ nodeId: id, content, expectedRevision: revision }, zod4(bootSourceSchema), { id: `bootSource:${agent}`, errors: false });
    const bootStartForm = await superValidate({}, zod4(bootStartSchema), { id: `bootStart:${agent}`, errors: false });
    return { ...data, canManageAgent: true, bootSource, bootSourceForm, bootStartForm };
  };
  async function openReactive() {
    const { reactiveProps } = await import('$lib/test/reactiveProps.svelte');
    const props = reactiveProps({ data: await sourceData('a', 3), form: null } as Record<string, unknown>);
    mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    await tick(5);
    button(mounted.target, 'Boot prompt').click();
    await settle();
    return { root: mounted.target, props };
  }
  const count = (calls: string[], part: string) => calls.filter((u) => u.includes(part)).length;

  it('a save keeps the view, and re-reads both for the new revision', async () => {
    let revision = 3;
    const calls = routes(() => saved(revision)(), () => page([warn('BROKEN_INCLUDE')], 1, null, revision)());
    const { root, props } = await openReactive();
    await switchTo(root, 'As readers see it');
    expect(count(calls, '/resolved')).toBe(1);
    expect(count(calls, '/lint')).toBe(1);
    revision = 4;
    props.data = await sourceData('a', 4);
    await settle();
    expect(button(root, 'As readers see it').getAttribute('aria-pressed')).toBe('true');
    expect(count(calls, '/resolved')).toBe(2);
    expect(count(calls, '/lint')).toBe(2);
    expect(resolved(root)?.textContent).toContain('Saved revision 4');
    expect(root.querySelector('[data-boot-resolved-changed]')).toBeNull();
  });
  it('a save from the Source side re-reads lint, and the next switch reads the new revision', async () => {
    let revision = 3;
    const calls = routes(() => saved(revision)(), () => page([], 0, null, revision)());
    const { root, props } = await openReactive();
    await switchTo(root, 'As readers see it');
    await switchTo(root, 'Source');
    revision = 4;
    props.data = await sourceData('a', 4);
    await settle();
    expect(count(calls, '/resolved')).toBe(1);
    expect(count(calls, '/lint')).toBe(2);
    await switchTo(root, 'As readers see it');
    expect(resolved(root)?.textContent).toContain('Saved revision 4');
  });
  it('a refused save keeps the draft and re-reads what is saved', async () => {
    const { submitEnhancedDeferred } = await import('$lib/test/stubs/app-forms');
    const { setStubPage, resetStubPage } = await import('$lib/test/stubs/app-stores');
    setStubPage('http://localhost/app/agents/a');
    try {
      let revision = 3;
      const calls = routes(() => saved(revision)());
      const { root } = await openReactive();
      await type(root, 'mine');
      await switchTo(root, 'As readers see it');
      revision = 4;
      const pending = await submitEnhancedDeferred(root.querySelector<HTMLFormElement>('form[action="?/saveBootSource"]')!);
      await pending.finish({ type: 'failure', status: 409, data: { form: { id: 'bootSource:a', valid: true, posted: true, errors: {}, data: { _kind: 'bootSource', nodeId: 'n1', content: 'mine', expectedRevision: 3 }, message: { type: 'error', text: 'Someone changed the source.' } } } });
      await settle();
      expect(draft(root).value).toBe('mine');
      expect(count(calls, '/resolved')).toBe(2);
      expect(count(calls, '/lint')).toBe(2);
      expect(root.querySelector('[data-boot-resolved-changed]')?.textContent).toContain('now revision 4');
    } finally { resetStubPage(); }
  });
  it('navigating to another Agent goes back to the source, and the old response never shows there', async () => {
    const pending: Array<(r: Response) => void> = [];
    routes(() => new Promise<Response>((resolve) => pending.push(resolve)));
    const { root, props } = await openReactive();
    await switchTo(root, 'As readers see it');
    props.data = await sourceData('b', 1, 'Agent B source');
    await settle();
    pending[0](saved(9, 'AGENT A TEXT')() as Response);
    await settle();
    expect(button(root, 'Source').getAttribute('aria-pressed')).toBe('true');
    expect(draft(root).value).toBe('Agent B source');
    expect(root.textContent).not.toContain('AGENT A TEXT');
  });
});

describe('source lint (portal#1667)', () => {
  const COPY: Array<[string, string]> = [
    ['BROKEN_INCLUDE', 'This include can’t be filled in.'],
    ['NO_QUALIFYING_REVISION', 'No revision meets this include’s settings.'],
    ['PINNED_NEWER_APPROVED', 'This include is pinned, and a newer revision is approved.'],
    ['RETIRED_TARGET', 'This include points at something deleted.'],
    ['SIGNING_NOT_CHECKED', 'This include says signed, but signing isn’t checked yet.'],
    ['POLICY_OVERRIDE', 'An installed memory replaces this node.'],
    ['RECOMPILE_AVAILABLE', 'A recompile would pick a newer revision.'],
    ['WORKER_LINK_MISSING', 'The worker link is missing.'],
    ['A_KIND_THIS_BUILD_NEVER_HEARD_OF', 'Warning'],
  ];
  it.each(COPY)('%s reads in plain words', async (kind, words) => {
    routes(saved(), page([warn(kind)]));
    const root = await open();
    expect(root.querySelector(`[data-lint-kind=${kind}]`)?.textContent).toContain(words);
    expect(root.querySelector(`[data-lint-kind=${kind}]`)?.textContent).toContain('Line 2, column 2');
    expect(lintBox(root)?.textContent).toContain('Warnings for the saved source');
  });
  it('shows a target only as returned, and the pinned and newer revisions', async () => {
    const urn = 'hrn:node:hadronmemory.com:sys:policies:conduct';
    routes(saved(), page([warn('PINNED_NEWER_APPROVED', { targetUrn: urn, pinnedRevision: 2, newerRevision: 5 }), warn('BROKEN_INCLUDE', { position: 40 })]));
    const root = await open();
    const [pinned, broken] = [...root.querySelectorAll('[data-lint-kind]')];
    expect(pinned.querySelector('code')?.textContent?.replace(/\s/g, '')).toContain('policies:conduct');
    expect(pinned.textContent).toContain('Pinned to revision 2');
    expect(pinned.textContent).toContain('Revision 5 is approved');
    expect(broken.textContent).toContain('Character 40');
    expect(broken.querySelector('code')).toBeNull();
  });
  it('counts lines and columns in the saved text, a character outside it stays a character', async () => {
    const content = 'one\r\n\u{1F600}{{> a}}\n{{> b}}';
    routes(saved(), page([warn('BROKEN_INCLUDE', { position: 0 }), warn('BROKEN_INCLUDE', { position: 7 }), warn('BROKEN_INCLUDE', { position: content.indexOf('{{> b') }), warn('BROKEN_INCLUDE', { position: content.length + 1 })]));
    const root = await open({ ...SOURCE, node: { ...SOURCE.node!, content } } as BootSourceView);
    const rows = [...root.querySelectorAll('[data-lint-kind]')].map((r) => r.textContent);
    expect(rows[0]).toContain('Line 1, column 1');
    expect(rows[1]).toContain('Line 2, column 2');
    expect(rows[2]).toContain('Line 3, column 1');
    expect(rows[3]).toContain(`Character ${content.length + 1}`);
    expect(rows.join(' ')).not.toContain('Position');
  });
  it('a warning from another revision than the saved text is a character, never a wrong line', async () => {
    routes(saved(), page([warn('BROKEN_INCLUDE')], 1, null, 4));
    const root = await open();
    const row = root.querySelector('[data-lint-kind]');
    expect(row?.textContent).toContain('Character 8');
    expect(row?.textContent).not.toContain('Line');
  });
  it('an empty page renders no list', async () => {
    const root = await open();
    expect(lintBox(root)).toBeNull();
  });
  it('a null page says unavailable, and the editor stays', async () => {
    routes(saved(), ok({ id: 'n1', revision: 3, page: null }));
    const root = await open();
    expect(lintBox(root)?.textContent).toBe('Warnings unavailable');
    expect(draft(root)).not.toBeNull();
  });
  it('a failed read says so, and the editor stays', async () => {
    routes(saved(), refused);
    const root = await open();
    expect(lintBox(root)?.textContent).toBe('Couldn’t load warnings');
    expect(draft(root).value).toBe(TAG);
  });
  it('drops a page for another node', async () => {
    routes(saved(), ok({ id: 'other', revision: 3, page: { items: [warn('RETIRED_TARGET')], total: 1, nextCursor: null } }));
    const root = await open();
    expect(lintBox(root)?.textContent).toBe('Couldn’t load warnings');
    expect(root.querySelector('[data-lint-kind]')).toBeNull();
  });
  it('shows n of total, and Show more follows nextCursor', async () => {
    const calls: string[] = [];
    let n = 0;
    routes(saved(), () => {
      calls.push('lint');
      return (n++ === 0 ? page([warn('RETIRED_TARGET')], 2, 'next+/=') : page([warn('BROKEN_INCLUDE', { position: 40 })], 2))();
    });
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const root = await open();
    expect(lintBox(root)?.textContent).toContain('1 of 2');
    await switchTo(root, 'Show more');
    expect(String(urls.at(-1)?.[0])).toBe('/app/agents/a/boot-source/lint?after=next%2B%2F%3D');
    expect(lintBox(root)?.textContent).toContain('2 of 2');
    expect(root.querySelectorAll('[data-lint-kind]')).toHaveLength(2);
    expect(button(root, 'Show more')).toBeUndefined();
  });
  it('a failed Show more keeps what is shown and says so', async () => {
    let n = 0;
    routes(saved(), () => (n++ === 0 ? page([warn('RETIRED_TARGET')], 2, 'next')() : refused()));
    const root = await open();
    await switchTo(root, 'Show more');
    expect(root.querySelectorAll('[data-lint-kind]')).toHaveLength(1);
    expect(lintBox(root)?.querySelector('[role=alert]')?.textContent).toBe('Couldn’t load warnings');
  });
  it('a page from another revision restarts the list instead of stitching two', async () => {
    let n = 0;
    routes(saved(), () => [page([warn('RETIRED_TARGET')], 2, 'next'), page([warn('BROKEN_INCLUDE', { position: 40 })], 2, null, 4), page([warn('SIGNING_NOT_CHECKED')], 1, null, 4)][n++]());
    const root = await open();
    await switchTo(root, 'Show more');
    expect([...root.querySelectorAll('[data-lint-kind]')].map((e) => e.getAttribute('data-lint-kind'))).toEqual(['SIGNING_NOT_CHECKED']);
  });
  it('Save and compile stay enabled whatever the warnings say', async () => {
    routes(saved(), page([warn('BROKEN_INCLUDE'), warn('RETIRED_TARGET')]));
    const root = await open();
    expect(button(root, 'Save').disabled).toBe(false);
    expect(button(root, 'Update the prompt workers get').disabled).toBe(false);
  });
  it('waits for the tab: an Agent page opened elsewhere reads no lint', async () => {
    const calls = routes(saved());
    const root = await open(SOURCE, true, false);
    expect(calls).toEqual([]);
    button(root, 'Boot prompt').click();
    await settle();
    expect(calls).toEqual(['/app/agents/a/boot-source/lint']);
  });
});

describe('who sees it (portal#1667)', () => {
  it('a reader who can\'t manage gets both, read-only', async () => {
    routes(saved(), page([warn('BROKEN_INCLUDE')]));
    const root = await open(SOURCE, false);
    await switchTo(root, 'As readers see it');
    expect(root.querySelector('[data-boot-resolved] pre')).not.toBeNull();
    expect(lintBox(root)).not.toBeNull();
    expect(draft(root).readOnly).toBe(true);
    expect(button(root, 'Save')).toBeUndefined();
  });
  const compiled = { id: 'c1', urn: 'hrn:node:ada:sys:boot:compiled', revision: 2, content: 'COMPILED TEXT', approvedRevision: 2, pending: false, lint: null };
  it.each<BootSourceView>([{ mode: 'unknown' }, { mode: 'source-unreadable' }, { mode: 'compiled-only', compiled }, { mode: 'legacy', canStart: false }, { mode: 'source-missing', compiled: null, canStart: false }])('$mode shows no switch or lint and never reads the source', async (view) => {
    const calls = routes(saved(), page([warn('BROKEN_INCLUDE')]));
    const root = await open(view);
    expect(button(root, 'As readers see it')).toBeUndefined();
    expect(resolved(root)).toBeNull();
    expect(lintBox(root)).toBeNull();
    expect(calls).toEqual(view.mode === 'compiled-only' ? ['/app/boot-prompt?node=c1&revision=2&offset=0'] : []);
  });
  it('keeps the compiled-only reader\'s view', async () => {
    const root = await open({ mode: 'compiled-only', compiled });
    expect(root.textContent).toContain('COMPILED TEXT');
  });
});
