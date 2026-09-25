/**
 * #921 — the node role, read and edited, mounted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import NodeRoleValue from './NodeRoleValue.svelte';
import NodeRoleInput from './NodeRoleInput.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});
function mount(C: unknown, props: Record<string, unknown>) {
  const m = mountComponent(C as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}

describe('NodeRoleValue', () => {
  it('shows a dotted role verbatim', () => {
    const { target } = mount(NodeRoleValue, { role: 'spec.feature' });
    expect(target.querySelector('[data-testid="node-role"]')!.textContent).toBe('spec.feature');
  });

  it('keeps a custom role\'s case', () => {
    const { target } = mount(NodeRoleValue, { role: 'Team.Custom' });
    expect(target.querySelector('[data-testid="node-role"]')!.textContent).toBe('Team.Custom');
  });

  it('says "Not set" for a null or empty role, never a derived one', () => {
    for (const role of [null, undefined, '']) {
      const { target } = mount(NodeRoleValue, { role });
      expect(target.querySelector('[data-testid="node-role"]')).toBeNull();
      expect(target.querySelector('[data-testid="node-role-unset"]')!.textContent).toBe('Not set');
    }
  });
});

describe('NodeRoleInput', () => {
  it('is a labelled, described text input carrying the seed it opened with', async () => {
    const { target } = mount(NodeRoleInput, { value: 'spec', seed: 'spec' });
    await tick();
    const input = target.querySelector<HTMLInputElement>('input#editRole')!;
    expect(input.name).toBe('role');
    expect(input.value).toBe('spec');
    expect(target.querySelector('label[for="editRole"]')!.textContent?.trim()).toBe('Role');
    expect(input.getAttribute('aria-describedby')).toBe('editRoleHelp');
    expect(target.querySelector('#editRoleHelp')!.textContent).toContain('empty it to clear');
    const seed = target.querySelector<HTMLInputElement>('input[type="hidden"][name="roleSeed"]')!;
    expect(seed.value).toBe('spec');
  });

  it('suggests roles without restricting them: a free-text input with a datalist', async () => {
    const { target } = mount(NodeRoleInput, { value: '', seed: '' });
    await tick();
    const input = target.querySelector<HTMLInputElement>('input#editRole')!;
    expect(input.type).toBe('text');
    expect(input.getAttribute('list')).toBe('nodeRoleSuggestions');
    expect([...target.querySelectorAll('#nodeRoleSuggestions option')].map((o) => o.getAttribute('value'))).toEqual(['spec', 'review']);
    // No pattern, no maxlength, no select: any open-string role can be typed.
    expect(input.hasAttribute('pattern')).toBe(false);
    expect(target.querySelector('select')).toBeNull();
  });
});
