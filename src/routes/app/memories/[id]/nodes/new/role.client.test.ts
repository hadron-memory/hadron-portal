/**
 * #1670: the role field on the New-node page. A manager (the only caller who
 * can read Memory.config) sees the declared roles with disabled / OWNER rules
 * marked; everyone else keeps the plain suggestions. Suggestions only fill the
 * field and never reject a value.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { createNodeSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const rule = (role: string, over: Record<string, unknown> = {}) => ({
  role, enabled: true, writers: 'ALL', strictSubRoles: false, descriptionNode: null, descriptionNodeState: 'NONE', ...over,
});

async function mountPage(roleRules: unknown, formOver: Record<string, unknown> = {}) {
  const form = await superValidate(formOver, zod4(createNodeSchema), { errors: false });
  const m = mountComponent(Page as never, {
    data: {
      graph: { id: 'm1', name: 'Test memory', urn: 'hrn:mem:acme:docs', schema: null },
      org: null, parentLoc: '', existingLocs: [], siblingsPartial: false, prefillLoc: '', roleRules, form,
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}

const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};

describe('New node: role field (#1670)', () => {
  it('has a Role input named role, empty by default', async () => {
    const t = await mountPage(null);
    const input = t.querySelector<HTMLInputElement>('input[name="role"]')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('');
    expect(t.querySelector('label[for="createRole"]')?.textContent?.trim()).toBe('Role');
  });

  it('a non-manager (no rules) gets the plain suggestions and no declared list', async () => {
    const t = await mountPage(null);
    expect(t.querySelector('[data-testid="create-role-declared"]')).toBeNull();
    expect([...t.querySelectorAll('#createRoleSuggestions option')].map((o) => (o as HTMLOptionElement).value)).toEqual(['spec', 'review']);
  });

  it('a manager gets the declared list INSTEAD of the plain datalist; a manager of a memory with no rules keeps the plain one', async () => {
    const withRules = await mountPage([rule('spec')]);
    expect(withRules.querySelector('#createRoleSuggestions')).toBeNull();
    expect(withRules.querySelector('input[name="role"]')?.hasAttribute('list')).toBe(false);
    const noRules = await mountPage([]);
    expect(noRules.querySelector('[data-testid="create-role-declared"]')).toBeNull();
    expect(noRules.querySelector('input[name="role"]')?.getAttribute('list')).toBe('createRoleSuggestions');
  });

  it('a manager sees every declared role, nested included, as buttons', async () => {
    const t = await mountPage([rule('spec', { strictSubRoles: true }), rule('spec.feature'), rule('spec.feature.ui')]);
    const buttons = [...t.querySelectorAll('[data-testid="create-role-declared"] button')].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['spec', 'spec.feature', 'spec.feature.ui']);
  });

  it('marks a disabled rule and an OWNER-writers rule, and does not hide them', async () => {
    const t = await mountPage([rule('a', { enabled: false }), rule('b', { writers: 'OWNER' }), rule('c')]);
    const items = [...t.querySelectorAll('[data-testid="create-role-declared"] li')];
    expect(items).toHaveLength(3);
    expect(items[0].querySelector('[data-testid="role-disabled"]')).not.toBeNull();
    expect(items[1].querySelector('[data-testid="role-refuses-all"]')).not.toBeNull();
    expect(items[2].querySelector('[data-testid="role-disabled"], [data-testid="role-refuses-all"]')).toBeNull();
  });

  it('a disabled OWNER row says the rule is disabled and never that it refuses every write', async () => {
    const t = await mountPage([rule('lone', { enabled: false, writers: 'OWNER' }), rule('on', { writers: 'OWNER' })]);
    const items = [...t.querySelectorAll('[data-testid="create-role-declared"] li')];
    expect(items[0].querySelector('[data-testid="role-disabled"]')).not.toBeNull();
    expect(items[0].querySelector('[data-testid="role-refuses-all"]')).toBeNull();
    expect(items[0].textContent).not.toContain('Refuses every write');
    expect(items[1].querySelector('[data-testid="role-refuses-all"]')).not.toBeNull();
  });

  it('a disabled OWNER row under an enabled ALL ancestor still claims no refusal and stays suggested', async () => {
    const t = await mountPage([rule('p', { strictSubRoles: true }), rule('p.c', { enabled: false, writers: 'OWNER' })]);
    const items = [...t.querySelectorAll('[data-testid="create-role-declared"] li')];
    expect(items.map((i) => i.querySelector('button')?.textContent?.trim())).toEqual(['p', 'p.c']);
    expect(items[1].querySelector('[data-testid="role-refuses-all"]')).toBeNull();
  });

  it('shows a description link only when the server says it is readable', async () => {
    const t = await mountPage([
      rule('a', { descriptionNode: 'hrn:node:acme:docs:roles:a', descriptionNodeState: 'OK' }),
      rule('b', { descriptionNode: 'hrn:node:acme:docs:roles:b', descriptionNodeState: 'UNREADABLE' }),
    ]);
    const items = [...t.querySelectorAll('[data-testid="create-role-declared"] li')];
    expect(items[0].textContent).toContain('docs:roles:a');
    expect(items[1].textContent).not.toContain('roles:b');
  });

  it('clicking a suggestion fills the field; typing anything else is untouched (no closing, no lower-casing)', async () => {
    const t = await mountPage([rule('spec.feature')]);
    const input = t.querySelector<HTMLInputElement>('input[name="role"]')!;
    t.querySelector<HTMLButtonElement>('[data-testid="create-role-declared"] button')!.click();
    flushSync();
    expect(input.value).toBe('spec.feature');
    type(input, 'Not.Declared');
    expect(input.value).toBe('Not.Declared');
  });

  it('a manager typing a value that matches a declared role only lower-cased gets the case hint; the value is not rewritten', async () => {
    const t = await mountPage([rule('spec.feature')]);
    const input = t.querySelector<HTMLInputElement>('input[name="role"]')!;
    expect(t.querySelector('[data-testid="create-role-case-hint"]')).toBeNull();
    type(input, 'Spec.Feature');
    const hint = t.querySelector('[data-testid="create-role-case-hint"]');
    expect(hint?.textContent).toContain('spec.feature');
    expect(input.value).toBe('Spec.Feature');
    type(input, 'spec.feature');
    expect(t.querySelector('[data-testid="create-role-case-hint"]')).toBeNull();
  });

  it('a non-manager gets no case hint (no rulebook shown)', async () => {
    const t = await mountPage(null);
    type(t.querySelector<HTMLInputElement>('input[name="role"]')!, 'Spec.Feature');
    expect(t.querySelector('[data-testid="create-role-case-hint"]')).toBeNull();
  });

  it('keeps a role that came back with a refused form', async () => {
    const t = await mountPage(null, { name: 'Keep', loc: 'keep', role: 'spec.nope' });
    expect(t.querySelector<HTMLInputElement>('input[name="role"]')!.value).toBe('spec.nope');
  });
});
