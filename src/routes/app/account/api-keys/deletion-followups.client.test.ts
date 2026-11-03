// portal#1652: the #1648 P3 follow-ups on the Delete dialog, mounted.
// Copy order (1–2), no-JS link names (3), Cancel semantics (4), the held old
// refresh against a newer dialog (5), the refresh-failed notice (6), and the
// dialog-identity guard on a stale close (8). Item 7 is server-side, in
// deletion.server.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { stubKeyList } from '$lib/test/stubs/key-list-fetch';
import Page from './+page.svelte';
import { createUserApiKeySchema, revokeUserApiKeySchema } from './schema';

let mounted: ReturnType<typeof mountComponent> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); resetNavigationCalls(); });

const REVOKED = '2026-10-28T00:00:00Z';
const key = (id: string, revokedAt: string | null, hiddenAt: string | null = null) =>
  ({ id, keyPreview: `pv${id}`, label: `label-${id}`, createdAt: '2026-10-28T00:00:00Z', lastUsedAt: null, revokedAt, hiddenAt, issuedVia: 'portal' });
const allKeys = () => [key('live', null), key('other', null), key('revoked', REVOKED), key('hidden', REVOKED, '2026-10-28T01:00:00Z')];
type Result = { type: 'success' | 'failure'; status: number; data: Record<string, unknown> };

async function mount(opts: { deleteTarget?: string | null; includeHidden?: boolean } = {}) {
  const includeHidden = opts.includeHidden ?? true;
  setStubPage('http://localhost/app/account/api-keys' + (includeHidden ? '?includeHidden=true' : ''));
  const props = reactiveProps({
    data: {
      keys: allKeys(), includeHidden, deleteTarget: opts.deleteTarget ?? null,
      form: await superValidate({}, zod4(createUserApiKeySchema), { errors: false }),
      revokeForm: await superValidate({}, zod4(revokeUserApiKeySchema), { errors: false }),
    } as Record<string, unknown>,
    form: null as unknown,
  });
  mounted = mountComponent(Page as never, props as never);
  await tick(2);
  return { root: mounted.target, props };
}
async function openDelete(root: HTMLElement, id: string) {
  const trigger = root.querySelector<HTMLButtonElement>(`[data-key-id="${id}"] button[aria-haspopup="menu"]`)!;
  trigger.focus(); trigger.click(); await tick(2);
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent?.trim() === 'Delete');
  expect(item, `Delete offered on ${id}`).toBeDefined();
  item!.click(); await tick(3);
  return dialog()!;
}
const dialog = () => document.querySelector<HTMLElement>('[data-testid="delete-confirm"]');
const deleteForm = () => dialog()!.querySelector<HTMLFormElement>('form[action^="?/delete"]')!;
const cancelOf = () => dialog()!.querySelector<HTMLElement>('[data-testid="delete-cancel"]')!;
const status = (root: HTMLElement) => root.querySelector<HTMLElement>('#key-visibility-status')!;
const alertRegion = (root: HTMLElement) => root.querySelector<HTMLElement>('#key-visibility-alert')!;
const success = (text: string): Result => ({ type: 'success', status: 200, data: { deletion: { type: 'success', text } } });

/** Kit's update as installed client.js runs it: the action data lands, THEN focus resets to <body>. */
function kitUpdate(props: { form: unknown }) {
  return vi.fn(async (_o?: unknown) => {
    props.form = { deletion: { type: 'success', text: 'applied' } };
    await tick();
    const had = document.body.getAttribute('tabindex');
    document.body.tabIndex = -1; document.body.focus();
    if (had === null) document.body.removeAttribute('tabindex'); else document.body.setAttribute('tabindex', had);
    await tick();
  });
}

