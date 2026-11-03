// portal#1011 P2: the Delete flow on /app/account/api-keys, mounted. What the
// page OFFERS and what it does with a reply; the server action's own mapping
// is pinned in deletion.server.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { captureUnhandledRejections, mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhanced, submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { createUserApiKeySchema, revokeUserApiKeySchema } from './schema';

let mounted: ReturnType<typeof mountComponent> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.restoreAllMocks(); resetNavigationCalls(); });

const REVOKED = '2026-10-28T00:00:00Z';
const key = (id: string, revokedAt: string | null, hiddenAt: string | null = null, label: string | null = `label-${id}`) =>
  ({ id, keyPreview: `pv${id}`, label, createdAt: '2026-10-28T00:00:00Z', lastUsedAt: null, revokedAt, hiddenAt, issuedVia: 'portal' });
const allKeys = () => [key('live', null), key('revoked', REVOKED), key('hidden', REVOKED, '2026-10-28T01:00:00Z')];
type Result = { type: 'success' | 'failure'; status: number; data: Record<string, unknown> };

async function mount(opts: { keys?: ReturnType<typeof allKeys>; includeHidden?: boolean; deleteTarget?: string | null; form?: unknown } = {}) {
  const includeHidden = opts.includeHidden ?? true;
  setStubPage('http://localhost/app/account/api-keys' + (includeHidden ? '?includeHidden=true' : ''));
  const props = reactiveProps({
    data: {
      keys: opts.keys ?? allKeys(), includeHidden, deleteTarget: opts.deleteTarget ?? null,
      form: await superValidate({}, zod4(createUserApiKeySchema), { errors: false }),
      revokeForm: await superValidate({}, zod4(revokeUserApiKeySchema), { errors: false }),
    } as Record<string, unknown>,
    form: (opts.form ?? null) as unknown,
  });
  mounted = mountComponent(Page as never, props as never);
  await tick(2);
  return { root: mounted.target, props, m: mounted };
}
async function menu(root: HTMLElement, id: string) {
  root.querySelector<HTMLButtonElement>(`[data-key-id="${id}"] button[aria-haspopup="menu"]`)!.click(); await tick(2);
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}
async function openDelete(root: HTMLElement, id: string) {
  const item = (await menu(root, id)).find((x) => x.textContent?.trim() === 'Delete');
  expect(item, `Delete offered on ${id}`).toBeDefined();
  item!.click(); await tick(3);
  return dialog();
}
const dialog = () => document.querySelector<HTMLElement>('[data-testid="delete-confirm"]');
const deleteForm = () => dialog()?.querySelector<HTMLFormElement>('form[action^="?/delete"]') ?? null;
const status = (root: HTMLElement) => root.querySelector<HTMLElement>('#key-visibility-status')!;
const alert = (root: HTMLElement) => root.querySelector<HTMLElement>('#key-visibility-alert')!;
const success = (text: string): Result => ({ type: 'success', status: 200, data: { deletion: { type: 'success', text } } });

describe('#1011 P2: Delete is offered on every own key', () => {
  it.each([['live', ['Revoke', 'Delete']], ['revoked', ['Hide', 'Delete']], ['hidden', ['Unhide', 'Delete']]] as const)(
    '%s row menu offers %j', async (id, items) => {
      const { root } = await mount();
      expect((await menu(root, id)).map((x) => x.textContent?.trim())).toEqual(items);
    });
});

