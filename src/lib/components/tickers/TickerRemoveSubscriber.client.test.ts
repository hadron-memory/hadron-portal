/**
 * portal#1497 (MCP cut R7a) — the per-row Remove control, mounted: the row's
 * form has its own id, the confirmation names the worker with its Urn, a
 * submit is singular, a refusal leaves the row intact, and a committed remove
 * reloads from the FIRST subscriber page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhanced, submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { TICKER_REFRESH_MARKER_KEY } from '$lib/tickers/ticker-refresh-marker';
import TickerRemoveSubscriber from './TickerRemoveSubscriber.svelte';

const ROW = { subscription: { id: 's-17' }, worker: { id: 'w-2', name: 'Liam', urn: 'hrn:worker:acme.com:team:liam' } };

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  sessionStorage.clear();
});

async function mountRemove(props: Record<string, unknown> = {}) {
  const p = reactiveProps<Record<string, unknown>>({
    appId: 'app-1',
    ticker: { id: 'tk-1', name: 'standup' },
    subscription: ROW.subscription,
    worker: ROW.worker,
    viewerId: 'u-1',
    impersonating: null,
    ...props,
  });
  const m = mountComponent(TickerRemoveSubscriber as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { root: m.target, props: p };
}

async function openConfirm(root: HTMLElement) {
  ([...root.querySelectorAll('button')].find((b) => /Remove/.test(b.textContent ?? '')) as HTMLButtonElement).click();
  await tick(2);
  return root.querySelector<HTMLFormElement>('form')!;
}

const UNSUB_SUCCESS = { type: 'success' as const, status: 200, data: { action: 'unsubscribe', ok: true, target: 'w-2' } };

describe('TickerRemoveSubscriber: the row’s control', () => {
  it('renders for the row whatever the roster said — it takes no roster at all', async () => {
    const { root } = await mountRemove();
    expect(root.textContent).toContain('Remove');
    expect(root.querySelector('form')).toBeNull(); // collapsed until asked
  });

  it('an impersonation session renders the note, no control', async () => {
    const { root } = await mountRemove({ impersonating: 'Ada' });
    expect(root.querySelector('button[type="button"]')).toBeNull();
    expect(root.textContent).toContain('changes are switched off');
  });

  it('the confirming form carries its own id (unsubscribe-<subscriptionId>) and posts exactly the worker ref', async () => {
    const { root } = await mountRemove();
    const form = await openConfirm(root);
    expect(form.id).toBe('unsubscribe-s-17');
    expect(form.getAttribute('action')).toBe('?/unsubscribe');
    expect(form.getAttribute('method')?.toLowerCase()).toBe('post');
    expect(new FormData(form).get('worker')).toBe('w-2');
  });

  it('the confirmation names the worker, with its Urn', async () => {
    const { root } = await mountRemove();
    const form = await openConfirm(root);
    expect(form.textContent).toContain('Remove Liam');
    expect(form.querySelector('[title="hrn:worker:acme.com:team:liam"]')).not.toBeNull();
  });

  it('a nameless worker is named by its URN, never dropped', async () => {
    const { root } = await mountRemove({ worker: { id: 'w-9', name: null, urn: 'hrn:worker:acme.com:team:nine' } });
    const form = await openConfirm(root);
    expect(form.textContent).toContain('hrn:worker:acme.com:team:nine');
  });

  it('Escape cancels the confirmation and focus returns to the row’s button', async () => {
    const { root } = await mountRemove();
    const form = await openConfirm(root);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(2);
    expect(root.querySelector('form')).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.textContent).toContain('Remove');
  });
});

describe('TickerRemoveSubscriber: submits', () => {
  it('a second submit while one is pending is cancelled; the rendered submit is disabled meanwhile', async () => {
    const { root } = await mountRemove();
    const form = await openConfirm(root);
    const submit = [...form.querySelectorAll('button')].find((b) => b.type === 'submit')!;
    const pending = await submitEnhancedDeferred(form);
    expect(submit.disabled).toBe(true);
    const second = await submitEnhanced(form);
    expect(second.cancelled).toBe(true);
    await pending.finish(UNSUB_SUCCESS);
    await tick(2);
  });

  it('a success says "Removed", reloads from the FIRST subscriber page, and closes the fence', async () => {
    const { root } = await mountRemove();
    const form = await openConfirm(root);
    await submitEnhancedWithResult(form, UNSUB_SUCCESS);
    await tick(2);
    expect(root.textContent).toContain('Removed');
    const goto = navigationCalls.find((c) => c.fn === 'goto');
    expect(goto?.args[0]).toBe('/app/apps/app-1/tickers/tk-1');
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('a refusal (the stale-row case) shows the fixed sentence and offers the row again', async () => {
    const { root } = await mountRemove();
    const form = await openConfirm(root);
    await submitEnhancedWithResult(form, { type: 'failure', status: 404, data: { refusal: { kind: 'refused', code: 'SUBSCRIPTION_NOT_FOUND', message: 'No longer subscribed. The list is back at its first page.' } } });
    await tick(2);
    expect(root.querySelector('[data-refusal="refused"]')!.textContent).toContain('No longer subscribed');
    expect(root.textContent).not.toContain('Removed');
    // the confirmation collapsed; the row's control is offered again for a retry by hand
    expect([...root.querySelectorAll('button')].some((b) => /Remove/.test(b.textContent ?? ''))).toBe(true);
  });

  it('a success for ANOTHER worker (a late result of another row) decorates nothing', async () => {
    const { root } = await mountRemove();
    const form = await openConfirm(root);
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { action: 'unsubscribe', ok: true, target: 'w-9' } });
    await tick(2);
    expect(root.textContent).not.toContain('Removed');
  });

  it('changing the ticker (a reused page) resets the confirmation', async () => {
    const { root, props } = await mountRemove();
    await openConfirm(root);
    props.ticker = { id: 'tk-2', name: 'other' };
    await tick(2);
    expect(root.querySelector('form')).toBeNull();
  });
});
