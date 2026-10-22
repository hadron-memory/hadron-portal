import { expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { memoryIntegrationSchema, syncMemoryIntegrationSchema, pushMemoryIntegrationSchema } from './schema';
vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ beforeNavigate: () => {}, goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return { page: readable({ url: new URL('https://example.test/app/memories/mem-1/integrations'), params: { id: 'mem-1' }, data: {}, form: null }) };
});
import Page from './+page.svelte';

it('renders last sync with the Info date style (#1167)', async () => {
  const [form, syncForm, pushForm] = await Promise.all([
    superValidate(zod4(memoryIntegrationSchema)), superValidate(zod4(syncMemoryIntegrationSchema)), superValidate(zod4(pushMemoryIntegrationSchema)),
  ]);
  const html = render(Page, { props: { form: null, data: {
    graph: { id: 'mem-1', name: 'Memory', syncStatus: 'SYNCED', lastSyncedAt: new Date(2026, 9, 19, 12).toISOString() },
    form, syncForm, pushForm,
  } as never } }).body;
  expect(html).toContain('Oct 19, 2026');
});
