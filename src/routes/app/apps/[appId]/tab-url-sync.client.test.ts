/**
 * portal#1943 — the address bar names the shown tab.
 *
 * Only Runs and Templates navigate on click; every other tab was local state, so after leaving Runs the
 * URL kept a stale `?tab=runs` and a reload landed on the wrong tab. Each tab switch now writes `?tab=<id>`
 * by `replaceState` (no history entry), the same mechanism `?chat=` and `?view=` use on this page.
 */
import type { AfterNavigate } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationGuards, navigationHooks, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';
import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

/** Put the stubbed page store and the address bar on one URL, so a test never leaves them disagreeing. */
function at(search: string) {
  setStubPage(`https://example.test/app/apps/a1${search}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1${search}`);
}

/** What SvelteKit hands `afterNavigate`, typed so a handler reading `to`/`from` gets real values, not undefined. */
function navigation(type: AfterNavigate['type']): AfterNavigate {
  return {
    type, from: null, willUnload: false, delta: type === 'popstate' ? -1 : undefined,
    to: { params: { appId: 'a1' }, route: { id: '/app/apps/[appId]' }, url: new URL(window.location.href) },
    complete: Promise.resolve(),
  } as AfterNavigate;
}

/** Fire every afterNavigate the mounted tree registered, as SvelteKit does (the page and a child each register one). */
function afterNavigate(type: AfterNavigate['type']) {
  const guards = navigationGuards.filter((g) => g.fn === 'afterNavigate');
  expect(guards.length, 'an afterNavigate is registered').toBeGreaterThan(0);
  for (const g of guards) (g.callback as (nav: AfterNavigate) => void)(navigation(type));
}

type MountOver = { search?: string; initialChatFullView?: boolean };

async function mountAt(tab: string, over: MountOver = {}) {
  at(over.search ?? `?tab=${tab}`);
  const data = {
    ...await pageData(), initialTab: tab, bootPointerAppKey: 'a1',
    initialChatFullView: over.initialChatFullView ?? false,
    // The Members tab mounts AppMembersPanel, which throws without its roster and three forms.
    members: [], membersError: false, membersWithheld: false,
    addMemberForm: await superValidate(zod4(addAppMemberSchema), { errors: false }),
    ensureMemberForm: await superValidate(zod4(ensureAppMemberSchema), { errors: false }),
    removeMemberForm: await superValidate(zod4(removeAppMemberSchema), { errors: false }),
  };
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target;
}

/** The `tab` the last URL write names: a replaceState's URL, or a goto's href. */
const lastWrittenTab = (): string | null => {
  const call = [...navigationCalls].reverse().find((c) => c.fn === 'replaceState' || c.fn === 'goto');
  if (!call) return null;
  const arg = call.args[0];
  return new URL(String(arg instanceof URL ? arg.href : arg), 'https://example.test').searchParams.get('tab');
};

