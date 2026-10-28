import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { submitEnhanced, submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
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
