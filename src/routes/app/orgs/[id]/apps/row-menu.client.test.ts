/** #1020: an org app row's Manage + Delete in a ⋯ menu, Delete via one hidden form. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
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

async function mountApps() {
  setStubPage('https://example.test/app/orgs/org-1/apps', { id: 'org-1' });
  const m = mountComponent(Page as never, {
    data: {
      org: { id: 'org-1', name: 'Acme' },
      apps: [app('a1', 'Alpha'), app('a2', 'Bravo')],
      deleteForm: await superValidate(zod4(deleteOrgAppSchema), { errors: false }),
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

describe('org apps row ⋯ menu (#1020)', () => {
  it('offers Manage as a real link and Delete as a danger item', async () => {
    const target = await mountApps();
    target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Bravo"]')!.click();
    flushSync();
    const items = [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
    expect(items.map((i) => [i.tagName, i.textContent?.trim()])).toEqual([['A', 'Manage'], ['BUTTON', 'Delete']]);
    expect(items[0]!.getAttribute('href')).toBe('/app/apps/a2');
  });

  it('Delete submits the hidden delete form for the PICKED app, uncancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountApps();
    target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Bravo"]')!.click();
    flushSync();
    [...target.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.trim() === 'Delete')!.click();
    await tick(2);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/delete');
    expect(form.querySelector<HTMLInputElement>('input[name="id"]')!.value).toBe('a2');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('a declined confirm submits nothing (Cody, #1046)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountApps();
    target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Bravo"]')!.click();
    flushSync();
    [...target.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent?.trim() === 'Delete')!.click();
    await tick(2);
    expect(requestSubmit).not.toHaveBeenCalled();
  });
});
