/**
 * #1936 (LOCAL P2) — the manager asks before a ROUTE change discards a draft; as a tab,
 * choosing another App tab is local and never reached that guard. Real manager, both directions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationGuards, navigationHooks, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
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

async function mountWithDraft() {
  setStubPage('https://example.test/app/apps/a1?tab=node-role-templates', { appId: 'a1' });
  window.history.replaceState({}, '', '/app/apps/a1?tab=node-role-templates');
  const templatesPanel = { principalScope: 'u1:self', ownerType: 'APP', ownerRef: 'a1', templates: [], canManage: true, readOnly: false, memories: [], memoriesFailed: false };
  const data = { ...await pageData(), appChats: [], selectedChatKey: null, teamChatMessages: [], teamChatTotal: 0, initialTab: 'node-role-templates', bootPointerAppKey: 'a1', templatesPanel };
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target;
}
const createTemplate = async (target: HTMLElement) => {
  [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create template')!.click();
  await tick(3);
};

describe('leaving the templates tab with an unsaved draft (#1936)', () => {
  it('declining keeps the draft and the tab', async () => {
    const target = await mountWithDraft();
    await createTemplate(target);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    target.querySelector<HTMLElement>('#tab-settings')!.click();
    await tick(3);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(target.querySelector('[aria-label="Template editor"]')).not.toBeNull();
    expect(target.querySelector('#tab-settings')?.getAttribute('aria-selected')).toBe('false');
  });

  it('accepting leaves the tab', async () => {
    const target = await mountWithDraft();
    await createTemplate(target);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    target.querySelector<HTMLElement>('#tab-settings')!.click();
    await tick(3);
    expect(target.querySelector('#tab-settings')?.getAttribute('aria-selected')).toBe('true');
    expect(target.querySelector('[aria-label="Template editor"]')).toBeNull();
  });

  it('control: with no draft, switching asks nothing', async () => {
    const target = await mountWithDraft();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    target.querySelector<HTMLElement>('#tab-settings')!.click();
    await tick(3);
    expect(confirm).not.toHaveBeenCalled();
    expect(target.querySelector('#tab-settings')?.getAttribute('aria-selected')).toBe('true');
  });

  // LOCAL P2 D1: Runs is a navigating choice. A declined route guard only cancels the router; the
  // page used to select Runs anyway and unmount the draft.
  const runGuards = (cancel: () => void) => {
    navigationHooks.onPreloadData = () => ({ type: 'loaded', data: { runsPanel: null } });
    navigationHooks.onGoto = () => {
      const event = { cancel, to: { url: new URL('/app/apps/a1?tab=runs', window.location.href) }, from: { url: new URL(window.location.href) }, type: 'goto' };
      for (const g of navigationGuards.filter((g) => g.fn === 'beforeNavigate')) (g.callback as (x: unknown) => void)(event);
    };
  };

  it('declining a navigating choice (Runs) keeps the draft and the tab, asking once', async () => {
    const target = await mountWithDraft();
    await createTemplate(target);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    runGuards(vi.fn());
    target.querySelector<HTMLElement>('#tab-runs')!.click();
    await tick(15);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(navigationCalls.some((c) => c.fn === 'goto')).toBe(false);
    expect(target.querySelector('[aria-label="Template editor"]')).not.toBeNull();
    expect(target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('false');
  });

  it('accepting a navigating choice (Runs) asks once in total: the route guard does not ask again', async () => {
    const target = await mountWithDraft();
    await createTemplate(target);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const cancel = vi.fn();
    runGuards(cancel);
    target.querySelector<HTMLElement>('#tab-runs')!.click();
    await tick(15);
    expect(navigationCalls.some((c) => c.fn === 'goto')).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('true');
  });

  it('accepting a local switch asks exactly once', async () => {
    const target = await mountWithDraft();
    await createTemplate(target);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    target.querySelector<HTMLElement>('#tab-settings')!.click();
    await tick(3);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
