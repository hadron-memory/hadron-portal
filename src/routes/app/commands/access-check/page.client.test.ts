/**
 * portal#2316: the Grants result renders through the shared DataTable (same
 * rows as the hand-rolled table it replaced), and the empty state is unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';
import { accessCheckSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountResult(grants: Array<{ source: string; role: string; via: string | null }>) {
  setStubPage('https://example.test/app/commands/access-check', {});
  const f = await superValidate(zod4(accessCheckSchema as never), { errors: false });
  const result = {
    user: { id: 'u1', handle: 'ada', name: 'Ada', email: null },
    resourceUrn: 'hrn:mem:acme.com:notes', resourceKind: 'memory', role: 'reader',
    canRead: true, canWrite: false, canManage: false, canDelete: false,
    grants,
  };
  const m = mountComponent(Page as never, { data: { form: f }, form: { form: f, result } } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

describe('access-check Grants (#2316)', () => {
  it('renders each grant as a DataTable row with source, role and via', async () => {
    const target = await mountResult([
      { source: 'org:acme', role: 'reader', via: null },
      { source: 'app:x', role: 'writer', via: 'team-a' },
    ]);
    const rows = [...target.querySelectorAll('[data-testid="access-check-grant-row"]')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('org:acme');
    expect(rows[0]!.textContent).toContain('—');
    expect(rows[1]!.textContent).toContain('writer');
    expect(rows[1]!.textContent).toContain('team-a');
  });

  it('keeps the empty-state text when there are no grants', async () => {
    const target = await mountResult([]);
    expect(target.textContent).toContain('No grants');
    expect(target.querySelector('[data-testid="access-check-grant-row"]')).toBeNull();
  });
});
