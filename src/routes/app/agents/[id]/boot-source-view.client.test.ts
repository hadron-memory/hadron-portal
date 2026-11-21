import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
import type { BootSourceView, SourceLintItem } from '$lib/server/boot-source';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

const TAG = '# Boot\n{{> policies:conduct}}\n';
const APPROVAL = { state: 'NOT_APPROVED' as const, tone: 'neutral' as const, approval: null, canApprove: true };
const node = (id: string, revision: number, content = TAG) => ({ id, urn: 'hrn:node:ada:sys:boot:source', memoryId: 'sys', revision, content, approval: APPROVAL });
const SOURCE: BootSourceView = { mode: 'source', node: node('n1', 3), compiled: null, noPointer: true };

type Route = () => Response | Promise<Response>;
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const refused = () => new Response('{"error":"Unavailable"}', { status: 502 });
const noLint = ok({ id: 'n1', revision: 3, page: { items: [], total: 0, nextCursor: null } });
const warn = (kind: string, over: Partial<SourceLintItem> = {}): SourceLintItem => ({ kind, position: 8, targetUrn: null, pinnedRevision: null, newerRevision: null, ...over });
const page = (items: SourceLintItem[], total = items.length, nextCursor: string | null = null, revision = 3) => ok({ id: 'n1', revision, page: { items, total, nextCursor } });

/** Routes by endpoint, a fresh Response per call; anything else fails the test. */
function routes(lint: Route = noLint) {
  const calls: string[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (/^\/app\/agents\/[ab]\/boot-source\/lint/.test(url)) return lint();
    if (url.startsWith('/app/boot-prompt?node=')) return new Response(JSON.stringify({ page: { items: [], total: 0, hasMore: false, pruned: false } }));
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; vi.unstubAllGlobals(); });
beforeEach(() => { routes(); });

