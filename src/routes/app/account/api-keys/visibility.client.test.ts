import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { submitEnhanced, submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';
import { createUserApiKeySchema, revokeUserApiKeySchema } from './schema';
let mounted: ReturnType<typeof mountComponent> | undefined;
afterEach(() => { mounted?.unmount(); vi.restoreAllMocks(); });
const key = (id: string, revokedAt: string | null, hiddenAt: string | null = null) => ({ id, keyPreview: id, label: id, createdAt: '2026-10-28T00:00:00Z', lastUsedAt: null, revokedAt, hiddenAt, issuedVia: 'portal' });
async function mount(keys = [key('active', null), key('revoked', '2026-10-28T00:00:00Z'), key('hidden', '2026-10-28T00:00:00Z', '2026-10-28T01:00:00Z')], includeHidden = true) {
  setStubPage('http://localhost/app/account/api-keys'+(includeHidden?'?includeHidden=true':''));
  mounted = mountComponent(Page as never, { data: { keys, includeHidden, form: await superValidate({}, zod4(createUserApiKeySchema), {errors:false}), revokeForm: await superValidate({}, zod4(revokeUserApiKeySchema), {errors:false}) }, form: null } as never);
  await tick(2); return mounted.target;
}
async function menu(root: HTMLElement, id: string) {
  root.querySelector<HTMLButtonElement>(`[data-key-id="${id}"] button[aria-haspopup="menu"]`)!.click(); await tick(2);
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}
it('keeps Show hidden keys discoverable with an empty default list', async () => {
  const root = await mount([], false);
  expect(root.querySelector('input[name="includeHidden"]')).not.toBeNull();
  expect(root.textContent).toContain('Show hidden keys');
  expect(root.textContent).toContain('If you have hidden keys');
  expect(root.textContent).not.toContain('keys you have hidden');
  expect(root.textContent).not.toContain('Delete');
});
it('offers Hide only on revoked visible keys, Unhide on hidden rows, and marks hidden state', async () => {
  const root = await mount();
  expect((await menu(root,'active')).map(x=>x.textContent?.trim())).toEqual(['Revoke']);
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await tick();
  expect((await menu(root,'revoked')).map(x=>x.textContent?.trim())).toEqual(['Hide']);
  expect((await menu(root,'hidden')).map(x=>x.textContent?.trim())).toEqual(['Unhide']);
  expect(root.querySelector('[data-key-id="hidden"]')?.textContent).toContain('Hidden');
});
it('submits the picked id and explicit boolean, blocks duplicate submits while pending, and renders refusal', async () => {
  const root = await mount();
  const submit = vi.spyOn(HTMLFormElement.prototype,'requestSubmit').mockImplementation(()=>{});
  (await menu(root,'revoked'))[0].click(); await tick(3);
  const form = root.querySelector<HTMLFormElement>('form[action^="?/visibility"]')!;
  expect(submit.mock.contexts[0]).toBe(form);
  expect(new URL(form.action).searchParams.get('includeHidden')).toBe('true');
  expect(new FormData(form).get('id')).toBe('revoked');
  expect(new FormData(form).get('hidden')).toBe('true');
  const deferred = await submitEnhancedDeferred(form); flushSync();
  expect(await submitEnhanced(form)).toEqual({cancelled:true});
  await deferred.finish({type:'failure',status:500,data:{visibility:{type:'error',text:'KEY_ACTIVE',id:'revoked'}}}); await tick(2);
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('KEY_ACTIVE');
  expect(root.querySelector('[data-key-id="revoked"]')).not.toBeNull();
});

it.each([
  ['revoked', 'success', true],
  ['hidden', 'success', true],
  ['revoked', 'failure', false],
] as const)('refreshes the list after %s %s only when the write succeeds', async (id, type, invalidateAll) => {
  const root = await mount();
  const form = root.querySelector<HTMLFormElement>(`[data-key-id="${id}"] form`)!;
  const update = vi.fn().mockResolvedValue(undefined);
  expect(await submitEnhancedWithResult(form, {
    type,
    status: type === 'success' ? 200 : 500,
    data: { visibility: { type: type === 'success' ? 'success' : 'error', text: 'Server response', id } },
  }, { update })).toEqual({ cancelled: false });
  expect(update).toHaveBeenCalledExactlyOnceWith({ reset: false, invalidateAll });
});

it.each([true, false])('retains the selected includeHidden=%s slice in the native revoke form', async (includeHidden) => {
  const root = await mount(undefined, includeHidden);
  (await menu(root, 'active'))[0].click();
  await tick(2);
  const form = root.querySelector<HTMLFormElement>('[data-testid="revoke-confirm"] form')!;
  expect(form).not.toBeNull();
  const action = new URL(form.action);
  expect(action.searchParams.has('/revoke')).toBe(true);
  expect(action.searchParams.get('includeHidden')).toBe(includeHidden ? 'true' : null);
  expect(new FormData(form).get('id')).toBe('active');
});

// #1359: a live region a screen reader never saw empty may not be announced,
// and a region whose role flips with its text is a new region each time. So
// each feedback region is mounted, empty, before any result, and the SAME
// node carries every later result. Node identity is not proof of a native
// announcement; that leg belongs to browser + screen-reader QA.
describe('visibility feedback live regions (#1359)', () => {
  const regions = (root: HTMLElement) => ({
    status: root.querySelector<HTMLElement>('#key-visibility-status'),
    alert: root.querySelector<HTMLElement>('#key-visibility-alert'),
  });
  const rowStatus = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLElement>(`[data-key-id="${id}"] form [role="status"]`);
  const finish = async (root: HTMLElement, id: string, type: 'success' | 'failure', text: string) => {
    const form = root.querySelector<HTMLFormElement>(`[data-key-id="${id}"] form`)!;
    const deferred = await submitEnhancedDeferred(form);
    flushSync();
    return { deferred, done: async () => {
      await deferred.finish({ type, status: type === 'success' ? 200 : 500, data: { visibility: { type: type === 'success' ? 'success' : 'error', text, id } } });
      await tick(2);
    } };
  };

  it('mounts an empty status and an empty alert before any result, each with a fixed role', async () => {
    const root = await mount();
    const { status, alert } = regions(root);
    expect(status?.getAttribute('role')).toBe('status');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(status?.textContent?.trim()).toBe('');
    expect(alert?.textContent?.trim()).toBe('');
  });

  it('keeps the same two nodes, and their roles, across success, refusal and repeated results', async () => {
    const root = await mount();
    const { status, alert } = regions(root);
    const steps = [
      ['revoked', 'success', 'Key hidden.'],
      ['revoked', 'failure', 'KEY_ACTIVE'],
      ['hidden', 'success', 'Key unhidden.'],
      ['hidden', 'failure', 'Could not update'],
    ] as const;
    for (const [id, type, text] of steps) {
      await (await finish(root, id, type, text)).done();
      const now = regions(root);
      expect(now.status).toBe(status);
      expect(now.alert).toBe(alert);
      expect(status!.getAttribute('role')).toBe('status');
      expect(alert!.getAttribute('role')).toBe('alert');
      // Exactly one region speaks: the other is emptied, never left stale.
      expect((type === 'success' ? status : alert)!.textContent).toContain(text);
      expect((type === 'success' ? alert : status)!.textContent?.trim()).toBe('');
    }
  });

  it('mounts each row’s pending status empty, and fills and empties that same node', async () => {
    const root = await mount();
    const before = rowStatus(root, 'revoked');
    expect(before).not.toBeNull();
    expect(before!.textContent?.trim()).toBe('');
    const { done } = await finish(root, 'revoked', 'failure', 'KEY_ACTIVE');
    expect(rowStatus(root, 'revoked')).toBe(before);
    expect(before!.textContent).toContain('Saving…');
    await done();
    expect(rowStatus(root, 'revoked')).toBe(before);
    expect(before!.textContent?.trim()).toBe('');
  });

  it('renders a no-JS action result into the same fixed-role regions', async () => {
    setStubPage('http://localhost/app/account/api-keys?includeHidden=true');
    mounted = mountComponent(Page as never, { data: { keys: [key('revoked', '2026-10-28T00:00:00Z')], includeHidden: true, form: await superValidate({}, zod4(createUserApiKeySchema), {errors:false}), revokeForm: await superValidate({}, zod4(revokeUserApiKeySchema), {errors:false}) }, form: { visibility: { type: 'error', text: 'KEY_ACTIVE', id: 'revoked' } } } as never);
    await tick(2);
    const { status, alert } = regions(mounted.target);
    expect(alert?.textContent).toContain('KEY_ACTIVE');
    expect(status?.textContent?.trim()).toBe('');
  });
});
