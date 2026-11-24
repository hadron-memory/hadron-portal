/**
 * #1936 — the Node-role templates App tab, mounted. The old above-breadcrumb
 * link is gone; the tab renders the same manager with the same keyed props.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
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

// `undefined` leaves the key out, as a load that did not read the templates does; `null` is a read that came back empty.
async function mountTab(tab: string, templatesPanel: unknown) {
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1?tab=${tab}`);
  const data = { ...await pageData(), appChats: [], selectedChatKey: null, teamChatMessages: [], teamChatTotal: 0, initialTab: tab, bootPointerAppKey: 'a1', templatesPanel } as Record<string, unknown>;
  // The fixture carries every tab's reads; a load that did not read the templates has no such key at all.
  if (templatesPanel === undefined) delete data.templatesPanel;
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

describe('Node-role templates section of Settings (#1936)', () => {
  it('is a folded section of Settings, opened by the retired ?tab= link, with the manager in it', async () => {
    const target = await mountTab('node-role-templates', panel);
    expect(target.querySelector('#tab-node-role-templates')).toBeNull();
    expect(target.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('tab-settings');
    expect(target.querySelector('#section-node-role-templates-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(target.querySelector('#section-node-role-templates-body [data-testid="memory-config-recorder"]')).not.toBeNull();
  });

  it('starts folded in Settings and mounts no manager until the reader opens it', async () => {
    const target = await mountTab('settings', panel);
    const toggle = target.querySelector<HTMLButtonElement>('#section-node-role-templates-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(target.querySelector('[data-testid="memory-config-recorder"]')).toBeNull();
    toggle.click();
    await tick(3);
    expect(target.querySelector('#section-node-role-templates-body [data-testid="memory-config-recorder"]')).not.toBeNull();
  });

  it('removes the old above-breadcrumb link to the sub-route, and the tab', async () => {
    const target = await mountTab('chats', null);
    expect(target.querySelector('a[href="/app/apps/a1/node-role-templates"]')).toBeNull();
    expect(target.querySelector('#tab-node-role-templates')).toBeNull();
  });

  it('says it is loading, and mounts no manager, while the section’s data is not here yet', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    try {
      const target = await mountTab('node-role-templates', undefined);
      expect(target.querySelector('[data-testid="memory-config-recorder"]')).toBeNull();
      expect(target.querySelector('#section-node-role-templates-body')?.textContent).toContain('Loading');
    } finally { vi.unstubAllGlobals(); }
  });

  it('is read through the tab endpoint when opened, not through a navigation', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetched.push(String(url));
      return new Response(JSON.stringify({ templatesPanel: panel }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    try {
      const target = await mountTab('settings', undefined);
      resetNavigationCalls();
      target.querySelector<HTMLButtonElement>('#section-node-role-templates-toggle')!.click();
      await wait(0); await tick(6);
      expect(fetched.some((u) => u.includes('/tab?') && u.includes('tab=node-role-templates')), JSON.stringify(fetched)).toBe(true);
      expect(navigationCalls.filter((c) => c.fn === 'goto')).toEqual([]);
      expect(target.querySelector('#section-node-role-templates-body [data-testid="memory-config-recorder"]')).not.toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});
