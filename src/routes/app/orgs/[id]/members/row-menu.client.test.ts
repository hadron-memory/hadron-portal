/**
 * #1020: a member row's Impersonate and Remove moved into a ⋯ menu that
 * submits one hidden form per action. What must hold: each form carries the
 * PICKED member, Superforms does not cancel it (the userId is set before the
 * submit), a declined confirm submits nothing, and the menu offers only what
 * the caller may do.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhanced } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';
import {
  addOrgMemberSchema, impersonateMemberSchema, inviteMemberSchema, leaveOrgSchema,
  removeOrgMemberSchema, updateOrgMemberSchema,
} from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

const member = (id: string, name: string, role: string) => ({
  role, user: { id, name, handle: id, email: null, githubUsername: null, avatarUrl: null },
});

async function mountMembers(currentRole = 'OWNER') {
  setStubPage('https://example.test/app/orgs/org-1/members', { id: 'org-1' });
  const [addForm, updateForm, removeForm, leaveForm, impersonateForm, inviteForm] = await Promise.all(
    [addOrgMemberSchema, updateOrgMemberSchema, removeOrgMemberSchema, leaveOrgSchema, impersonateMemberSchema, inviteMemberSchema]
      .map((schema) => superValidate(zod4(schema as never), { errors: false })),
  );
  const m = mountComponent(Page as never, {
    data: {
      org: { id: 'org-1', name: 'Acme', members: [member('me', 'Me', currentRole), member('u2', 'Ada', 'CONTRIBUTOR'), member('u3', 'Bo', 'READER')] },
      currentUserId: 'me', isImpersonating: false, users: [],
      addForm, updateForm, removeForm, leaveForm, impersonateForm, inviteForm,
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

function openRow(target: HTMLElement, name: string) {
  target.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click();
  flushSync();
  return [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
}

describe('org members row ⋯ menu (#1020)', () => {
  it('an owner gets Impersonate and Remove for another member, and no menu on their own row', async () => {
    const target = await mountMembers('OWNER');
    expect(target.querySelector('button[aria-label="Actions for Me"]')).toBeNull();
    expect(openRow(target, 'Ada').map((i) => i.textContent?.trim())).toEqual(['Impersonate', 'Remove']);
  });

  it('Remove submits the hidden remove form for the PICKED member, uncancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountMembers('OWNER');
    openRow(target, 'Bo').find((i) => i.textContent?.trim() === 'Remove')!.click();
    await tick(2);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/remove');
    expect(form.querySelector<HTMLInputElement>('input[name="userId"]')!.value).toBe('u3');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('Impersonate submits the hidden impersonate form for the PICKED member', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountMembers('OWNER');
    openRow(target, 'Ada').find((i) => i.textContent?.trim() === 'Impersonate')!.click();
    await tick(2);
    const form = requestSubmit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute('action')).toBe('?/impersonate');
    expect(form.querySelector<HTMLInputElement>('input[name="userId"]')!.value).toBe('u2');
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });

  it('a declined confirm submits nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const target = await mountMembers('OWNER');
    openRow(target, 'Bo').find((i) => i.textContent?.trim() === 'Remove')!.click();
    await tick(2);
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it('a reader gets no row menus at all', async () => {
    const target = await mountMembers('READER');
    expect(target.querySelectorAll('button[aria-label^="Actions for"]').length).toBe(0);
  });
});
