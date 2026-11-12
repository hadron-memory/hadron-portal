import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, type ComponentProps } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import AiServiceConfigSection from './AiServiceConfigSection.svelte';
import { resetAiConfigRecoveryForTests } from './ai-config-recovery';
import type { ListPageNavigation } from '$lib/list-page';
import type { AiServiceConfig, OrgMember } from '$lib/types';

type SectionProps = ComponentProps<typeof AiServiceConfigSection>;
let mounted: Mounted<SectionProps> | undefined;
const config = (i: number): AiServiceConfig => ({
  id: `c${i}`, name: `config-${String(i).padStart(2, '0')}`, ownerType: 'APP', ownerId: 'app1',
  provider: 'glm', model: 'glm-5', endpoint: null, effectiveEndpoint: 'https://example.invalid',
  apiStyle: null, effectiveApiStyle: 'CHAT_COMPLETIONS', hasApiKey: true, apiKeyPreview: '…test',
  params: null, enabled: true, createdAt: '2026-11-11T00:00:00Z', updatedAt: null,
});
const all = Array.from({ length: 45 }, (_, i) => config(i));
// Exactly what the loader's appListNavigation(url, 'configOffset',
// 'ai-configs', …) emits (app-list-pages.ts; +page.server.ts:1034): href()
// always re-sets tab=ai-configs, and href(0) DELETES the offset key, so at
// offset 20 firstHref and previousHref (20 − PAGE_SIZE = 0) share the tab-only
// URL, and Next advances by the served page. Fixture literals, not an import
// of the helper, so the fixture cannot follow a production regression.
const page: ListPageNavigation = { offset: 20, count: 20, total: 45,
  firstHref: '/app/apps/app1?tab=ai-configs',
  previousHref: '/app/apps/app1?tab=ai-configs',
  nextHref: '/app/apps/app1?tab=ai-configs&configOffset=40' };
// A complete OrgMember/UserSummary, so prop drift stays compiler-visible.
const member: OrgMember = {
  id: 'membership-1', role: 'ADMIN', canInvite: false, createdAt: '2026-11-11T00:00:00Z',
  user: { id: 'u1', handle: 'member-one', githubUsername: null, name: 'Member One', avatarUrl: null },
};
const pager = (root: HTMLElement) => root.querySelector('nav[aria-label="AI config pages"]');
const rows = (root: HTMLElement) => root.querySelectorAll('tbody tr');
/** [label, href] for every anchor the server pager renders, in markup order. */
const navLinks = (root: HTMLElement) =>
  [...(pager(root)?.querySelectorAll('a') ?? [])].map(a => [a.textContent?.trim(), a.getAttribute('href')] as const);
const button = (root: HTMLElement, text: string) => {
  const found = [...root.querySelectorAll('button')].find(el => el.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
};
/**
 * Drain pending work after an interaction. `tick(60)` runs 60 Promise
 * microtask turns — one `await Promise.resolve()` each, flushing Svelte's
 * effect queue at the end — which is 60 TURNS, not 60 milliseconds and not 60
 * animation frames; nothing in this file waits on the clock. The
 * save/readback/refresh continuations chain several awaits each, so 60 turns
 * is sequenced headroom, and the trailing `flushSync()` re-settles synchronous
 * effects the last continuation queued.
 */
async function settle() { await tick(60); flushSync(); }
beforeEach(() => { resetAiConfigRecoveryForTests(); resetNavigationCalls(); localStorage.clear(); });
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.unstubAllGlobals(); resetNavigationCalls(); });

