import { describe, it, expect } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { submitEnhancedWithResult, resetKitAppliedResults } from '$lib/test/stubs/app-forms';
import { attachAppMemorySchema, createOwnAppMemorySchema } from './schema';
import AppMemories from './AppMemories.svelte';

async function props(extra: Record<string, unknown> = {}) {
  const attachForm = await superValidate({}, zod4(attachAppMemorySchema), { id: 'attachAppMemory:a', errors: false });
  const ownForm = await superValidate({}, zod4(createOwnAppMemorySchema), { id: 'createOwnAppMemory:a', errors: false });
  return { memories: [], appId: 'a', agentId: 'ag1', hasAgent: true, canCreate: false, attachForm, ownForm, result: null, ...extra } as never;
}
const open = async (m: ReturnType<typeof mountComponent>) => { (m.target.querySelector('[data-testid=app-memory-add]') as HTMLElement).click(); await tick(); };
const ownButtons = (m: ReturnType<typeof mountComponent>) => [...m.target.querySelectorAll('[data-testid^=app-memory-own-]')].map(b => b.getAttribute('data-testid'));

describe('portal#2634 own memory in the Add memory dialog', () => {
  it.each([
    [['personal', 'private'], ['app-memory-own-personal', 'app-memory-own-private']],
    [['personal'], ['app-memory-own-personal']],
    [['private'], ['app-memory-own-private']],
    [[], []],
    [null, []],
  ])('offers exactly the classes the server lists: %j', async (classes, expected) => {
    const m = mountComponent(AppMemories as never, await props({ ownClasses: classes }));
    try { await open(m); expect(ownButtons(m)).toEqual(expected); } finally { m.unmount(); }
  });
  it('a click posts the chosen class and the App\'s Agent to createOwnMemory, and closes the dialog', async () => {
    const m = mountComponent(AppMemories as never, await props({ ownClasses: ['personal', 'private'] }));
    try {
      await open(m);
      (m.target.querySelector('[data-testid=app-memory-own-private]') as HTMLElement).click();
      await tick(3);
      const form = m.target.querySelector('form[action="?/createOwnMemory"]')!;
      expect((form.querySelector('[name=memoryClass]') as HTMLInputElement).value).toBe('private');
      expect((form.querySelector('[name=agentId]') as HTMLInputElement).value).toBe('ag1');
      expect(m.target.querySelector('[data-testid=app-memory-add-dialog]')).toBeNull();
      // no name or address field anywhere in it
      expect(form.querySelector('input:not([type=hidden])')).toBeNull();
    } finally { m.unmount(); }
  });
  it('with no installed Agent a class press does nothing', async () => {
    const m = mountComponent(AppMemories as never, await props({ ownClasses: ['personal'], hasAgent: false, agentId: null }));
    try {
      await open(m);
      (m.target.querySelector('[data-testid=app-memory-own-personal]') as HTMLElement).click();
      await tick(2);
      expect(m.target.querySelector('[data-testid=app-memory-add-dialog]')).not.toBeNull();
    } finally { m.unmount(); }
  });
  it('a success shows the server\'s name and URN once, and a refusal shows its own message', async () => {
    const ownForm = await superValidate({}, zod4(createOwnAppMemorySchema), { id: 'createOwnAppMemory:a', errors: false });
    const m = mountComponent(AppMemories as never, await props({ ownClasses: ['personal'] }));
    try {
      await open(m);
      (m.target.querySelector('[data-testid=app-memory-own-personal]') as HTMLElement).click();
      await tick(3);
      const form = m.target.querySelector('form[action="?/createOwnMemory"]') as HTMLFormElement;
      const created = { id: 'm9', urn: 'hrn:mem:alice:tutor-alice-private-2', name: 'tutor-alice-private-2' };
      await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { form: { ...ownForm, valid: true, posted: true, data: { _kind: 'createOwnAppMemory', memoryClass: 'personal', agentId: 'ag1' }, message: { type: 'success', text: 'Memory created.', created } } } });
      await tick(3);
      const region = m.target.querySelector('[role=status]')!;
      expect(region.textContent).toContain('tutor-alice-private-2');
      expect(region.querySelector('a')?.getAttribute('href')).toBe('/app/memories/m9');
      expect(region.querySelectorAll('[title="hrn:mem:alice:tutor-alice-private-2"]').length).toBe(1);
      await open(m);
      (m.target.querySelector('[data-testid=app-memory-own-personal]') as HTMLElement).click();
      await tick(3);
      await submitEnhancedWithResult(form, { type: 'failure', status: 409, data: { form: { ...ownForm, valid: true, posted: true, data: { _kind: 'createOwnAppMemory', memoryClass: 'personal', agentId: 'ag1' }, message: { type: 'error', text: 'You already have a memory of this kind in this App.' } } } });
      await tick(3);
      expect(m.target.querySelector('[role=alert]')!.textContent).toContain('You already have a memory of this kind');
    } finally { m.unmount(); resetKitAppliedResults(); }
  });
});
