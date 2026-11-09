import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals(); vi.restoreAllMocks(); resetNavigationCalls(); resetNavigationGuards();
  localStorage.clear(); window.history.replaceState({}, '', '/');
});
async function mountPage(tab: string, extra: Record<string, unknown>) {
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1?tab=${tab}`);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ views: [], endpoints: [] }), { headers: { 'Content-Type': 'application/json' } })));
  const data = { ...await pageData(), appChats: [], selectedChatKey: null, initialTab: tab, bootPointerAppKey: 'a1', ...extra };
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m); await tick(3); return m.target;
}
it('worklog continuation is a real link and an older page never claims to be the latest window', async () => {
  const nextHref = '/app/apps/a1?tab=worklog&worklogOffset=40&worklogRef=example%2Fproject%231';
  const root = await mountPage('worklog', {
    worklog: [{ nodeId: 'n21', sessionId: 's21', workerName: 'Synthetic', workerId: null, tool: 'github', kind: 'pr', ref: 'example/project#1', action: 'opened', at: '2026-11-09T00:00:00Z', detail: null, model: null }],
    worklogTotal: 41, worklogFilters: { ref: 'example/project#1', kind: '', tool: '' },
    worklogPage: { offset: 20, total: 41, previousHref: '/app/apps/a1?tab=worklog', nextHref },
  });
  const next = root.querySelector<HTMLAnchorElement>('nav[aria-label="Worklog pages"] a[rel="next"]');
  expect(next).not.toBeNull(); expect(next!.getAttribute('href')).toBe(nextHref);
  expect(root.textContent).not.toContain('Showing the most recent');
});
it('config continuation remains reachable, but cannot navigate away from an open create form', async () => {
  const nextHref = '/app/apps/a1?tab=ai-configs&configOffset=20';
  const root = await mountPage('ai-configs', {
    org: { id: 'org-a', name: 'Org', urn: 'hrn:org:example.test:demo', members: [{ role: 'ADMIN', user: { id: 'u1' } }] },
    appConfigs: [], configsPage: { offset: 0, total: 201, previousHref: null, nextHref },
  });
  const nav = () => root.querySelector('nav[aria-label="AI config pages"]');
  expect(nav()).not.toBeNull(); expect(nav()!.querySelector('a[rel="next"]')?.getAttribute('href')).toBe(nextHref);
  const add = [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Add config');
  expect(add).toBeDefined(); add!.click(); await tick(2);
  expect(root.querySelector('#ac-name')).not.toBeNull();
  expect(nav()!.querySelector('a[rel="next"]')).toBeNull();
  const cancel = [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Cancel');
  expect(cancel).toBeDefined(); cancel!.click(); await tick(2);
  expect(nav()!.querySelector('a[rel="next"]')?.getAttribute('href')).toBe(nextHref);
});
