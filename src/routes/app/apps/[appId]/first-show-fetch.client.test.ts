/**
 * portal#2240 (ruling 0273) — the App page loads only its first screen, so
 * every other tab is read from `tab/+server.ts` on its first show. MOUNTED,
 * because all of it lives in effects and in what lands after an await:
 *
 * - one read per tab per visit, and switching back does not read again;
 * - a tab whose read hangs blocks no other tab;
 * - a failed first read says so, with a retry that reads again;
 * - new loader data marks a read tab stale: it keeps rendering, and is read
 *   again on its next show;
 * - a late answer never lands on a page that is gone (no unhandled rejection)
 *   or on another App's page. Each guard is pinned with its positive twin, so
 *   a harness that never delivered the answer cannot pass for a guard.
 *
 * The page opens on Chats with Chats' reads in the loader data, and with the
 * Keys and Worklog reads left out: those two are disjoint from Chats', so the
 * page must fetch them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureUnhandledRejections, mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';
import { READ_GROUP_KEYS, TAB_READS } from './first-screen';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  resetNavigationCalls();
  window.history.replaceState({}, '', '/');
});

/** A tab read the test answers when it chooses, so "in flight" is a state it can hold. */
type Pending = { tab: string; app: string; resolve: (r: Response) => void };
let tabReads: Pending[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const keysPayload = (preview: string) => ({ appKeys: { kind: 'ok', keys: [{ id: `k-${preview}`, keyPreview: preview, label: 'CI', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: null, revokedAt: null }] }, keyScopes: { kind: 'ok', byKey: {} } });
const worklogPayload = { worklog: [], worklogTotal: 0, worklogError: false };

function stubFetch() {
  tabReads = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'https://example.test');
    const m = url.pathname.match(/^\/app\/apps\/([^/]+)\/tab$/);
    if (m) return new Promise<Response>((resolve) => tabReads.push({ tab: url.searchParams.get('tab') ?? '', app: decodeURIComponent(m[1]), resolve }));
    // Anything else the page polls (the team chat, its authors) answers empty.
    return Promise.resolve(json({ items: [], total: 0, loadFailed: false }));
  }));
}

/** The loader data of a Chats-first load: Keys' and Worklog's read groups absent. */
async function chatsFirst(appId = 'a1') {
  const data = { ...await pageData(), bootPointerAppKey: appId } as Record<string, unknown>;
  data.app = { ...(data.app as object), id: appId };
  for (const tab of ['keys', 'worklog'] as const) for (const g of TAB_READS[tab]) for (const k of READ_GROUP_KEYS[g]) delete data[k];
  return data;
}

async function mountPage() {
  stubFetch();
  setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
  window.history.replaceState({}, '', '/app/apps/a1?tab=chats');
  const props = reactiveProps({ data: await chatsFirst(), form: null } as Record<string, unknown>);
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return { m, target: m.target, props };
}

async function show(target: HTMLElement, tab: string) {
  target.querySelector<HTMLElement>(`#tab-${tab}`)!.click();
  await tick(3);
}
const readsOf = (tab: string) => tabReads.filter((r) => r.tab === tab);
const panel = (t: HTMLElement, tab: string) => t.querySelector<HTMLElement>(`#panel-${tab}`);
const loading = (t: HTMLElement, tab: string) => panel(t, tab)?.querySelector('[role="status"]')?.textContent?.includes('Loading') ?? false;
const keyShown = (t: HTMLElement, preview: string) => panel(t, 'keys')?.textContent?.includes(preview) ?? false;

