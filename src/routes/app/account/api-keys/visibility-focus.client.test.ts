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
const otherKey = { ...revoked, id: 'other', keyPreview: 'other', label: 'Other' };
const usesCapture = (options: unknown) => typeof options === 'boolean'
  ? options
  : !!(options as AddEventListenerOptions | undefined)?.capture;
type ListenerSpy = { mock: { calls: [type: string, listener: unknown, options?: unknown][] } };
type FocusScopeListener = { type: 'focusin' | 'pointerdown' | 'keydown'; listener: unknown; capture: boolean };
function captureFocusScopeListeners(added: ListenerSpy, firstScopeAdd: number): FocusScopeListener[] {
  const listeners = added.mock.calls.slice(firstScopeAdd).flatMap(([type, listener, options]): FocusScopeListener[] => {
    if (type !== 'focusin' && type !== 'pointerdown' && type !== 'keydown') return [];
    return [{ type, listener, capture: usesCapture(options) }];
  });
  expect(listeners).toHaveLength(3);
  return listeners;
}
function removedWithCapture(removed: ListenerSpy, { type, listener, capture }: FocusScopeListener) {
  return removed.mock.calls.some(([name, callback, options]) =>
    name === type && callback === listener && usesCapture(options) === capture);
}
let mounted: ReturnType<typeof mountComponent> | undefined;
beforeEach(() => {
  resetNavigationCalls();
  vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
});
afterEach(() => { mounted?.unmount(); resetNavigationCalls(); vi.restoreAllMocks(); });
async function setup(includeHidden = false, withOtherRow = false) {
  setStubPage(`http://localhost/app/account/api-keys${includeHidden ? '?includeHidden=true' : ''}`);
  const props = reactiveProps({ data: {
    keys: withOtherRow ? [revoked, otherKey] : [revoked], includeHidden,
    form: await superValidate({}, zod4(createUserApiKeySchema), { errors: false }),
    revokeForm: await superValidate({}, zod4(revokeUserApiKeySchema), { errors: false }),
  }, form: null as unknown });
  mounted = mountComponent(Page as never, props as never);
  await tick(2);
  const root = mounted.target;
  const toggle = root.querySelector<HTMLInputElement>('input[name="includeHidden"]')!;
  const begin = async (
    type: 'success' | 'failure' = 'success',
    hidden = true,
    options: { programmatic?: boolean; afterReset?: () => void; beforeSubmit?: () => void; updateError?: Error } = {},
  ) => {
    const trigger = root.querySelector<HTMLButtonElement>('[data-key-id="revoked"] button[aria-haspopup="menu"]')!;
    if (!options.programmatic) {
      trigger.focus(); trigger.click(); await tick(2);
      const item = root.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
      expect(item.textContent).toContain(hidden ? 'Hide' : 'Unhide');
      item.click(); await tick(2);
    }
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
      options.afterReset?.();
      if (options.updateError) throw options.updateError;
      await tick();
    });
    options.beforeSubmit?.();
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

const settlementCases: { label: string; type: 'success' | 'failure'; updateError?: Error }[] = [
  { label: 'successful', type: 'success' },
  { label: 'refused', type: 'failure' },
  { label: 'exceptional', type: 'success', updateError: new Error('Kit update failed') },
];
it.each(settlementCases)('removes the focus-scope document listeners after $label settlement', async ({ type, updateError }) => {
  const { begin } = await setup();
  const added = vi.spyOn(document, 'addEventListener');
  const removed = vi.spyOn(document, 'removeEventListener');
  let firstScopeAdd = 0;
  const action = await begin(type, true, {
    beforeSubmit: () => { firstScopeAdd = added.mock.calls.length; },
    updateError,
  });
  const listeners = captureFocusScopeListeners(added, firstScopeAdd);
  if (updateError) await expect(action.finish()).rejects.toThrow(updateError);
  else await action.finish();
  for (const listener of listeners) {
    expect(removedWithCapture(removed, listener), `${listener.type} listener is removed with matching capture on settlement`).toBe(true);
  }
  removed.mockClear();
  mounted!.unmount();
  for (const { type: eventType, listener } of listeners) {
    expect(removed).not.toHaveBeenCalledWith(eventType, listener);
  }
});