describe('#1011 P2: the confirmation names the key and its real consequences', () => {
  it('a live key: names label and masked preview, says it is revoked first with the keys it created, and claims no count', async () => {
    const { root } = await mount();
    const d = await openDelete(root, 'live');
    expect(d?.getAttribute('role')).toBe('dialog');
    expect(d?.getAttribute('aria-modal')).toBe('true');
    expect(d?.textContent).toContain('label-live');
    expect(d?.textContent).toContain('…pvlive');
    expect(d?.textContent).toMatch(/can't be undone/i);
    expect(d?.textContent).toMatch(/revoked first/i);
    expect(d?.textContent).toMatch(/not deleted/i);
    expect(d?.textContent).not.toMatch(/\d+ (child|key)/i);
    expect(new FormData(deleteForm()!).get('id')).toBe('live');
  });

  it.each(['revoked', 'hidden'])('a %s key: says it is already revoked and promises no new revocation (#1652 item 2)', async (id) => {
    const { root } = await mount();
    const d = await openDelete(root, id);
    expect(d?.textContent).toContain(`…pv${id}`);
    expect(d?.textContent).toContain('This key is already revoked.');
    expect(d?.textContent).not.toMatch(/revoked first/i);
    expect(new FormData(deleteForm()!).get('id')).toBe(id);
  });

  it.each([true, false])('keeps the includeHidden=%s view in the delete action', async (includeHidden) => {
    const { root } = await mount({ includeHidden, keys: [key('live', null)] });
    await openDelete(root, 'live');
    const action = new URL(deleteForm()!.action);
    expect(action.searchParams.has('/delete')).toBe(true);
    expect(action.searchParams.get('includeHidden')).toBe(includeHidden ? 'true' : null);
  });

  it('moves focus into the dialog, onto Cancel', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('delete-cancel');
  });
});

describe('#1011 P2: cancel sends nothing', () => {
  it.each(['button', 'Escape'] as const)('cancel by %s closes the dialog with zero submits', async (how) => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit');
    const { root } = await mount();
    await openDelete(root, 'live');
    if (how === 'button') dialog()!.querySelector<HTMLElement>('[data-testid="delete-cancel"]')!.click();
    else dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(2);
    expect(dialog()).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect(navigationCalls).toEqual([]);
  });

  it('a no-JS confirmation (from ?confirmDelete) cancels by a plain link back to the same view', async () => {
    const { root } = await mount({ deleteTarget: 'revoked' });
    expect(dialog()?.textContent).toContain('…pvrevoked');
    const cancel = dialog()!.querySelector<HTMLAnchorElement>('a[data-testid="delete-cancel"]');
    expect(cancel).not.toBeNull();
    expect(new URL(cancel!.href).searchParams.get('confirmDelete')).toBeNull();
    expect(new URL(cancel!.href).searchParams.get('includeHidden')).toBe('true');
    // It is a real navigation, so the address loses ?confirmDelete too.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    cancel!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(root).toBeTruthy();
  });

  it('control: a menu-opened Cancel is a button that closes in place, not a link (#1652 item 4)', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    expect(dialog()!.querySelector('a[data-testid="delete-cancel"]')).toBeNull();
    dialog()!.querySelector<HTMLButtonElement>('button[type="button"][data-testid="delete-cancel"]')!.click(); await tick(2);
    expect(dialog()).toBeNull();
    expect(navigationCalls).toEqual([]);
  });
});

