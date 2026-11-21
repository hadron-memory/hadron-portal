/**
 * #1020 (Cody's #1046 QA): the org Memories rows' Delete and the subscriptions
 * list's Unsubscribe moved into ⋯ menus that submit one hidden form each. What
 * must hold: Delete is offered only on org-owned rows, each submit carries the
 * PICKED memory, Superforms does not cancel it, and a declined confirm submits
 * nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
import { rowMenuItems } from '$lib/test/rowMenu';
import Page from './+page.svelte';
import {
  deleteOrgMemorySchema, orgMemorySubscribeSchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema,
} from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

const mem = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, urn: `hrn:mem:acme.com:${id}`, visibility: 'PRIVATE', source: null, readBranch: null,
  lastSyncedAt: null, vectorIndexEnabled: false, embeddingSource: null, ...extra,
});

async function mountMemories(initialTab: 'org' | 'subscriptions') {
  setStubPage('https://example.test/app/orgs/org-1/memories', { id: 'org-1' });
  const [subscribeForm, deleteForm, syncAllForm, unsubscribeForm] = await Promise.all(
    [orgMemorySubscribeSchema, deleteOrgMemorySchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema]
      .map((schema) => superValidate(zod4(schema as never), { errors: false })),
  );
  const m = mountComponent(Page as never, {
    data: {
      org: {
        id: 'org-1', name: 'Acme',
        memories: [mem('m1', 'Alpha'), mem('m2', 'Bravo')],
        subscriptions: [
          { role: 'reader', memory: { id: 's1', name: 'Shared One', urn: 'hrn:mem:other.com:s1', organization: { name: 'Other' } } },
          { role: 'reader', memory: { id: 's2', name: 'Shared Two', urn: 'hrn:mem:other.com:s2', organization: { name: 'Other' } } },
        ],
      },
      systemMemories: [mem('sys1', 'System Core')],
      personalMemories: [],
      availableMemories: [],
      initialTab,
      subscribeForm, deleteForm, syncAllForm, unsubscribeForm,
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

describe('org Memories row ⋯ menus (#1020)', () => {
  it('offers Delete only on org-owned rows, never on a system row', async () => {
    const target = await mountMemories('org');
    const triggers = [...target.querySelectorAll('button[aria-label^="Actions for"]')].map((b) => b.getAttribute('aria-label'));
    expect(triggers).toContain('Actions for System Core');
    // Two org rows offer Delete; the system row's menu (Edit only) does not.
    expect(rowMenuItems(target, 'Delete')).toHaveLength(2);
    expect(rowMenuItems(target, 'Edit')).toHaveLength(3);
  });

  it('Delete submits the hidden delete form for the PICKED memory, uncancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountMemories('org');
    rowMenuItems(target, 'Delete')[1]!.click();
    await tick(2);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/delete');
    expect(form.querySelector<HTMLInputElement>('input[name="id"]')!.value).toBe('m2');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('Delete with a declined confirm submits nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountMemories('org');
    rowMenuItems(target, 'Delete')[0]!.click();
    await tick(2);
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it('Unsubscribe submits the hidden unsubscribe form for the PICKED subscription, uncancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountMemories('subscriptions');
    rowMenuItems(target, 'Unsubscribe')[1]!.click();
    await tick(2);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/unsubscribe');
    expect(form.querySelector<HTMLInputElement>('input[name="memoryId"]')!.value).toBe('s2');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('Unsubscribe with a declined confirm submits nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountMemories('subscriptions');
    rowMenuItems(target, 'Unsubscribe')[0]!.click();
    await tick(2);
    expect(requestSubmit).not.toHaveBeenCalled();
  });
});


it('#1408 Org memories exposes its selected panel through the shared tab semantics', async () => {
  const target = await mountMemories('org');
  const selected = target.querySelector('[role="tab"][aria-selected="true"]');
  const panel = target.querySelector('[role="tabpanel"]');
  expect(selected).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(selected!.getAttribute('aria-controls')).toBe(panel!.id);
  expect(panel!.getAttribute('aria-labelledby')).toBe(selected!.id);
});

it('portal#2316: the Subscriptions sub-tab renders each subscription as a row of the shared DataTable', async () => {
  const target = await mountMemories('subscriptions');
  const rows = [...target.querySelectorAll('[data-testid="subscription-row"]')];
  expect(rows.map((r) => r.getAttribute('data-memory-id'))).toEqual(['s1', 's2']);
  expect(rows[0]!.textContent).toContain('Shared One');
  expect(rows[0]!.textContent).toContain('other.com:s1');
  expect(rows[0]!.textContent).toContain('reader');
  expect(rows[0]!.textContent).toContain('Other');
  expect(rowMenuItems(target, 'Unsubscribe')).toHaveLength(2);
});