describe('portal#2240: a tab the first screen did not read', () => {
  it('Chats, the tab the load read, renders without a tab read', async () => {
    const { target } = await mountPage();
    expect(panel(target, 'chats')).not.toBeNull();
    expect(tabReads).toEqual([]);
  });

  it('is read once on its first show, renders when the answer lands, and is not read again on switching back', async () => {
    const { target } = await mountPage();
    await show(target, 'keys');
    expect(readsOf('keys')).toHaveLength(1);
    expect(loading(target, 'keys')).toBe(true);

    readsOf('keys')[0].resolve(json(keysPayload('abc123')));
    await wait(0); await tick(3);
    expect(loading(target, 'keys')).toBe(false);
    expect(keyShown(target, 'abc123')).toBe(true);

    await show(target, 'chats');
    await show(target, 'keys');
    expect(keyShown(target, 'abc123')).toBe(true);
    expect(readsOf('keys')).toHaveLength(1);
  });

  it('a read in flight is not asked again when the tab is shown again', async () => {
    const { target } = await mountPage();
    await show(target, 'keys');
    await show(target, 'chats');
    await show(target, 'keys');
    expect(readsOf('keys')).toHaveLength(1);
    expect(loading(target, 'keys')).toBe(true);
  });

  it('a tab whose read hangs blocks no other tab', async () => {
    const { target } = await mountPage();
    await show(target, 'keys');
    await show(target, 'worklog');
    expect(readsOf('worklog')).toHaveLength(1);
    readsOf('worklog')[0].resolve(json(worklogPayload));
    await wait(0); await tick(3);
    expect(loading(target, 'worklog')).toBe(false);
    expect(panel(target, 'worklog')).not.toBeNull();
    // Chats never waited on either.
    await show(target, 'chats');
    expect(panel(target, 'chats')?.querySelector('[role="status"]')?.textContent ?? '').not.toContain('Loading');
    // And the hung tab is still only loading, still asked once.
    await show(target, 'keys');
    expect(loading(target, 'keys')).toBe(true);
    expect(readsOf('keys')).toHaveLength(1);
  });

  it('a failed first read says so, and Try again reads again', async () => {
    const { target } = await mountPage();
    await show(target, 'keys');
    readsOf('keys')[0].resolve(json({ message: 'boom' }, 500));
    await wait(0); await tick(3);
    const alert = panel(target, 'keys')?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('could not be loaded');
    expect(keyShown(target, 'abc123')).toBe(false);
    // No loop against a failing server: still one read until the reader asks.
    await wait(10); await tick(3);
    expect(readsOf('keys')).toHaveLength(1);

    alert!.querySelector<HTMLButtonElement>('button')!.click();
    await tick(3);
    expect(readsOf('keys')).toHaveLength(2);
    readsOf('keys')[1].resolve(json(keysPayload('abc123')));
    await wait(0); await tick(3);
    expect(keyShown(target, 'abc123')).toBe(true);
  });

  it('new loader data keeps a read tab rendering, and reads it again on its next show', async () => {
    const { target, props } = await mountPage();
    await show(target, 'keys');
    readsOf('keys')[0].resolve(json(keysPayload('abc123')));
    await wait(0); await tick(3);
    await show(target, 'chats');

    props.data = await chatsFirst(); // an action's refresh: same App, same person
    await tick(3);
    expect(readsOf('keys')).toHaveLength(1);

    await show(target, 'keys');
    // Stale, not gone: what it had stays on screen while it is read again.
    expect(keyShown(target, 'abc123')).toBe(true);
    expect(loading(target, 'keys')).toBe(false);
    expect(readsOf('keys')).toHaveLength(2);
    readsOf('keys')[1].resolve(json(keysPayload('def456')));
    await wait(0); await tick(3);
    expect(keyShown(target, 'def456')).toBe(true);
  });

  it('loader data changing while a first read is in flight neither drops it nor starts a second read (portal#2256)', async () => {
    const { target, props } = await mountPage();
    await show(target, 'keys');
    expect(readsOf('keys')).toHaveLength(1);

    props.data = await chatsFirst(); // an action's refresh lands mid-read
    await tick(3);
    expect(readsOf('keys')).toHaveLength(1);
    expect(loading(target, 'keys')).toBe(true);

    // The one read lands; it was begun before the new data, so it is shown and read once more.
    readsOf('keys')[0].resolve(json(keysPayload('first')));
    await wait(0); await tick(3);
    expect(keyShown(target, 'first')).toBe(true);
    expect(readsOf('keys')).toHaveLength(2);
    readsOf('keys')[1].resolve(json(keysPayload('second')));
    await wait(0); await tick(3);
    expect(keyShown(target, 'second')).toBe(true);
    expect(readsOf('keys')).toHaveLength(2);
  });

  it('an older answer never replaces a newer one after loader data changed mid-read (portal#2256)', async () => {
    const { target, props } = await mountPage();
    await show(target, 'keys');
    props.data = await chatsFirst();
    await tick(3);
    // Newest read answers first; the older one answers last. Fixed, there is no
    // second read yet, so the order cannot invert.
    readsOf('keys')[1]?.resolve(json(keysPayload('second')));
    readsOf('keys')[0].resolve(json(keysPayload('first')));
    await wait(0); await tick(3);
    readsOf('keys')[1]?.resolve(json(keysPayload('second')));
    await wait(0); await tick(3);
    // Unfixed, the older answer landed last and put 'first' back over 'second'.
    expect(keyShown(target, 'second')).toBe(true);
    expect(keyShown(target, 'first')).toBe(false);
  });

  it('Profile, read lazily, shows one tabpanel while it loads (no duplicate #panel-profile)', async () => {
    const { target, props } = await mountPage();
    const data = await chatsFirst();
    delete data.canManageApp; // a Chats-first load does not carry Profile's manage gate
    props.data = data;
    await tick(3);
    await show(target, 'profile');
    expect(readsOf('profile')).toHaveLength(1);
    expect(target.querySelectorAll('#panel-profile')).toHaveLength(1);
    readsOf('profile')[0].resolve(json({ canManageApp: true }));
    await wait(0); await tick(3);
    expect(target.querySelectorAll('#panel-profile')).toHaveLength(1);
    expect(panel(target, 'profile')?.querySelector('[data-testid="profile-edit-in-settings"]')).not.toBeNull();
  });

  it('two tabs that carry the same key: the newest read wins, not the earliest-inserted tab (Keys re-read beats Client\'s older appKeys)', async () => {
    const { target, props } = await mountPage();
    await show(target, 'keys');
    readsOf('keys')[0].resolve(json(keysPayload('oldkey')));
    await wait(0); await tick(3);
    await show(target, 'client'); // Client also carries appKeys, read AFTER Keys
    readsOf('client')[0].resolve(json({ canManageApp: true, appKeys: keysPayload('oldkey').appKeys }));
    await wait(0); await tick(3);
    await show(target, 'chats');

    props.data = await chatsFirst(); // an action's refresh: every cached tab goes stale
    await tick(3);
    await show(target, 'keys');
    expect(readsOf('keys')).toHaveLength(2);
    readsOf('keys')[1].resolve(json(keysPayload('newkey'))); // e.g. a key was just created
    await wait(0); await tick(3);
    // Unfixed, Client's stale copy sat later in insertion order and masked this read.
    expect(keyShown(target, 'newkey')).toBe(true);
    expect(keyShown(target, 'oldkey')).toBe(false);
  });
});