describe('#1011 P2: submit lifecycle', () => {
  it('blocks a duplicate submit while one is pending, and the confirm control is disabled', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    expect(await submitEnhanced(deleteForm()!)).toEqual({ cancelled: true });
    expect(dialog()!.querySelector<HTMLButtonElement>('[data-testid="delete-confirm-yes"]')!.disabled).toBe(true);
    expect(root).toBeTruthy();
  });

  it('Escape cannot dismiss the dialog while the delete is pending, nor take an already-consumed key', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    consumed.preventDefault();
    dialog()!.dispatchEvent(consumed); await tick(2);
    expect(dialog()).not.toBeNull();
    await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(2);
    expect(dialog()).not.toBeNull();
  });

  it('a confirmed delete closes the dialog, announces once, refreshes once and applies once', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    const update = vi.fn().mockResolvedValue(undefined);
    const d = await submitEnhancedDeferred(deleteForm()!, { update }); flushSync(); await tick(1);
    expect(status(root).textContent).toBe('');
    await d.finish(success('API key deleted.')); await tick(3);
    expect(dialog()).toBeNull();
    expect(status(root).textContent).toBe('API key deleted.');
    expect(alert(root).textContent).toBe('');
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(update).toHaveBeenCalledExactlyOnceWith({ reset: false, invalidateAll: false });
  });

  it('a refusal closes the dialog and lands in the alert without refreshing', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    const d = await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    await d.finish({ type: 'failure', status: 404, data: { deletion: { type: 'error', text: 'That key was not found.' } } }); await tick(3);
    expect(dialog()).toBeNull();
    expect(alert(root).textContent).toBe('That key was not found.');
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    expect(root.querySelector('[data-testid="key-list-reload"]')).toBeNull();
  });

  it('an uncertain reply offers a GET reload of the same view, never a replay', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    const d = await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    await d.finish({ type: 'failure', status: 502, data: { deletion: { type: 'error', text: 'Could not confirm.', recover: true } } }); await tick(3);
    expect(alert(root).textContent).toBe('Could not confirm.');
    const reload = root.querySelector<HTMLAnchorElement>('a[data-testid="key-list-reload"]');
    expect(reload).not.toBeNull();
    expect(new URL(reload!.href).searchParams.get('includeHidden')).toBe('true');
    expect(reload!.closest('form')).toBeNull();
    // Same-URL client navigation reuses kit's cached server data (has_changed in
    // load_route), so only a full document load actually refetches the list.
    expect(reload!.hasAttribute('data-sveltekit-reload')).toBe(true);
  });

  it('a thrown action (kit error result) is uncertain too', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    const d = await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    await d.finish({ type: 'error', status: 500, error: new Error('synthetic-diagnostic') } as never); await tick(3);
    expect(alert(root).textContent).toMatch(/could not confirm/i);
    expect(root.textContent).not.toContain('synthetic-diagnostic');
    expect(root.querySelector('[data-testid="key-list-reload"]')).not.toBeNull();
  });

  it('a committed delete whose refresh failed stays reported as deleted, with a reload link', async () => {
    const { root, props } = await mount();
    props.data = { ...props.data, loadError: 'Could not load your API keys.' };
    await tick(2);
    expect(root.querySelector('[data-testid="key-list-reload"]')?.hasAttribute('data-sveltekit-reload')).toBe(true);
    expect(root.textContent).not.toMatch(/not deleted|rolled back/i);
  });
});

describe('#1011 P2: a reply never reaches a view or page it did not start in', () => {
  it('drops a reply after an includeHidden view change, and closes the dialog with the view', async () => {
    const { root, props } = await mount();
    await openDelete(root, 'revoked');
    const update = vi.fn().mockResolvedValue(undefined);
    const d = await submitEnhancedDeferred(deleteForm()!, { update }); flushSync(); await tick(1);
    props.data = { ...props.data, includeHidden: false }; props.form = null; await tick(2);
    expect(dialog()).toBeNull();
    await d.finish(success('STALE VIEW RESULT')); await tick(3);
    expect(root.textContent).not.toContain('STALE VIEW RESULT');
    expect(update).not.toHaveBeenCalled();
  });

  it('control: the same reply at the same position, with no view change, is shown', async () => {
    const { root } = await mount();
    await openDelete(root, 'revoked');
    const d = await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    await d.finish(success('FRESH RESULT')); await tick(3);
    expect(status(root).textContent).toBe('FRESH RESULT');
  });

  it('drops a reply after teardown without an unhandled rejection or a write to the next page', async () => {
    const first = await mount();
    await openDelete(first.root, 'live');
    const update = vi.fn().mockResolvedValue(undefined);
    const d = await submitEnhancedDeferred(deleteForm()!, { update }); flushSync(); await tick(1);
    first.m.unmount(); mounted = undefined;
    const fresh = await mount();
    const rejections = await captureUnhandledRejections(async () => {
      await d.finish(success('DESTROYED PAGE RESULT')); await tick(3);
    });
    expect(rejections).toEqual([]);
    expect(update).not.toHaveBeenCalled();
    expect(fresh.root.textContent).not.toContain('DESTROYED PAGE RESULT');
  });
});

it('renders a no-JS delete result into the fixed-role regions', async () => {
  const { root } = await mount({ form: { deletion: { type: 'success', text: 'API key deleted.' } } });
  expect(status(root).textContent).toBe('API key deleted.');
  expect(alert(root).textContent).toBe('');
});

