/**
 * portal#2292 — the tab name leads the document title.
 *
 * The App page switches tabs by client state, so one `<title>` served every tab and browser tabs, history
 * entries and screen readers could not tell Runs from Memory. The shown tab's label now leads the title; the
 * tab a plain App URL (no `?tab=`) opens keeps today's string.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationHooks, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
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

async function mountAt(tab: string | null, org: { id: string; name: string } | null = { id: 'o1', name: 'Acme' }) {
  const search = tab ? `?tab=${tab}` : '';
  setStubPage(`https://example.test/app/apps/a1${search}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1${search}`);
  const base = await pageData();
  const data = {
    ...base, initialTab: tab, bootPointerAppKey: 'a1', initialChatFullView: false,
    app: { ...base.app, name: 'Acme Mealplan' }, org,
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

const KEPT = 'chats';
const TAIL = 'Acme Mealplan · Apps · Acme · Hadron';

async function select(target: HTMLElement, id: string) {
  // Runs and Templates navigate by preloadData + goto before the tab lands; the stubs resolve at once.
  navigationHooks.onPreloadData = () => ({ type: 'loaded', data: {} });
  target.querySelector<HTMLElement>(`#tab-${id}`)!.click();
  await tick(8);
  expect(target.querySelector(`#tab-${id}`)?.getAttribute('aria-selected'), `${id} shown`).toBe('true');
}

describe('portal#2292: document.title follows the shown tab', () => {
  it('names the exact title for the pinned tabs', async () => {
    const target = await mountAt(null);
    expect(document.title).toBe(TAIL);
    for (const [id, label] of [['runs', 'Runs'], ['memory', 'Memory'], ['settings', 'Settings'], ['staff', 'AI Team']] as const) {
      await select(target, id);
      expect(document.title, id).toBe(`${label} · ${TAIL}`);
    }
  });

  it('every client-switched tab leads with its own strip label (a new tab cannot ship untitled)', async () => {
    const target = await mountAt(null);
    const tabs = [...target.querySelectorAll<HTMLElement>('[role="tab"]')]
      .map((el) => ({ id: el.id.replace(/^tab-/, ''), label: (el.textContent ?? '').trim() }));
    expect(tabs.length).toBeGreaterThanOrEqual(8);
    for (const { id, label } of tabs) {
      await select(target, id);
      expect(document.title, id).toBe(id === KEPT ? TAIL : `${label} · ${TAIL}`);
    }
  });

  it('follows activeTab on every switch, not the first load', async () => {
    const target = await mountAt(null);
    await select(target, 'runs');
    expect(document.title).toBe(`Runs · ${TAIL}`);
    await select(target, 'memory');
    expect(document.title).toBe(`Memory · ${TAIL}`);
    await select(target, 'runs');
    expect(document.title).toBe(`Runs · ${TAIL}`);
    await select(target, KEPT);
    expect(document.title).toBe(TAIL);
  });

  it('a deep link ?tab=runs loads with the Runs title', async () => {
    await mountAt('runs');
    expect(document.title).toBe(`Runs · ${TAIL}`);
  });

  it('omits the org segment when there is no org', async () => {
    const target = await mountAt(null, null);
    expect(document.title).toBe('Acme Mealplan · Apps · Hadron');
    await select(target, 'runs');
    expect(document.title).toBe('Runs · Acme Mealplan · Apps · Hadron');
  });

  it('a tab switch is title only: no history entry', async () => {
    const target = await mountAt(null);
    resetNavigationCalls();
    await select(target, 'memory');
    expect(navigationCalls.filter((c) => c.fn === 'pushState')).toHaveLength(0);
    expect(navigationCalls.filter((c) => c.fn === 'goto')).toHaveLength(0);
  });
});
