/**
 * portal#1405: the editor for "which roles people can have in Apps using this
 * Agent". A manager edits the list; everyone else keeps the read-only line.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
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
});