async function open(fresh: AiServiceConfig[] | null) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    // portal#1955 checks the fresh cookie principal before any editor write.
    if (url === '/api/ai-configs?principal=1') {
      return new Response(JSON.stringify({ principal: { principalType: 'USER', userId: 'u1', appId: null } }));
    }
    if (url.startsWith('/api/ai-configs?') && !init?.method) {
      return new Response(JSON.stringify(fresh === null ? { error: 'Unavailable' } : { configs: fresh }), { status: fresh === null ? 500 : 200 });
    }
    if (url === '/api/ai-configs' && init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      if (body.action === 'endpoints') return new Response(JSON.stringify({ endpoints: [] }));
      if (body.action === 'update') return new Response(JSON.stringify({ ok: true }));
    }
    throw new Error(`Unexpected fetch ${init?.method ?? 'GET'} ${url}`);
  }));
  const initialProps: SectionProps = {
    ownerType: 'APP', ownerId: 'app1', currentUserId: 'u1', members: [member],
    configs: all.slice(20, 40), pagination: page,
  };
  mounted = mountComponent(AiServiceConfigSection, reactiveProps(initialProps));
  await settle();
  const root = mounted.target;
  expect(rows(root)).toHaveLength(20);
  expect(pager(root)?.textContent).toContain('21–40 of 45');
  // The server page renders appListNavigation's shape at offset 20 (key
  // `configOffset`, page size 20): href(0) DELETES the key, so Previous points
  // at the tab-only URL (tab=ai-configs, no offset); First is unrendered at
  // offset ≤ 20 even with a firstHref (ListPageNav gate); Next advances by the
  // served page.
  expect(navLinks(root)).toEqual([
    ['Previous', '/app/apps/app1?tab=ai-configs'],
    ['Next', '/app/apps/app1?tab=ai-configs&configOffset=40'],
  ]);
  root.querySelector<HTMLButtonElement>('button[aria-label="Actions for config-20"]')!.click();
  flushSync();
  [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent?.trim() === 'Edit')!.click();
  await settle();
  const model = root.querySelector<HTMLInputElement>('#ac-model')!;
  model.value = 'glm-5-updated'; model.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  await vi.waitFor(() => expect(button(root, 'Save').disabled).toBe(false));
  button(root, 'Save').click();
  await settle();
  expect(root.querySelector('[data-testid="ai-config-feedback"]')?.textContent).toContain('Saved “config-20”.');
  return mounted;
}

it('pairs whole-owner mutation readback with client pagination, then restores a new loader page (#1911)', async () => {
  const fresh = [...all.map(c => c.id === 'c20' ? { ...c, model: 'glm-5-updated' } : c), config(45)];
  const m = await open(fresh);
  expect(rows(m.target)).toHaveLength(20);
  expect(pager(m.target)).toBeNull();
  expect(m.target.querySelector('[data-testid="table-footer"]')?.textContent).toContain('Page 1 of 3');
  button(m.target, 'Next').click(); await settle();
  expect(m.target.querySelector('[data-testid="table-footer"]')?.textContent).toContain('Page 2 of 3');
  expect(m.target.textContent).toContain('glm-5-updated');
  button(m.target, 'Next').click(); await settle();
  expect(rows(m.target)).toHaveLength(6);
  expect(m.target.textContent).toContain('config-45');

  // A later server load supersedes the working copy AND restores its own navigation.
  m.props.configs = fresh.slice(40);
  // appListNavigation at (offset 40, count 6, total 46): First still href(0),
  // Previous steps back one full PAGE SIZE (20, not the 6 served), and 41–46
  // of 46 is the end so there is no Next.
  m.props.pagination = { offset: 40, count: 6, total: 46,
    firstHref: '/app/apps/app1?tab=ai-configs',
    previousHref: '/app/apps/app1?tab=ai-configs&configOffset=20',
    nextHref: null };
  await settle();
  expect(pager(m.target)?.textContent).toContain('41–46 of 46');
  // The restored page carries its own server navigation in the same
  // appListNavigation shape: First (offset 40 > 20) to the key-less first
  // page, Previous back one full PAGE SIZE (not the 6 served) to offset 20,
  // and no Next — 41–46 of 46 is the end.
  expect(navLinks(m.target)).toEqual([
    ['First', '/app/apps/app1?tab=ai-configs'],
    ['Previous', '/app/apps/app1?tab=ai-configs&configOffset=20'],
  ]);
  expect(m.target.querySelector('[data-testid="table-footer"]')).toBeNull();
  expect(rows(m.target)).toHaveLength(6);
});

it('keeps the original page and its navigation together when readback fails', async () => {
  const m = await open(null);
  expect(pager(m.target)?.textContent).toContain('21–40 of 45');
  expect(rows(m.target)).toHaveLength(20);
  expect(m.target.querySelector('[data-testid="table-footer"]')).toBeNull();
  expect(m.target.textContent).not.toContain('config-00');
  expect(m.target.querySelector('[data-testid="ai-config-feedback"]')?.textContent).toContain('Reload page');
});
