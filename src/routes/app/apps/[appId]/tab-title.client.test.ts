/**
 * portal#2292 — the App page's document title names the shown tab, first.
 *
 * The tabs are client-switched, so one static `<title>` made browser tabs, history entries and
 * screen-reader page announcements identical on every tab. The tab with no `?tab=` (Chats) keeps
 * the title the page always had; every other client-switched tab leads with its own label.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
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
  document.title = '';
});

const TAIL = 'Acme Mealplan · Apps · Acme · Hadron';

async function mountAt(tab: string | null, over: { org?: boolean } = {}) {
  const search = tab ? `?tab=${tab}` : '';
  setStubPage(`https://example.test/app/apps/a1${search}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1${search}`);
  const base = await pageData();
  const data = {
    ...base,
    app: { ...base.app, name: 'Acme Mealplan' },
    org: over.org === false ? null : { id: 'o1', name: 'Acme' },
    initialTab: tab, bootPointerAppKey: 'a1', initialChatFullView: false,
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

const labelOf = (target: HTMLElement, id: string) => target.querySelector(`#tab-${id}`)!.textContent!.trim();
const select = async (target: HTMLElement, id: string) => { target.querySelector<HTMLElement>(`#tab-${id}`)!.click(); await tick(15); };
const clientTabIds = (target: HTMLElement) =>
  [...target.querySelectorAll<HTMLElement>('[role="tab"]')].map((t) => t.id.replace(/^tab-/, ''));

describe('portal#2292: the document title leads with the shown tab', () => {
  it('names the named tabs exactly', async () => {
    const target = await mountAt(null);
    for (const [id, label] of [['runs', 'Runs'], ['memory', 'Memories'], ['settings', 'Settings'], ['staff', 'Team']] as const) {
      await select(target, id);
      expect(document.title, id).toBe(`${label} · ${TAIL}`);
    }
    // The Human team view has no tab of its own (a toggle inside Team), and the title still says Team.
    [...target.querySelectorAll<HTMLElement>('[role="group"][aria-label="Team view"] button')][1].click();
    await tick(15);
    expect(document.title, 'members').toBe(`Team · ${TAIL}`);
  });

  it('gives every tab its own label, so a new tab cannot ship without a title', async () => {
    const target = await mountAt(null);
    const ids = clientTabIds(target).filter((id) => id !== 'profile');
    // A floor, not a count: it fails if the strip loses tabs wholesale (App Keys, AI Service Configs and Node-role templates left it for Settings).
    expect(ids.length).toBeGreaterThanOrEqual(6);
    for (const id of ids) {
      await select(target, id);
      expect(document.title, id).toBe(`${labelOf(target, id)} · ${TAIL}`);
    }
  });

  it('keeps today’s title on the tab with no ?tab=, and returns to it', async () => {
    const target = await mountAt(null);
    expect(document.title).toBe(TAIL);
    await select(target, 'memory');
    expect(document.title).toBe(`Memories · ${TAIL}`);
    await select(target, 'profile');
    expect(document.title).toBe(TAIL);
  });

  it('follows activeTab through Runs, Memories and back, not the first load', async () => {
    const target = await mountAt(null);
    await select(target, 'runs');
    expect(document.title).toBe(`Runs · ${TAIL}`);
    await select(target, 'memory');
    expect(document.title).toBe(`Memories · ${TAIL}`);
    await select(target, 'runs');
    expect(document.title).toBe(`Runs · ${TAIL}`);
  });

  it('loads a deep link with the tab’s title', async () => {
    await mountAt('runs');
    expect(document.title).toBe(`Runs · ${TAIL}`);
  });

  it('omits the org segment when there is no org', async () => {
    const target = await mountAt(null, { org: false });
    expect(document.title).toBe('Acme Mealplan · Apps · Hadron');
    await select(target, 'runs');
    expect(document.title).toBe('Runs · Acme Mealplan · Apps · Hadron');
  });

  it('adds no history entry for a local tab switch', async () => {
    const target = await mountAt(null);
    resetNavigationCalls();
    await select(target, 'memory');
    expect(navigationCalls.filter((c) => c.fn === 'pushState' || c.fn === 'goto')).toHaveLength(0);
  });
});