describe('portal#1943: ?tab= follows the shown tab', () => {
  it('every local tab writes its own id to the URL, and pushes no history entry', async () => {
    const target = await mountAt('chats');
    const ids = [...target.querySelectorAll<HTMLElement>('[role="tab"]')].map((t) => t.id.replace(/^tab-/, ''))
      .filter((id) => id !== 'runs' && id !== 'node-role-templates' && id !== 'chats');
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) {
      resetNavigationCalls();
      target.querySelector<HTMLElement>(`#tab-${id}`)!.click();
      await tick(3);
      expect(target.querySelector(`#tab-${id}`)?.getAttribute('aria-selected'), id).toBe('true');
      expect(lastWrittenTab(), id).toBe(id);
      expect(navigationCalls.filter((c) => c.fn === 'pushState'), id).toHaveLength(0);
      expect(navigationCalls.filter((c) => c.fn === 'goto'), id).toHaveLength(0);
    }
  });

  it('returning to the default tab rewrites a stale ?tab=', async () => {
    const target = await mountAt('settings');
    resetNavigationCalls();
    target.querySelector<HTMLElement>('#tab-chats')!.click();
    await tick(3);
    expect(lastWrittenTab()).toBe('chats');
  });

  it('keeps the other query parameters when it rewrites ?tab=', async () => {
    const target = await mountAt('chats', { search: '?tab=chats&chat=chats:team' });
    resetNavigationCalls();
    target.querySelector<HTMLElement>('#tab-settings')!.click();
    await tick(3);
    const call = navigationCalls.find((c) => c.fn === 'replaceState')!;
    const url = new URL(String((call.args[0] as URL).href));
    expect(url.searchParams.get('tab')).toBe('settings');
    expect(url.searchParams.get('chat')).toBe('chats:team');
  });

  it('writes nothing when the URL already names the tab', async () => {
    const target = await mountAt('settings');
    resetNavigationCalls();
    (document.activeElement as HTMLElement | null)?.blur();
    target.querySelector<HTMLElement>('#tab-settings')!.click();
    await tick(3);
    // The click ran (focusTab moved focus to the tab) and still wrote nothing.
    expect(document.activeElement?.id).toBe('tab-settings');
    expect(navigationCalls.filter((c) => c.fn === 'replaceState')).toHaveLength(0);
  });

  it('a tab that navigates (Templates) goes by goto alone, with no second replaceState', async () => {
    const target = await mountAt('chats');
    const tab = target.querySelector<HTMLElement>('#tab-node-role-templates');
    expect(tab).not.toBeNull();
    resetNavigationCalls();
    tab!.click();
    await tick(4);
    expect(navigationCalls.filter((c) => c.fn === 'goto').map((c) => String(c.args[0]))).toEqual(['/app/apps/a1?tab=node-role-templates']);
    expect(navigationCalls.filter((c) => c.fn === 'replaceState')).toHaveLength(0);
  });

  // portal#2290 row 1 (Uma, #2289): the tab you are on is not a request to leave it.
  describe('portal#2290: clicking the active Runs tab is a no-op', () => {
    const runsSearch = '?tab=runs&page=2&status=FAILED&sort=startedAt';
    it('makes no goto and no preload, and keeps the URL and the shown tab', async () => {
      const target = await mountAt('runs', { search: runsSearch });
      resetNavigationCalls();
      target.querySelector<HTMLElement>('#tab-runs')!.click();
      await tick(4);
      expect(navigationCalls.filter((c) => c.fn === 'goto' || c.fn === 'preloadData' || c.fn === 'invalidateAll')).toEqual([]);
      expect(window.location.search).toBe(runsSearch);
      expect(target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('true');
    });
    it('from another tab, Runs still opens clean: goto exactly ?tab=runs', async () => {
      const target = await mountAt('settings');
      resetNavigationCalls();
      target.querySelector<HTMLElement>('#tab-runs')!.click();
      await tick(4);
      expect(navigationCalls.filter((c) => c.fn === 'goto').map((c) => String(c.args[0]))).toEqual(['/app/apps/a1?tab=runs']);
    });
    it('does not supersede a tab navigation already in flight', async () => {
      const target = await mountAt('runs', { search: runsSearch });
      let release!: () => void;
      navigationHooks.onGoto = () => new Promise<void>((r) => { release = r; });
      target.querySelector<HTMLElement>('#tab-node-role-templates')!.click();
      await tick(4);
      navigationHooks.onGoto = undefined;
      target.querySelector<HTMLElement>('#tab-runs')!.click();
      await tick(4);
      release();
      await tick(6);
      expect(target.querySelector('#tab-node-role-templates')?.getAttribute('aria-selected')).toBe('true');
    });
  });

  // QA on #2146: runs -> AI Team (replaceState, so SvelteKit keeps the Runs load URL) -> Templates -> Back.
  // The entry Back returns to has `?tab=staff` in the address bar but loader data that still says `runs`.
  // This SIMULATES that Back (jsdom has no router): the address bar is rewritten, then afterNavigate fires.
  it('after a simulated Back, the shown tab is the one the address bar names, not the loader\'s stale initialTab', async () => {
    const target = await mountAt('runs');
    window.history.replaceState({}, '', '/app/apps/a1?tab=staff');
    afterNavigate('popstate');
    await tick(3);
    expect(target.querySelector('#tab-staff')?.getAttribute('aria-selected')).toBe('true');
    expect(target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('false');
  });

  it('after a navigation to a URL with no ?tab=, the loader\'s tab still applies', async () => {
    const target = await mountAt('settings');
    window.history.replaceState({}, '', '/app/apps/a1');
    afterNavigate('link');
    await tick(3);
    expect(target.querySelector('#tab-settings')?.getAttribute('aria-selected')).toBe('true');
  });

  it('after a navigation to an unknown ?tab=, the loader\'s tab still applies', async () => {
    const target = await mountAt('settings');
    window.history.replaceState({}, '', '/app/apps/a1?tab=garbage');
    afterNavigate('popstate');
    await tick(3);
    expect(target.querySelector('#tab-settings')?.getAttribute('aria-selected')).toBe('true');
  });

  // portal#1943 follow-up: a URL-sync failure must not cost the reader their focus.
  it('a replaceState that throws still switches the tab and still moves focus', async () => {
    const target = await mountAt('chats');
    navigationHooks.onReplaceState = () => { throw new Error('URL not accepted'); };
    (document.activeElement as HTMLElement | null)?.blur();
    target.querySelector<HTMLElement>('#tab-settings')!.click();
    await tick(3);
    expect(target.querySelector('#tab-settings')?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement?.id).toBe('tab-settings');
  });
});

// portal#2164: `?view=full` is written by shallow replaceState too, so on Back the entry's loader snapshot
// (`initialChatFullView`) can disagree with the address bar. The address bar is the truthful side, both ways.
describe('portal#2164: ?view=full follows the address bar on Back', () => {
  const chatsUrl = '?tab=chats&chat=chats%3Ateam';
  const overlay = (t: HTMLElement) => t.querySelector('[aria-modal="true"]') !== null;

  it('the address bar says full, the loader snapshot says not: the overlay opens', async () => {
    const target = await mountAt('chats', { search: `${chatsUrl}&view=full`, initialChatFullView: false });
    window.history.replaceState({}, '', `/app/apps/a1${chatsUrl}&view=full`);
    afterNavigate('popstate');
    await tick(3);
    expect(overlay(target)).toBe(true);
  });

  it('the address bar says not full, the loader snapshot says full: the overlay closes', async () => {
    const target = await mountAt('chats', { search: chatsUrl, initialChatFullView: true });
    window.history.replaceState({}, '', `/app/apps/a1${chatsUrl}`);
    afterNavigate('popstate');
    await tick(3);
    expect(overlay(target)).toBe(false);
  });

  it('only the exact value full maximizes', async () => {
    const target = await mountAt('chats', { search: chatsUrl, initialChatFullView: true });
    window.history.replaceState({}, '', `/app/apps/a1${chatsUrl}&view=`);
    afterNavigate('popstate');
    await tick(3);
    expect(overlay(target)).toBe(false);
    window.history.replaceState({}, '', `/app/apps/a1${chatsUrl}&view=wide`);
    afterNavigate('popstate');
    await tick(3);
    expect(overlay(target)).toBe(false);
  });

  it.each(['link', 'goto', 'enter'] as const)('a %s navigation with a stale loader snapshot keeps the overlay the bar names', async (type) => {
    const target = await mountAt('chats', { search: `${chatsUrl}&view=full`, initialChatFullView: false });
    afterNavigate(type);
    await tick(3);
    expect(overlay(target)).toBe(true);
  });
});
