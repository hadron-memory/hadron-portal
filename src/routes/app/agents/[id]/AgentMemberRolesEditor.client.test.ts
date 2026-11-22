/**
 * portal#1405: the editor for "which roles people can have in Apps using this
 * Agent". A manager edits the list; everyone else keeps the read-only line.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import AgentMemberRolesEditor from './AgentMemberRolesEditor.svelte';
import { updateAgentMemberRolesSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountEditor(opts: { canManage: boolean; roles?: string[]; refusal?: string }) {
  const roles = opts.roles ?? ['owner', 'member'];
  const initial = await superValidate({ roles }, zod4(updateAgentMemberRolesSchema), { errors: false, id: 'updateMemberRoles' });
  // The shape the action's setError(form, 'roles._errors') produces for an array field.
  if (opts.refusal) initial.errors = { roles: { _errors: [opts.refusal] } } as never;
  const m = mountComponent(AgentMemberRolesEditor as never, reactiveProps({ canManage: opts.canManage, roles, initial }) as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

const form = (t: HTMLElement) => t.querySelector('form[action="?/updateMemberRoles"]') as HTMLFormElement | null;
const save = (t: HTMLElement) => [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement | undefined;
const posted = (t: HTMLElement) => [...(form(t)?.querySelectorAll('input[name="roles"]') ?? [])].map((i) => (i as HTMLInputElement).value);
const removeButton = (t: HTMLElement, role: string) => t.querySelector(`button[aria-label="Remove ${role}"]`) as HTMLButtonElement | null;

// Typing and clicking are separate moments: let the typed value reach the Add button's state first.
async function type(t: HTMLElement, value: string) {
  const input = t.querySelector('input[type="text"]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
}
const addButton = (t: HTMLElement) => [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add') as HTMLButtonElement | undefined;

describe('Agent member-roles editor (portal#1405)', () => {
  it('a non-manager sees the read-only line and no editor', async () => {
    const t = await mountEditor({ canManage: false });
    expect(t.textContent).toContain('owner, member');
    expect(form(t)).toBeNull();
    expect(save(t)).toBeUndefined();
  });

  it('a manager sees the roles and Save disabled until the list changes', async () => {
    const t = await mountEditor({ canManage: true });
    expect(form(t)).not.toBeNull();
    expect(posted(t)).toEqual(['owner', 'member']);
    expect(save(t)!.disabled).toBe(true);
  });

  it('adding a role enables Save and posts exactly the new list', async () => {
    const t = await mountEditor({ canManage: true });
    await type(t, 'reviewer');
    addButton(t)!.click();
    await tick(2);
    expect(posted(t)).toEqual(['owner', 'member', 'reviewer']);
    expect(save(t)!.disabled).toBe(false);
  });

  it('removing a role posts the shorter list', async () => {
    const t = await mountEditor({ canManage: true });
    removeButton(t, 'member')!.click();
    await tick(2);
    expect(posted(t)).toEqual(['owner']);
    expect(save(t)!.disabled).toBe(false);
  });

  it('adding a role already in the list changes nothing', async () => {
    const t = await mountEditor({ canManage: true });
    await type(t, 'owner');
    addButton(t)!.click();
    await tick(2);
    expect(posted(t)).toEqual(['owner', 'member']);
    expect(save(t)!.disabled).toBe(true);
  });

  it('an empty list cannot be saved and says why in plain words', async () => {
    const t = await mountEditor({ canManage: true, roles: ['owner'] });
    removeButton(t, 'owner')!.click();
    await tick(2);
    expect(posted(t)).toEqual([]);
    expect(save(t)!.disabled).toBe(true);
    expect(t.textContent).toContain('An Agent needs at least one role.');
  });

  it('known-empty control: a non-empty list shows no at-least-one-role explanation', async () => {
    const t = await mountEditor({ canManage: true });
    expect(t.textContent).not.toContain('An Agent needs at least one role.');
  });

  it('a server refusal is shown at the field', async () => {
    const t = await mountEditor({ canManage: true, refusal: 'Role "Bad" is malformed.' });
    const alert = t.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Role "Bad" is malformed.');
  });

  it('removing a role keeps keyboard focus in the form and announces it', async () => {
    const t = await mountEditor({ canManage: true, roles: ['owner', 'member', 'reviewer'] });
    removeButton(t, 'member')!.focus();
    removeButton(t, 'member')!.click();
    await tick(3);
    // The chip that took its place holds focus, not the page body.
    expect(document.activeElement).toBe(removeButton(t, 'reviewer'));
    expect(t.querySelector('.sr-only[aria-live="polite"]')?.textContent).toContain('Removed member. 2 roles left.');
  });

  it('removing the last role hands focus to the New role field', async () => {
    const t = await mountEditor({ canManage: true, roles: ['owner'] });
    removeButton(t, 'owner')!.focus();
    removeButton(t, 'owner')!.click();
    await tick(3);
    expect(document.activeElement).toBe(t.querySelector('input[type="text"]'));
  });

  it('a duplicate Add keeps the typed text and says it is already there', async () => {
    const t = await mountEditor({ canManage: true });
    await type(t, 'owner');
    addButton(t)!.click();
    await tick(2);
    expect((t.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('owner');
    expect(t.textContent).toContain('“owner” is already in the list.');
  });

  // portal#2375: each note lands in a status region that was mounted, empty, before it appeared.
  // The editor also has an always-present sr-only status for add/remove, so pick the region by its text.
  describe('hints and results are announced in persistent live regions (#2375)', () => {
    const regionWith = (t: HTMLElement, text: string) =>
      [...t.querySelectorAll<HTMLElement>('[role="status"]')].find((r) => r.textContent?.includes(text)) ?? null;

    it('duplicate hint', async () => {
      const t = await mountEditor({ canManage: true });
      const idle = idleStatusRegions(t);
      expect(regionWith(t, 'is already in the list')).toBeNull();
      await type(t, 'owner');
      addButton(t)!.click();
      await tick(2);
      expect(idle).toContain(regionWith(t, '“owner” is already in the list.'));
    });

    it('empty list hint', async () => {
      const t = await mountEditor({ canManage: true, roles: ['owner'] });
      const idle = idleStatusRegions(t);
      expect(regionWith(t, 'An Agent needs at least one role.')).toBeNull();
      removeButton(t, 'owner')!.click();
      await tick(2);
      expect(idle).toContain(regionWith(t, 'An Agent needs at least one role.'));
    });

    it('saved', async () => {
      const t = await mountEditor({ canManage: true });
      const idle = idleStatusRegions(t);
      expect(regionWith(t, 'Roles saved.')).toBeNull();
      const result = await superValidate({ roles: ['owner', 'member'] }, zod4(updateAgentMemberRolesSchema), { errors: false, id: 'updateMemberRoles' });
      result.message = { type: 'success', text: 'Roles saved.' };
      await submitEnhancedWithResult(form(t)!, { type: 'success', status: 200, data: { form: result } });
      await tick(2);
      expect(idle).toContain(regionWith(t, 'Roles saved.'));
    });
  });

  it('shows the role format and what removal does to existing members', async () => {
    const t = await mountEditor({ canManage: true });
    expect(t.textContent).toContain('1 to 32 characters: a lowercase letter first, then lowercase letters, digits, “_” or “-”');
    expect(t.textContent).toContain('People who already have a removed role keep it.');
  });
});

// portal#1417: the whole enhanced-form lifecycle in one run: a refused save, the correction that
// clears the refusal, the retry that carries the corrected list, and the save that settles. Each
// step was pinned alone; nothing pinned that they follow one another on a live form.
describe('Agent member-roles editor: failure, correction, retry, success (portal#1417)', () => {
  const resultFor = async (roles: string[], message: { type: 'error' | 'success'; text: string }) => {
    const f = await superValidate({ roles }, zod4(updateAgentMemberRolesSchema), { errors: false, id: 'updateMemberRoles' });
    f.message = message;
    return f;
  };
  const alert = (t: HTMLElement) => t.querySelector('[role="alert"]');

  it('a refusal clears on the correction, the retry posts the corrected list, and the save settles', async () => {
    const props = reactiveProps({
      canManage: true,
      roles: ['owner', 'member'],
      initial: await superValidate({ roles: ['owner', 'member'] }, zod4(updateAgentMemberRolesSchema), { errors: false, id: 'updateMemberRoles' }),
    });
    const m = mountComponent(AgentMemberRolesEditor as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const t = m.target;

    // 1. Failure: the server refuses the list the person built.
    await type(t, 'reviewer');
    addButton(t)!.click();
    await tick(2);
    expect(posted(t)).toEqual(['owner', 'member', 'reviewer']);
    await submitEnhancedWithResult(form(t)!, {
      type: 'failure', status: 400, data: { form: await resultFor(['owner', 'member', 'reviewer'], { type: 'error', text: 'Could not save the roles.' }) },
    });
    await tick(3);
    expect(alert(t)?.textContent).toContain('Could not save the roles.');
    // The refused edit is still on the form: the person's work was not thrown away.
    expect(posted(t)).toEqual(['owner', 'member', 'reviewer']);
    expect(save(t)!.disabled).toBe(false);

    // 2. Correction: editing the list takes the stale refusal away.
    removeButton(t, 'reviewer')!.click();
    await tick(3);
    await type(t, 'auditor');
    addButton(t)!.click();
    await tick(3);
    expect(alert(t)).toBeNull();
    expect(posted(t)).toEqual(['owner', 'member', 'auditor']);

    // 3. Retry: the corrected list is what goes out, and it is refused again for a different reason.
    await submitEnhancedWithResult(form(t)!, {
      type: 'failure', status: 400, data: { form: await resultFor(['owner', 'member', 'auditor'], { type: 'error', text: 'Try again in a moment.' }) },
    });
    await tick(3);
    expect(alert(t)?.textContent).toContain('Try again in a moment.');
    expect(alert(t)?.textContent).not.toContain('Could not save the roles.');

    // 4. Success: the server saves, the page re-reads the Agent, and the form settles on the saved list.
    props.roles = ['owner', 'member', 'auditor'];
    await submitEnhancedWithResult(form(t)!, {
      type: 'success', status: 200, data: { form: await resultFor(['owner', 'member', 'auditor'], { type: 'success', text: 'Roles saved.' }) },
    });
    await tick(3);
    expect(alert(t)).toBeNull();
    expect(t.textContent).toContain('Roles saved.');
    expect(posted(t)).toEqual(['owner', 'member', 'auditor']);
    expect(save(t)!.disabled).toBe(true);
  });
});