async function open(bootSource: BootSourceView = SOURCE, canManageAgent: boolean | null = true, tab = true) {
  const data = await pageData('a', { mentionOnly: false }, {});
  mounted = mountComponent(Page as never, { data: { ...data, canManageAgent, bootSource }, form: null } as never) as Mounted<Record<string, unknown>>;
  await tick();
  if (tab) { button(mounted.target, 'Boot prompt').click(); await settle(); }
  return mounted.target;
}
const settle = async () => { await wait(0); await tick(3); flushSync(); };
const button = (root: HTMLElement, name: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === name)!;
const lintBox = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-boot-source-lint]');
async function switchTo(root: HTMLElement, name: string) { button(root, name).click(); await settle(); }

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
    routes(page([warn(kind)]));
    const root = await open();
    expect(root.querySelector(`[data-lint-kind=${kind}]`)?.textContent).toContain(words);
    expect(root.querySelector(`[data-lint-kind=${kind}]`)?.textContent).toContain('Line 2, column 2');
    expect(lintBox(root)?.textContent).toContain('Warnings for the saved source');
  });
  it('shows a target only as returned, and the pinned and newer revisions', async () => {
    const urn = 'hrn:node:hadronmemory.com:sys:policies:conduct';
    routes(page([warn('PINNED_NEWER_APPROVED', { targetUrn: urn, pinnedRevision: 2, newerRevision: 5 }), warn('BROKEN_INCLUDE', { position: 40 })]));
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
    routes(page([warn('BROKEN_INCLUDE', { position: 0 }), warn('BROKEN_INCLUDE', { position: 7 }), warn('BROKEN_INCLUDE', { position: content.indexOf('{{> b') }), warn('BROKEN_INCLUDE', { position: content.length + 1 })]));
    const root = await open({ ...SOURCE, node: node('n1', 3, content) } as BootSourceView);
    const rows = [...root.querySelectorAll('[data-lint-kind]')].map((r) => r.textContent);
    expect(rows[0]).toContain('Line 1, column 1');
    expect(rows[1]).toContain('Line 2, column 2');
    expect(rows[2]).toContain('Line 3, column 1');
    expect(rows[3]).toContain(`Character ${content.length + 1}`);
    expect(rows.join(' ')).not.toContain('Position');
  });
  it('a warning from another revision than the saved text is a character, never a wrong line', async () => {
    routes(page([warn('BROKEN_INCLUDE')], 1, null, 4));
    const root = await open();
    const row = root.querySelector('[data-lint-kind]');
    expect(row?.textContent).toContain('Character 8');
    expect(row?.textContent).not.toContain('Line');
  });
  it('an empty page renders no list', async () => {
    const root = await open();
    expect(lintBox(root)).toBeNull();
  });
  it('a null page says unavailable, and the workflow stays', async () => {
    routes(ok({ id: 'n1', revision: 3, page: null }));
    const root = await open();
    expect(lintBox(root)?.textContent).toBe('Warnings unavailable');
    expect(root.querySelectorAll('[data-boot-steps] > li')).toHaveLength(4);
  });
  it('a failed read says so, and the workflow stays', async () => {
    routes(refused);
    const root = await open();
    expect(lintBox(root)?.textContent).toBe('Couldn’t load warnings');
    expect(root.querySelectorAll('[data-boot-steps] > li')).toHaveLength(4);
  });
  it('drops a page for another node', async () => {
    routes(ok({ id: 'other', revision: 3, page: { items: [warn('RETIRED_TARGET')], total: 1, nextCursor: null } }));
    const root = await open();
    expect(lintBox(root)?.textContent).toBe('Couldn’t load warnings');
    expect(root.querySelector('[data-lint-kind]')).toBeNull();
  });
  it('shows n of total, and Show more follows nextCursor', async () => {
    const calls: string[] = [];
    let n = 0;
    routes(() => {
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
    routes(() => (n++ === 0 ? page([warn('RETIRED_TARGET')], 2, 'next')() : refused()));
    const root = await open();
    await switchTo(root, 'Show more');
    expect(root.querySelectorAll('[data-lint-kind]')).toHaveLength(1);
    expect(lintBox(root)?.querySelector('[role=alert]')?.textContent).toBe('Couldn’t load warnings');
  });
  it('a page from another revision restarts the list instead of stitching two', async () => {
    let n = 0;
    routes(() => [page([warn('RETIRED_TARGET')], 2, 'next'), page([warn('BROKEN_INCLUDE', { position: 40 })], 2, null, 4), page([warn('SIGNING_NOT_CHECKED')], 1, null, 4)][n++]());
    const root = await open();
    await switchTo(root, 'Show more');
    expect([...root.querySelectorAll('[data-lint-kind]')].map((e) => e.getAttribute('data-lint-kind'))).toEqual(['SIGNING_NOT_CHECKED']);
  });
  it('Compile stays enabled whatever the warnings say', async () => {
    routes(page([warn('BROKEN_INCLUDE'), warn('RETIRED_TARGET')]));
    const root = await open();
    expect(button(root, 'Compile').disabled).toBe(false);
  });
  it('a Refresh that brings a new source revision re-reads its lint, and one that does not reads nothing', async () => {
    const { reactiveProps } = await import('$lib/test/reactiveProps.svelte');
    let revision = 3;
    const calls = routes(() => page([warn('BROKEN_INCLUDE')], 1, null, revision)());
    const data = await pageData('a', { mentionOnly: false }, {});
    const props = reactiveProps({ data: { ...data, canManageAgent: true, bootSource: SOURCE }, form: null } as Record<string, unknown>);
    mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    await tick(5);
    button(mounted.target, 'Boot prompt').click();
    await settle();
    const lintReads = () => calls.filter((u) => u.includes('/lint')).length;
    expect(lintReads()).toBe(1);
    props.data = { ...(props.data as Record<string, unknown>), bootSource: { ...SOURCE, node: node('n1', 3) } };
    await settle();
    expect(lintReads()).toBe(1);
    revision = 4;
    props.data = { ...(props.data as Record<string, unknown>), bootSource: { ...SOURCE, node: node('n1', 4) } };
    await settle();
    expect(lintReads()).toBe(2);
  });
  it('waits for the tab: an Agent page opened elsewhere reads no lint', async () => {
    const calls = routes();
    const root = await open(SOURCE, true, false);
    expect(calls).toEqual([]);
    button(root, 'Boot prompt').click();
    await settle();
    expect(calls).toEqual(['/app/agents/a/boot-source/lint']);
  });
});

describe('who sees it (portal#1667)', () => {
  it('a reader who can\'t manage gets the source lint, and no editor', async () => {
    routes(page([warn('BROKEN_INCLUDE')]));
    const root = await open(SOURCE, false);
    expect(lintBox(root)).not.toBeNull();
    expect(root.querySelector('textarea')).toBeNull();
    expect(button(root, 'Save')).toBeUndefined();
  });
  const compiled = { id: 'c1', urn: 'hrn:node:ada:sys:boot:compiled', memoryId: 'sys', revision: 2, content: 'COMPILED TEXT', approvedRevision: 2, pending: false, lint: null };
  it.each<BootSourceView>([{ mode: 'unknown' }, { mode: 'source-unreadable' }, { mode: 'compiled-only', compiled }, { mode: 'legacy', canStart: false }, { mode: 'source-missing', compiled: null, canStart: false }])('$mode shows no lint and never reads the source', async (view) => {
    const calls = routes(page([warn('BROKEN_INCLUDE')]));
    const root = await open(view);
    expect(lintBox(root)).toBeNull();
    expect(calls).toEqual(view.mode === 'compiled-only' ? ['/app/boot-prompt?node=c1&revision=2&offset=0'] : []);
  });
  it('keeps the compiled-only reader\'s view', async () => {
    const root = await open({ mode: 'compiled-only', compiled });
    expect(root.textContent).toContain('COMPILED TEXT');
  });
});
