/**
 * portal#1943 — the address bar names the shown tab.
 *
 * Only Runs and Templates navigate on click; every other tab was local state, so after leaving Runs the
 * URL kept a stale `?tab=runs` and a reload landed on the wrong tab. Each tab switch now writes `?tab=<id>`
 * by `replaceState` (no history entry), the same mechanism `?chat=` and `?view=` use on this page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

async function mountAt(tab: string) {
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1?tab=${tab}`);
  const data = { ...await pageData(), initialTab: tab, bootPointerAppKey: 'a1' };
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
    setStubPage('https://example.test/app/apps/a1?tab=chats&chat=chats:team', { appId: 'a1' });
    const target = await mountAt('chats');
    window.history.replaceState({}, '', '/app/apps/a1?tab=chats&chat=chats:team');
    resetNavigationCalls();
    target.querySelector<HTMLElement>('#tab-settings')!.click();
    await tick(3);
    const call = navigationCalls.find((c) => c.fn === 'replaceState')!;
    const url = new URL(String((call.args[0] as URL).href));
    expect(url.searchParams.get('tab')).toBe('settings');
    expect(url.searchParams.get('chat')).toBe('chats:team');
  });
});
