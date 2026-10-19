/** portal#1068: the org Apps "Active keys" column never turns an unknown count into 0. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';
import { deleteOrgAppSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

const app = (id: string, name: string) => ({
  id, name, urn: `hrn:app:acme.com:${id}`, appType: 'WORKSTATION', createdAt: '2026-10-01T00:00:00.000Z',
  agent: null, agents: [], memberCount: 1, surfaces: [],
});

async function mountColumn(keyCounts: Record<string, unknown>) {
  setStubPage('https://example.test/app/orgs/org-1/apps', { id: 'org-1' });
  const m = mountComponent(Page as never, {
    data: {
      org: { id: 'org-1', name: 'Acme' },
      apps: [app('a1', 'Alpha'), app('a2', 'Bravo'), app('a3', 'Charlie'), app('a4', 'Delta'), app('a5', 'Echo')],
      keyCounts,
      deleteForm: await superValidate(zod4(deleteOrgAppSchema), { errors: false }),
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

const cells = (target: Element) => {
  const headers = [...target.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
  const col = headers.findIndex((h) => h.startsWith('Active keys'));
  return [...target.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td')[col]?.textContent?.trim() ?? null);
};

describe('org apps Active keys column (portal#1068)', () => {
  it('renders a real count (including a real zero) only from ok; the rest is a dash', async () => {
    const target = await mountColumn({
      a1: { kind: 'ok', count: 3 }, a2: { kind: 'ok', count: 0 }, a3: { kind: 'hidden' }, a4: { kind: 'failed' }, a5: { kind: 'unknown' },
    });
    expect(cells(target)).toEqual(['3', '0', '—', '—', '—']);
  });
  it('a hidden count says who may see it, and says nothing about whether keys exist', async () => {
    const target = await mountColumn({ a1: { kind: 'hidden' } });
    const dash = [...target.querySelectorAll('[title]')].map((e) => e.getAttribute('title'));
    expect(dash).toContain('Only the App’s managers can see its keys.');
  });
  it('does not throw when the page has no keyCounts at all', async () => {
    const target = await mountColumn(undefined as never);
    expect(cells(target)).toEqual(['—', '—', '—', '—', '—']);
  });
});