describe('#1011 P2 (LOCAL 4ffcde15): a refresh that fails after a confirmed delete', () => {
  it('keeps the confirmed deletion, says the list was not refreshed, offers a full GET reload, and nothing escapes', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    const update = vi.fn().mockResolvedValue(undefined);
    const d = await submitEnhancedDeferred(deleteForm()!, { update }); flushSync(); await tick(1);
    navigationHooks.onInvalidateAll = () => Promise.reject(new Error('synthetic-refresh-failure'));
    let settled: 'resolved' | 'rejected' | undefined;
    const rejections = await captureUnhandledRejections(async () => {
      await d.finish(success('API key deleted.')).then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });
      await tick(3);
    });
    expect(settled).toBe('resolved');
    expect(dialog()).toBeNull();
    expect(status(root).textContent).toContain('API key deleted.');
    expect(status(root).textContent).toMatch(/could not be refreshed/i);
    expect(root.textContent).not.toMatch(/not deleted|could not confirm|synthetic-refresh-failure/i);
    expect(root.querySelector('a[data-testid="key-list-reload"]')?.hasAttribute('data-sveltekit-reload')).toBe(true);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });

  it('control: a refresh that succeeds shows no reload link', async () => {
    const { root } = await mount();
    await openDelete(root, 'live');
    const d = await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    await d.finish(success('API key deleted.')); await tick(3);
    expect(status(root).textContent).toBe('API key deleted.');
    expect(root.querySelector('[data-testid="key-list-reload"]')).toBeNull();
  });
});

describe('#1011 P2 (LOCAL 4ffcde15): the shared notice belongs to the newest accepted action', () => {
  const formOf = (root: HTMLElement, id: string) => root.querySelector<HTMLFormElement>(`[data-key-id="${id}"] form`)!;
  const refusal = (key: 'visibility' | 'deletion', text: string): Result => ({ type: 'failure', status: 400, data: { [key]: { type: 'error', text } } });

  it('an older Unhide reply landing after a newer Delete reply does not replace it', async () => {
    const { root } = await mount();
    const olderUpdate = vi.fn().mockResolvedValue(undefined);
    const older = await submitEnhancedDeferred(formOf(root, 'hidden'), { update: olderUpdate }); flushSync(); await tick(1);
    await openDelete(root, 'live');
    const newer = await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    await newer.finish(refusal('deletion', 'CURRENT DELETE REFUSAL')); await tick(3);
    expect(alert(root).textContent).toBe('CURRENT DELETE REFUSAL');
    await older.finish(refusal('visibility', 'OLDER HIDE REFUSAL')); await tick(3);
    expect(alert(root).textContent).toBe('CURRENT DELETE REFUSAL');
    expect(olderUpdate).not.toHaveBeenCalled();
  });

  it('an older Unhide reply landing while a newer Delete is pending stays out of the notice', async () => {
    const { root } = await mount();
    const older = await submitEnhancedDeferred(formOf(root, 'hidden')); flushSync(); await tick(1);
    await openDelete(root, 'live');
    const newer = await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    await older.finish(refusal('visibility', 'OLDER HIDE REFUSAL')); await tick(3);
    expect(alert(root).textContent).toBe('');
    await newer.finish(refusal('deletion', 'CURRENT DELETE REFUSAL')); await tick(3);
    expect(alert(root).textContent).toBe('CURRENT DELETE REFUSAL');
  });

  it('control: a lone Unhide reply still lands', async () => {
    const { root } = await mount();
    const only = await submitEnhancedDeferred(formOf(root, 'hidden')); flushSync(); await tick(1);
    await only.finish(refusal('visibility', 'LONE HIDE REFUSAL')); await tick(3);
    expect(alert(root).textContent).toBe('LONE HIDE REFUSAL');
  });

  it('an older SUCCESSFUL Unhide still refreshes the list but no longer takes the notice', async () => {
    const { root } = await mount();
    const older = await submitEnhancedDeferred(formOf(root, 'hidden')); flushSync(); await tick(1);
    await openDelete(root, 'live');
    await submitEnhancedDeferred(deleteForm()!); flushSync(); await tick(1);
    const before = navigationCalls.filter((c) => c.fn === 'invalidateAll').length;
    await older.finish({ type: 'success', status: 200, data: { visibility: { type: 'success', text: 'OLDER UNHIDDEN' } } }); await tick(3);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(before + 1);
    expect(status(root).textContent).not.toContain('OLDER UNHIDDEN');
  });
});
