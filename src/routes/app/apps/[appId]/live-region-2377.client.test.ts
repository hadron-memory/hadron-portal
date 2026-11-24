/**
 * portal#2344 / #2377: the App page's Runs ('Loading runs…') loading line is announced by a region that exists
 * empty while the panel's data is here, holds the text when it is not, and is the same element when it returns.
 * (The tab-arriving line, which Settings' sections share, is pinned in first-show-fetch.client.test.ts; the
 * Templates section took it over from its own 'Loading templates…' region.)
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData, runsPanel } from './app-page.fixture';

let m: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  m?.unmount();
  m = undefined;
  vi.unstubAllGlobals();
  resetNavigationCalls();
  window.history.replaceState({}, '', '/');
});

async function mountOn(tab: string, over: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [], total: 0, loadFailed: false }), { status: 200, headers: { 'content-type': 'application/json' } }))));
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1?tab=${tab}`);
  const base = { ...await pageData(), appChats: [], selectedChatKey: null, teamChatMessages: [], teamChatTotal: 0, initialTab: tab, bootPointerAppKey: 'a1' };
  const props = reactiveProps({ data: { ...base, ...over }, form: null } as Record<string, unknown>);
  m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(3);
  return { props, base, target: m.target };
}
const regionIn = (target: HTMLElement, panelId: string, text: string) =>
  [...target.querySelectorAll<HTMLElement>(`#${panelId} [role="status"]`)].find((r) => r.textContent?.includes(text)) ?? null;

it("Runs: 'Loading runs…' lives in one region that is empty, speaks, then is empty again", async () => {
  const panel = await runsPanel('run-1');
  const { props, base, target } = await mountOn('runs', { runsPanel: panel });
  const idle = idleStatusRegions(target.querySelector<HTMLElement>('#panel-runs')!);
  expect(idle.length, 'the region exists while the panel has its data').toBeGreaterThan(0);
  expect(regionIn(target, 'panel-runs', 'Loading runs…')).toBeNull();

  // A different signed-in principal drops the retained panel, so the panel is loading again.
  props.data = { ...base, runsPanel: null, currentUserId: 'someone-else' };
  await tick(3);
  const during = regionIn(target, 'panel-runs', 'Loading runs…');
  expect(during, 'announced').not.toBeNull();
  expect(idle).toContain(during);

  props.data = { ...base, runsPanel: panel, currentUserId: 'someone-else' };
  await tick(3);
  expect(regionIn(target, 'panel-runs', 'Loading runs…')).toBeNull();
  expect(during!.isConnected).toBe(true);
  expect(during!.textContent?.trim()).toBe('');
});