describe('#1652 items 1–2: the confirmation leads with what cannot be undone, in plain words', () => {
  it.each(['live', 'revoked'])('a %s key: the irreversible line comes first and is emphasised, both halves intact', async (id) => {
    const { root } = await mount();
    const d = await openDelete(root, id);
    const body = d.querySelector('#delete-dialog-body')!;
    const first = body.firstElementChild as HTMLElement;
    expect(first.textContent).toMatch(/can't be undone/i);
    expect(first.textContent).toMatch(/record .* is kept, without the key itself/i);
    expect(first.querySelector('strong')?.textContent).toMatch(/can't be undone/i);
    expect(body.lastElementChild!.textContent).not.toMatch(/can't be undone/i);
  });

  it('a live key keeps the full contract: revoked first, created keys revoked too, not deleted, parentless', async () => {
    const { root } = await mount();
    const text = (await openDelete(root, 'live')).querySelector('#delete-dialog-body')!.textContent!;
    for (const claim of [/revoked first/i, /anything using it stops working/i, /keys it created are revoked too/i, /not deleted/i, /without a parent key/i]) {
      expect(text).toMatch(claim);
    }
  });

  it.each(['revoked', 'hidden'])('a %s key: says it is already revoked, with no double negative, and keeps the created-keys sentence', async (id) => {
    const { root } = await mount();
    const text = (await openDelete(root, id)).querySelector('#delete-dialog-body')!.textContent!;
    expect(text).toContain('This key is already revoked.');
    expect(text).not.toMatch(/no key is newly revoked|so no key/i);
    expect(text).toMatch(/keys it created are not deleted and stay in your list without a parent key/i);
    expect(text).not.toMatch(/revoked first/i);
  });
});

// #1652 item 3 (no-JS link names) is pinned on the server render, in
// deletion-noscript.test.ts: the client renderer leaves <noscript> empty.

describe('#1652 item 4: Cancel is a button in the JS flow, a link only without JS', () => {
  it('a menu-opened Cancel is a type=button <button> (Space activates it natively) that closes in place', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit');
    const { root } = await mount();
    await openDelete(root, 'live');
    const cancel = cancelOf();
    expect(cancel).toBeInstanceOf(HTMLButtonElement);
    expect((cancel as HTMLButtonElement).type).toBe('button');
    expect(cancel.hasAttribute('href')).toBe(false);
    expect(document.activeElement).toBe(cancel);
    cancel.click(); await tick(2);
    expect(dialog()).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it('control: the URL-opened (no-JS) confirmation still cancels by a real link', async () => {
    await mount({ deleteTarget: 'revoked' });
    const cancel = cancelOf();
    expect(cancel).toBeInstanceOf(HTMLAnchorElement);
    expect(new URL((cancel as HTMLAnchorElement).href).searchParams.get('confirmDelete')).toBeNull();
  });

  it('a pending delete keeps Cancel from abandoning it', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    await submitEnhancedDeferred(deleteForm()); flushSync(); await tick(1);
    expect(cancelOf().getAttribute('aria-disabled')).toBe('true');
    cancelOf().click(); await tick(2);
    expect(dialog()).not.toBeNull();
  });
});

describe('#1652 item 5: an older action\'s held refresh never takes focus from a newer dialog', () => {
  it('confirmed delete → held refresh → newer dialog opened → release: the newer Cancel keeps focus', async () => {
    const list = stubKeyList({ keys: allKeys().filter((k) => k.id !== 'live') });
    const { root, props } = await mount();
    await openDelete(root, 'live');
    const update = kitUpdate(props);
    const d = await submitEnhancedDeferred(deleteForm(), { update }); flushSync(); await tick(1);
    const release = list.hold();
    const done = d.finish(success('API key deleted.')); await tick(3);
    expect(dialog()).toBeNull();
    expect(status(root).textContent).toBe('API key deleted.');
    const newer = await openDelete(root, 'other');
    expect(document.activeElement).toBe(cancelOf());
    release(); await done; await tick(3);
    expect(dialog()).toBe(newer);
    expect(document.activeElement).toBe(cancelOf());
    expect(update).not.toHaveBeenCalled();
    // The older action's notice was delivered and stays.
    expect(status(root).textContent).toBe('API key deleted.');
  });

  it('control at the same position: with no newer dialog, the release applies the action once', async () => {
    const list = stubKeyList({ keys: allKeys().filter((k) => k.id !== 'live') });
    const { root, props } = await mount();
    await openDelete(root, 'live');
    const update = kitUpdate(props);
    const d = await submitEnhancedDeferred(deleteForm(), { update }); flushSync(); await tick(1);
    const release = list.hold();
    const done = d.finish(success('API key deleted.')); await tick(3);
    release(); await done; await tick(3);
    expect(update).toHaveBeenCalledExactlyOnceWith({ reset: false, invalidateAll: false });
  });

  it('control at the same position: a newer dialog that was cancelled before the release does not fence it', async () => {
    const list = stubKeyList({ keys: allKeys().filter((k) => k.id !== 'live') });
    const { root, props } = await mount();
    await openDelete(root, 'live');
    const update = kitUpdate(props);
    const d = await submitEnhancedDeferred(deleteForm(), { update }); flushSync(); await tick(1);
    const release = list.hold();
    const done = d.finish(success('API key deleted.')); await tick(3);
    await openDelete(root, 'other');
    cancelOf().click(); await tick(2);
    expect(dialog()).toBeNull();
    release(); await done; await tick(3);
    expect(update).toHaveBeenCalledExactlyOnceWith({ reset: false, invalidateAll: false });
  });

  it('a pending Hide/Unhide refusal still lands while a newer dialog is open, without taking its focus', async () => {
    const { root, props } = await mount();
    const update = kitUpdate(props);
    const hide = await submitEnhancedDeferred(root.querySelector<HTMLFormElement>('[data-key-id="hidden"] form')!, { update }); flushSync(); await tick(1);
    await openDelete(root, 'live');
    const cancel = cancelOf();
    await hide.finish({ type: 'failure', status: 400, data: { visibility: { type: 'error', text: 'PENDING UNHIDE REFUSAL' } } }); await tick(3);
    expect(alertRegion(root).textContent).toBe('PENDING UNHIDE REFUSAL');
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(cancel);
    expect(update).not.toHaveBeenCalled();
  });

  it('control: the same Hide/Unhide refusal with no dialog open is applied', async () => {
    const { root, props } = await mount();
    const update = vi.fn(async () => { props.form = null; });
    const hide = await submitEnhancedDeferred(root.querySelector<HTMLFormElement>('[data-key-id="hidden"] form')!, { update }); flushSync(); await tick(1);
    await hide.finish({ type: 'failure', status: 400, data: { visibility: { type: 'error', text: 'LONE UNHIDE REFUSAL' } } }); await tick(3);
    expect(alertRegion(root).textContent).toBe('LONE UNHIDE REFUSAL');
    expect(update).toHaveBeenCalledExactlyOnceWith({ reset: false, invalidateAll: false });
  });
});

describe('#1652 item 6: a refresh that failed after a confirmed delete asks for attention once', () => {
  it('the notice keeps its polite live region, takes the attention tone, ends on the reason, and the link carries the action', async () => {
    const { root } = await mount();
    const region = status(root);
    expect(region.getAttribute('data-tone')).toBe('success');
    await openDelete(root, 'live');
    const d = await submitEnhancedDeferred(deleteForm()); flushSync(); await tick(1);
    stubKeyList({ reject: new Error('synthetic-refresh-failure') });
    await d.finish(success('API key deleted.')); await tick(3);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    expect(status(root)).toBe(region);
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('data-tone')).toBe('attention');
    expect(region.textContent).toMatch(/^API key deleted\..*could not be refreshed/i);
    expect(region.textContent).not.toMatch(/reload the list/i);
    const reloads = root.querySelectorAll('a[data-testid="key-list-reload"]');
    expect(reloads).toHaveLength(1);
    expect(reloads[0].textContent?.trim()).toBe('Reload the list');
  });

  it('control: a refresh that succeeds keeps the success tone', async () => {
    stubKeyList({ keys: allKeys().filter((k) => k.id !== 'live') });
    const { root } = await mount();
    await openDelete(root, 'live');
    const d = await submitEnhancedDeferred(deleteForm()); flushSync(); await tick(1);
    await d.finish(success('API key deleted.')); await tick(3);
    expect(status(root).getAttribute('data-tone')).toBe('success');
  });

  it('the uncertain notice claims neither outcome and does not repeat the link\'s imperative', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    const d = await submitEnhancedDeferred(deleteForm()); flushSync(); await tick(1);
    await d.finish({ type: 'error', status: 500, error: new Error('x') } as never); await tick(3);
    expect(alertRegion(root).textContent).toMatch(/could not confirm whether the key was deleted/i);
    expect(alertRegion(root).textContent).not.toMatch(/reload the list/i);
    expect(root.querySelectorAll('a[data-testid="key-list-reload"]')).toHaveLength(1);
  });
});

describe('#1652 item 8: a stale delete reply never closes a newer dialog', () => {
  it.each([
    ['a confirmed', success('STALE DELETED')],
    ['a refused', { type: 'failure', status: 404, data: { deletion: { type: 'error', text: 'STALE REFUSAL' } } } as Result],
  ])('%s reply from a dialog the view closed leaves the newer dialog open with its focus', async (_l, result) => {
    const { root, props } = await mount();
    await openDelete(root, 'revoked');
    const update = vi.fn().mockResolvedValue(undefined);
    const d = await submitEnhancedDeferred(deleteForm(), { update }); flushSync(); await tick(1);
    props.data = { ...props.data, includeHidden: false }; await tick(3);
    expect(dialog()).toBeNull();
    const newer = await openDelete(root, 'live');
    const cancel = cancelOf();
    await d.finish(result); await tick(3);
    expect(dialog()).toBe(newer);
    expect(document.activeElement).toBe(cancel);
    expect(root.textContent).not.toMatch(/STALE/);
    expect(update).not.toHaveBeenCalled();
  });

  it('control: the same reply with its own dialog still open closes that dialog', async () => {
    stubKeyList({ keys: allKeys().filter((k) => k.id !== 'revoked') });
    const { root } = await mount();
    await openDelete(root, 'revoked');
    const d = await submitEnhancedDeferred(deleteForm()); flushSync(); await tick(1);
    await d.finish(success('FRESH DELETED')); await tick(3);
    expect(dialog()).toBeNull();
    expect(status(root).textContent).toBe('FRESH DELETED');
  });
});
