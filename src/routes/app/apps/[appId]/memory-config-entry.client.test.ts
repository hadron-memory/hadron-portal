import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

describe('App memory-config entry (#1749 B1)', () => {
  it('renders the node-role templates entry with preload-data off', async () => {
    setStubPage('https://example.test/app/apps/a1?tab=agents', { appId: 'a1' });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      throw new Error(`unexpected App-page fetch: ${url}`);
    }));
    const data = {
      ...await pageData(),
      appChats: [], selectedChatKey: null, teamChatMessages: [], teamChatTotal: 0,
      initialTab: 'agents', bootPointerAppKey: 'a1',
    };
    const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const link = m.target.querySelector('a[href="/app/apps/a1/node-role-templates"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('data-sveltekit-preload-data')).toBe('off');
  });
});