describe('portal#2240: a late tab answer', () => {
  it('positive twin: an answer that lands while the page is up renders', async () => {
    const { target } = await mountPage();
    await show(target, 'keys');
    readsOf('keys')[0].resolve(json(keysPayload('abc123')));
    await wait(0); await tick(3);
    expect(keyShown(target, 'abc123')).toBe(true);
  });

  it('an answer that lands after the page is gone throws nothing into the void', async () => {
    let answered = false;
    const rejections = await captureUnhandledRejections(async () => {
      const { m, target } = await mountPage();
      await show(target, 'keys');
      expect(readsOf('keys')).toHaveLength(1);
      mounted.splice(mounted.indexOf(m), 1);
      m.unmount();
      const res = json(keysPayload('abc123'));
      const read = res.json.bind(res);
      res.json = () => { answered = true; return read(); };
      readsOf('keys')[0].resolve(res);
      await wait(10); await tick(3);
    });
    // The continuation really ran past the await (so the guard was reached) ...
    expect(answered).toBe(true);
    // ... and ended quietly.
    expect(rejections).toEqual([]);
  });

  it('positive twin: the same App\'s answer renders after the reader moved on and back', async () => {
    const { target } = await mountPage();
    await show(target, 'keys');
    await show(target, 'chats');
    readsOf('keys')[0].resolve(json(keysPayload('abc123')));
    await wait(0); await tick(3);
    await show(target, 'keys');
    expect(keyShown(target, 'abc123')).toBe(true);
  });

  it('App A\'s answer never renders on App B, which the page now shows', async () => {
    const { target, props } = await mountPage();
    // App A has read Worklog, and has Keys in flight when the reader leaves.
    await show(target, 'worklog');
    readsOf('worklog')[0].resolve(json({ ...worklogPayload, worklogTotal: 1 }));
    await wait(0); await tick(3);
    await show(target, 'keys');
    const a1Read = readsOf('keys')[0];
    expect(a1Read.app).toBe('a1');

    // SvelteKit reuses the page for another App.
    setStubPage('https://example.test/app/apps/a2?tab=keys', { appId: 'a2' });
    window.history.replaceState({}, '', '/app/apps/a2?tab=keys');
    props.data = { ...await chatsFirst('a2'), initialTab: 'keys' };
    await tick(3);
    const a2Read = readsOf('keys').find((r) => r.app === 'a2');
    expect(a2Read, 'App B reads its own Keys').toBeDefined();

    a1Read.resolve(json(keysPayload('from-a1')));
    await wait(0); await tick(3);
    expect(keyShown(target, 'from-a1')).toBe(false);
    expect(loading(target, 'keys')).toBe(true);

    a2Read!.resolve(json(keysPayload('from-a2')));
    await wait(0); await tick(3);
    expect(keyShown(target, 'from-a2')).toBe(true);
    expect(keyShown(target, 'from-a1')).toBe(false);

    // Nothing of App A's visit carried over: App B reads its own Worklog
    // rather than rendering the one App A read.
    await show(target, 'worklog');
    expect(readsOf('worklog').map((r) => r.app)).toEqual(['a1', 'a2']);
    expect(loading(target, 'worklog')).toBe(true);
  });

  it('App A\'s answer landing after App B\'s own leaves App B\'s tab as App B read it', async () => {
    const { target, props } = await mountPage();
    await show(target, 'keys');
    const a1Read = readsOf('keys')[0];

    setStubPage('https://example.test/app/apps/a2?tab=keys', { appId: 'a2' });
    window.history.replaceState({}, '', '/app/apps/a2?tab=keys');
    props.data = { ...await chatsFirst('a2'), initialTab: 'keys' };
    await tick(3);
    const a2Read = readsOf('keys').find((r) => r.app === 'a2')!;
    a2Read.resolve(json(keysPayload('from-a2')));
    await wait(0); await tick(3);
    expect(keyShown(target, 'from-a2')).toBe(true);

    a1Read.resolve(json(keysPayload('from-a1')));
    await wait(0); await tick(3);
    expect(keyShown(target, 'from-a1')).toBe(false);
    expect(keyShown(target, 'from-a2')).toBe(true);
    expect(loading(target, 'keys')).toBe(false);
  });
});
