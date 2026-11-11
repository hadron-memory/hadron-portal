import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import AiServiceConfigSection from './AiServiceConfigSection.svelte';
import { resetAiConfigRecoveryForTests } from './ai-config-recovery';
import type { AiServiceConfig } from '$lib/types';

let mounted: Mounted<Record<string, unknown>> | undefined;
const config = (i: number): AiServiceConfig => ({
  id: `c${i}`, name: `config-${String(i).padStart(2, '0')}`, ownerType: 'APP', ownerId: 'app1',
  provider: 'glm', model: 'glm-5', endpoint: null, effectiveEndpoint: 'https://example.invalid',
  apiStyle: null, effectiveApiStyle: 'CHAT_COMPLETIONS', hasApiKey: true, apiKeyPreview: '…test',
  params: null, enabled: true, createdAt: '2026-11-11T00:00:00Z', updatedAt: null,
});
const all = Array.from({ length: 45 }, (_, i) => config(i));
const page = { offset: 20, count: 20, total: 45, firstHref: null,
  previousHref: '/app/apps/app1?tab=ai&configOffset=0', nextHref: '/app/apps/app1?tab=ai&configOffset=40' };
const pager = (root: HTMLElement) => root.querySelector('nav[aria-label="AI config pages"]');
const rows = (root: HTMLElement) => root.querySelectorAll('tbody tr');
const button = (root: HTMLElement, text: string) => {
  const found = [...root.querySelectorAll('button')].find(el => el.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
};
async function settle() { await tick(60); flushSync(); }
beforeEach(() => { resetAiConfigRecoveryForTests(); resetNavigationCalls(); localStorage.clear(); });
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.unstubAllGlobals(); resetNavigationCalls(); });

async function open(fresh: AiServiceConfig[] | null) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
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
  mounted = mountComponent(AiServiceConfigSection as never, reactiveProps({
    ownerType: 'APP', ownerId: 'app1', currentUserId: 'u1', members: [{ user: { id: 'u1' }, role: 'ADMIN' }],
    configs: all.slice(20, 40), pagination: page,
  }) as never) as Mounted<Record<string, unknown>>;
  await settle();
  const root = mounted.target;
  expect(rows(root)).toHaveLength(20);
  expect(pager(root)?.textContent).toContain('21–40 of 45');
  root.querySelector<HTMLButtonElement>('button[aria-label="Actions for config-20"]')!.click();
  flushSync();
  [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent?.trim() === 'Edit')!.click();
  await settle();
  const model = root.querySelector<HTMLInputElement>('#ac-model')!;
  model.value = 'glm-5-updated'; model.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
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
  expect(rows(m.target)).toHaveLength(20);
  button(m.target, 'Next').click(); await settle();
  expect(m.target.querySelector('[data-testid="table-footer"]')?.textContent).toContain('Page 2 of 3');
  expect(m.target.textContent).toContain('glm-5-updated');
  button(m.target, 'Next').click(); await settle();
  expect(rows(m.target)).toHaveLength(6);
  expect(m.target.textContent).toContain('config-45');

  // A later server load supersedes the working copy AND restores its own navigation.
  m.props.configs = fresh.slice(40);
  m.props.pagination = { ...page, offset: 40, count: 6, total: 46, nextHref: null };
  await settle();
  expect(pager(m.target)?.textContent).toContain('41–46 of 46');
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
