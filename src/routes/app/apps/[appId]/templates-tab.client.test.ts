/**
 * #1936 — the Node-role templates App tab, mounted. The old above-breadcrumb
 * link is gone; the tab renders the same manager with the same keyed props.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';

vi.mock('$lib/components/memory-config/TemplatesManager.svelte', async () => ({
  default: (await import('$lib/test/fixtures/MemoryConfigChildRecorder.svelte')).default,
}));

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

const panel = { principalScope: 'user-1:self', ownerType: 'APP', ownerRef: 'a1', templates: [], canManage: true, readOnly: false, memories: [], memoriesFailed: false };

async function mountTab(tab: string, templatesPanel: unknown) {
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1?tab=${tab}`);
  const data = { ...await pageData(), appChats: [], selectedChatKey: null, teamChatMessages: [], teamChatTotal: 0, initialTab: tab, bootPointerAppKey: 'a1', templatesPanel };
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

describe('Node-role templates tab (#1936)', () => {
  it('is a tab of the App page, selected by ?tab=, with its own panel and the manager in it', async () => {
    const target = await mountTab('node-role-templates', panel);
    const tab = target.querySelector('#tab-node-role-templates');
    expect(tab?.getAttribute('role')).toBe('tab');
    expect(tab?.getAttribute('aria-selected')).toBe('true');
    expect(target.querySelector('#panel-node-role-templates [data-testid="memory-config-recorder"]')).not.toBeNull();
  });

  it('removes the old above-breadcrumb link to the sub-route', async () => {
    const target = await mountTab('chats', null);
    expect(target.querySelector('a[href="/app/apps/a1/node-role-templates"]')).toBeNull();
    expect(target.querySelector('#tab-node-role-templates')).not.toBeNull();
  });

  it('says it is loading, and mounts no manager, while the tab’s data is not here yet', async () => {
    const target = await mountTab('node-role-templates', null);
    expect(target.querySelector('[data-testid="memory-config-recorder"]')).toBeNull();
    expect(target.querySelector('#panel-node-role-templates [role="status"]')).not.toBeNull();
  });

  it('choosing the tab navigates to ?tab=, so the loader supplies its data (it is not loaded with the other tabs)', async () => {
    const target = await mountTab('chats', null);
    target.querySelector<HTMLElement>('#tab-node-role-templates')!.click();
    await tick(3);
    const call = navigationCalls.findLast((c) => c.fn === 'goto');
    expect(String(call?.args[0])).toBe('/app/apps/a1?tab=node-role-templates');
  });
});