it('removes the focus-scope document listeners when the page is destroyed pending', async () => {
  const { begin } = await setup();
  const added = vi.spyOn(document, 'addEventListener');
  const removed = vi.spyOn(document, 'removeEventListener');
  let firstScopeAdd = 0;
  const action = await begin('success', true, { beforeSubmit: () => { firstScopeAdd = added.mock.calls.length; } });
  const listeners = captureFocusScopeListeners(added, firstScopeAdd);
  mounted!.unmount();
  for (const listener of listeners) {
    expect(removedWithCapture(removed, listener), `${listener.type} listener is removed with matching capture on destruction`).toBe(true);
  }
  added.mockClear();
  const activeAfterDestroy = document.activeElement;
  await action.finish();
  for (const { type, listener } of listeners) {
    expect(added.mock.calls.some(([name, callback]) => name === type && callback === listener),
      `${type} listener is not reattached by late settlement`).toBe(false);
  }
  expect(document.activeElement).toBe(activeAfterDestroy);
});

it.each([
  { label: 'pointerdown', makeEvent: () => new Event('pointerdown', { bubbles: true }) },
  { label: 'modifier keydown', makeEvent: () => new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }) },
])('treats a pending $label as interaction and leaves Kit\'s BODY reset alone', async ({ makeEvent }) => {
  const { root, toggle, begin } = await setup();
  const action = await begin();
  root.querySelector('input[name="label"]')!.dispatchEvent(makeEvent());
  await action.finish(); await tick(2);
  expect(document.activeElement).toBe(document.body);
  expect(document.activeElement).not.toBe(toggle);
});

it('restores a connected deliberate focus target after a later blank pointer interaction', async () => {
  const { root, begin } = await setup();
  const action = await begin();
  const other = root.querySelector<HTMLInputElement>('input[name="label"]')!;
  other.focus();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex');
  // Existing reviewed behavior: interacted gates only the toggle fallback;
  // a connected deliberate lastFocus still wins. Changing that needs UX/QA.
  await action.finish(); await tick(2);
  expect(document.activeElement).toBe(other);
});

it('leaves BODY focused when pending interaction is followed by removal of the chosen focus target', async () => {
  const { root, props, toggle, begin } = await setup(false, true);
  const action = await begin();
  const other = root.querySelector<HTMLButtonElement>('[data-key-id="other"] button[aria-haspopup="menu"]')!;
  other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  other.focus();
  expect(document.activeElement).toBe(other);
  navigationHooks.onInvalidateAll = async () => { props.data = { ...props.data, keys: [] }; await tick(2); };
  await action.finish(); await tick(2);
  expect(other.isConnected).toBe(false);
  expect(document.activeElement).toBe(document.body);
  expect(document.activeElement).not.toBe(toggle);
});

it('does not steal an active external focus target that did not emit focusin to the page', async () => {
  const { toggle, begin } = await setup();
  const outside = document.createElement('button');
  outside.textContent = 'Outside action';
  // A child can own focus without bubbling focusin to the page's recorder.
  // The active-element guard, not lastFocus restoration, must preserve it.
  outside.addEventListener('focusin', (event) => event.stopPropagation());
  document.body.appendChild(outside);
  try {
    const action = await begin('success', true, { afterReset: () => outside.focus() });
    navigationHooks.onInvalidateAll = async () => { await tick(2); };
    await action.finish(); await tick(2);
    expect(document.activeElement).toBe(outside);
    expect(document.activeElement).not.toBe(toggle);
  } finally {
    outside.remove();
  }
});

it('does not claim focus recovery for a programmatic submit that started outside the row form', async () => {
  const { root, toggle, begin } = await setup();
  const outside = root.querySelector<HTMLInputElement>('input[name="label"]')!;
  outside.focus();
  const action = await begin('success', true, { programmatic: true });
  await action.finish(); await tick(2);
  expect(document.activeElement).toBe(document.body);
  expect(document.activeElement).not.toBe(toggle);
});
