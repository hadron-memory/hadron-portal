/**
 * portal#2308 — the title's unlabelled tab IS the page's default tab.
 *
 * #2292 left the tab that leads with no label as a hard-coded `'chats'`. #2241 may change the default, and
 * nothing tied the two together. Here the loader's DEFAULT_TAB is swapped for another tab: the tab opened
 * with no `?tab=` must then be the unlabelled one, and Chats must take a label. A title constant that
 * stays on `'chats'` fails both.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';
import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from './schema';

vi.mock('./first-screen', async (orig) => ({ ...(await orig<typeof import('./first-screen')>()), DEFAULT_TAB: 'memory' }));

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

async function mountAtDefault() {
  setStubPage('https://example.test/app/apps/a1', { appId: 'a1' });
  window.history.replaceState({}, '', '/app/apps/a1');
  const base = await pageData();
  const data = {
    ...base,
    app: { ...base.app, name: 'Acme Mealplan' },
    org: { id: 'o1', name: 'Acme' },
    initialTab: null, bootPointerAppKey: 'a1', initialChatFullView: false,
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

describe('portal#2308: the title follows the default tab', () => {
  it('leaves the default tab unlabelled and labels Chats once it is not the default', async () => {
    const target = await mountAtDefault();
    expect(document.title).toBe(TAIL);
    target.querySelector<HTMLElement>('#tab-chats')!.click();
    await tick(15);
    expect(document.title).toBe(`Chats · ${TAIL}`);
  });
});
