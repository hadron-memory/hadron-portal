/** #1362: real page + menu teardown + Kit's final applyAction focus reset. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { navigationHooks, resetNavigationCalls, holdInvalidateAll } from '$lib/test/stubs/app-navigation';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';
import { createUserApiKeySchema, revokeUserApiKeySchema } from './schema';

const revoked = { id: 'revoked', keyPreview: 'revoked', label: 'Revoked', createdAt: '2026-10-28T00:00:00Z', lastUsedAt: null, revokedAt: '2026-10-28T00:00:00Z', hiddenAt: null, issuedVia: 'portal' };
let mounted: ReturnType<typeof mountComponent> | undefined;
beforeEach(() => {
  resetNavigationCalls();
  vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
});
afterEach(() => { mounted?.unmount(); resetNavigationCalls(); vi.restoreAllMocks(); });
async function setup(includeHidden = false) {
  setStubPage(`http://localhost/app/account/api-keys${includeHidden ? '?includeHidden=true' : ''}`);
  const props = reactiveProps({ data: {
    keys: [revoked], includeHidden,
    form: await superValidate({}, zod4(createUserApiKeySchema), { errors: false }),
    revokeForm: await superValidate({}, zod4(revokeUserApiKeySchema), { errors: false }),
  }, form: null as unknown });
  mounted = mountComponent(Page as never, props as never);
  await tick(2);
  const root = mounted.target;
  const toggle = root.querySelector<HTMLInputElement>('input[name="includeHidden"]')!;
  const begin = async (type: 'success' | 'failure' = 'success', hidden = true) => {
    const trigger = root.querySelector<HTMLButtonElement>('[data-key-id="revoked"] button[aria-haspopup="menu"]')!;
    trigger.focus(); trigger.click(); await tick(2);
    const item = root.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(item.textContent).toContain(hidden ? 'Hide' : 'Unhide');
    item.click(); await tick(2);
    const form = root.querySelector<HTMLFormElement>('[data-key-id="revoked"] form')!;
    const result = { type, status: type === 'success' ? 200 : 400,
      data: { visibility: { type: type === 'success' ? 'success' : 'error', text: type === 'success' ? (hidden ? 'Key hidden.' : 'Key unhidden.') : 'KEY_ACTIVE', id: revoked.id } } };
    const update = vi.fn(async () => {
      props.form = result.data;
      // Installed Kit client.js applyAction(success) resets focus AFTER its
      // action-data update. Model that real ordering, not a no-op update stub.
      await tick();
      if (type === 'success') {
        const old = document.body.getAttribute('tabindex');
        document.body.tabIndex = -1; document.body.focus();
        if (old === null) document.body.removeAttribute('tabindex'); else document.body.setAttribute('tabindex', old);
      }
      await tick();
    });
    const pending = await submitEnhancedDeferred(form, { update });
    return { trigger, update, finish: () => pending.finish(result) };
  };
  return { root, props, toggle, begin };
}

it('recovers focus only after successful refresh, row/menu teardown AND final action update', async () => {
  const { root, props, toggle, begin } = await setup();
  const action = await begin();
  navigationHooks.onInvalidateAll = async () => { props.data = { ...props.data, keys: [] }; await tick(2); };
  const release = holdInvalidateAll();
  const done = action.finish(); await tick(2);
  expect(root.querySelector('[data-key-id="revoked"]')).toBeNull();
  expect(action.update).not.toHaveBeenCalled();
  release(); await done; await tick(2);
  expect(action.update).toHaveBeenCalledExactlyOnceWith({ reset: false, invalidateAll: false });
  expect(document.activeElement).toBe(toggle);
  expect(root.querySelector('#key-visibility-status')?.textContent).toBe('Key hidden.');
});

it('recovers on repeated Hide/Unhide in Show hidden mode even though the row remains', async () => {
  const { props, toggle, begin } = await setup(true);
  for (const hidden of [true, false, true]) {
    const action = await begin('success', hidden);
    navigationHooks.onInvalidateAll = async () => {
      props.data = { ...props.data, keys: [{ ...revoked, hiddenAt: hidden ? '2026-10-28T01:00:00Z' : null } as typeof revoked] };
      await tick(2);
    };
    await action.finish(); await tick(2);
    expect(document.activeElement).toBe(toggle);
  }
});

it('keeps a deliberate focus move made while the request is pending, despite Kit resetting it', async () => {
  const { root, props, toggle, begin } = await setup();
  const action = await begin();
  const other = root.querySelector<HTMLInputElement>('input[name="label"]')!;
  other.focus();
  navigationHooks.onInvalidateAll = async () => { props.data = { ...props.data, keys: [] }; await tick(2); };
  await action.finish(); await tick(2);
  expect(document.activeElement).toBe(other);
  expect(document.activeElement).not.toBe(toggle);
});

it('keeps a deliberate focus move made during the held refresh', async () => {
  const { root, props, begin } = await setup();
  const action = await begin();
  const release = holdInvalidateAll();
  navigationHooks.onInvalidateAll = async () => { props.data = { ...props.data, keys: [] }; await tick(2); };
  const done = action.finish(); await tick(2);
  const other = root.querySelector<HTMLInputElement>('input[name="label"]')!;
  other.focus(); release(); await done; await tick(2);
  expect(document.activeElement).toBe(other);
});

it('does not recover focus on refusal or replace the persistent error feedback', async () => {
  const { root, begin, toggle } = await setup();
  const action = await begin('failure');
  const other = root.querySelector<HTMLInputElement>('input[name="label"]')!;
  other.focus(); await action.finish(); await tick(2);
  expect(document.activeElement).toBe(other);
  expect(document.activeElement).not.toBe(toggle);
  expect(root.querySelector('#key-visibility-alert')?.textContent).toBe('KEY_ACTIVE');
});
