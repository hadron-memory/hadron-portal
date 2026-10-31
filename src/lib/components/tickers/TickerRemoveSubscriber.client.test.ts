/**
 * portal#1497 (MCP cut R7a) / portal#1502 (review) — the Remove panel the page
 * mounts above the subscribers table: the form carries its own id, a submit is
 * singular, a committed remove reloads from the FIRST subscriber page, and a
 * stale-row refusal (SUBSCRIPTION_NOT_FOUND) reloads too — through NO marker,
 * because a refused write must never claim "the write stands" on the error
 * boundary (Gemma P2-1 and Gaby's P2, found independently).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhanced, submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { TICKER_REFRESH_MARKER_KEY } from '$lib/tickers/ticker-refresh-marker';
import TickerRemoveSubscriber from './TickerRemoveSubscriber.svelte';

const ROW = { subscription: { id: 's-17' }, worker: { id: 'w-2', name: 'Liam', urn: 'hrn:worker:acme.com:team:liam' } };

const mounted: Array<Mounted<Record<string, unknown>>> = [];
let closed = 0;
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  sessionStorage.clear();
});

async function mountRemove(props: Record<string, unknown> = {}) {
  closed = 0;
  const p = reactiveProps<Record<string, unknown>>({
    appId: 'app-1',
    ticker: { id: 'tk-1', name: 'standup' },
    subscription: ROW.subscription,
    worker: ROW.worker,
    viewerId: 'u-1',
    onClose: () => { closed++; },
    busy: false,
    ...props,
  });
  const m = mountComponent(TickerRemoveSubscriber as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { root: m.target, props: p };
}

/** The panel's confirmation form — present from the panel's first paint. */
const formOf = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form')!;
const cancelButton = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLButtonElement>('button[type="button"]')].find((b) => /Cancel/.test(b.textContent ?? ''))!;

const UNSUB_SUCCESS = { type: 'success' as const, status: 200, data: { action: 'unsubscribe', ok: true, target: 'w-2' } };
const STALE_ROW = { type: 'failure' as const, status: 404, data: { refusal: { kind: 'refused', code: 'SUBSCRIPTION_NOT_FOUND', message: 'No longer subscribed. The list is back at its first page.' } } };

describe('TickerRemoveSubscriber: the panel', () => {
  it('carries its own form (unsubscribe-<subscriptionId>) from first paint and posts exactly the worker ref', async () => {
    const { root } = await mountRemove();
    const form = formOf(root);
    expect(form.id).toBe('unsubscribe-s-17');
    expect(form.getAttribute('action')).toBe('?/unsubscribe');
    expect(form.getAttribute('method')?.toLowerCase()).toBe('post');
    expect(new FormData(form).get('worker')).toBe('w-2');
  });

  it('the confirmation names the worker, with its Urn', async () => {
    const { root } = await mountRemove();
    const form = formOf(root);
    expect(form.textContent).toContain('Remove Liam');
    expect(form.querySelector('[title="hrn:worker:acme.com:team:liam"]')).not.toBeNull();
  });

  it('a nameless worker is named by its URN, never dropped', async () => {
    const { root } = await mountRemove({ worker: { id: 'w-9', name: null, urn: 'hrn:worker:acme.com:team:nine' } });
    expect(formOf(root).textContent).toContain('hrn:worker:acme.com:team:nine');
  });

  it('the result line is an always-present live region, empty until there is a result', async () => {
    const { root } = await mountRemove();
    const region = root.querySelector<HTMLParagraphElement>('[data-testid="ticker-remove-result-s-17"]')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent).toBe('');
  });

  it('Escape closes the panel (the page refocuses the row’s trigger)', async () => {
    await mountRemove();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(2);
    expect(closed).toBe(1);
  });

  it('Cancel closes the panel too', async () => {
    const { root } = await mountRemove();
    cancelButton(root).click();
    await tick(2);
    expect(closed).toBe(1);
  });
});

describe('TickerRemoveSubscriber: submits', () => {
  it('a second submit while one is pending is cancelled; busy stays held meanwhile', async () => {
    const { root, props } = await mountRemove();
    const form = formOf(root);
    const submit = [...form.querySelectorAll('button')].find((b) => b.type === 'submit')!;
    const pending = await submitEnhancedDeferred(form);
    expect(submit.disabled).toBe(true);
    expect(props.busy).toBe(true);
    const second = await submitEnhanced(form);
    expect(second.cancelled).toBe(true);
    await pending.finish(UNSUB_SUCCESS);
    await tick(2);
    expect(props.busy).toBe(false);
  });

  it('an unmount mid-flight releases busy', async () => {
    const { root, props } = await mountRemove();
    const pending = await submitEnhancedDeferred(formOf(root));
    expect(props.busy).toBe(true);
    mounted.pop()!.unmount();
    await tick(2);
    expect(props.busy).toBe(false);
    await pending.finish(UNSUB_SUCCESS);
  });

  it('a success says "Removed", reloads from the FIRST subscriber page, and closes the fence', async () => {
    const { root } = await mountRemove();
    await submitEnhancedWithResult(formOf(root), UNSUB_SUCCESS);
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-remove-result-s-17"]')!.textContent).toContain('Removed');
    const goto = navigationCalls.find((c) => c.fn === 'goto');
    expect(goto?.args[0]).toBe('/app/apps/app-1/tickers/tk-1');
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('a stale-row refusal (SUBSCRIPTION_NOT_FOUND) reloads to the FIRST page — the copy says the list is back there', async () => {
    const { root } = await mountRemove();
    await submitEnhancedWithResult(formOf(root), STALE_ROW);
    await tick(2);
    expect(root.querySelector('[data-refusal="refused"]')!.textContent).toContain('No longer subscribed');
    expect(root.querySelector('[data-testid="ticker-remove-result-s-17"]')!.textContent).not.toContain('Removed');
    const goto = navigationCalls.find((c) => c.fn === 'goto');
    expect(goto?.args[0]).toBe('/app/apps/app-1/tickers/tk-1');
  });

  it('…and leaves NO refresh marker when the reload resolves: a refused write may never claim "the write stands"', async () => {
    const { root } = await mountRemove();
    await submitEnhancedWithResult(formOf(root), STALE_ROW);
    await tick(2);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('…and when the reload itself fails: the inline refresh line, still no marker', async () => {
    const { root } = await mountRemove();
    navigationHooks.onGoto = () => Promise.reject(new Error('refresh failed'));
    await submitEnhancedWithResult(formOf(root), STALE_ROW);
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-remove-refresh-failed-s-17"]')).not.toBeNull();
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('any other refusal keeps the confirmation open (retry by hand, or cancel)', async () => {
    const { root } = await mountRemove();
    await submitEnhancedWithResult(formOf(root), { type: 'failure', status: 403, data: { refusal: { kind: 'refused', code: 'SUBSCRIBE_FORBIDDEN', message: 'Only this worker’s holder or whoever manages the App can subscribe or unsubscribe it.' } } });
    await tick(2);
    expect(root.querySelector('[data-refusal="refused"]')!.textContent).toContain('holder');
    expect(formOf(root)).toBeTruthy();
  });

  it('a success for ANOTHER worker (a late result of another row) decorates nothing', async () => {
    const { root } = await mountRemove();
    await submitEnhancedWithResult(formOf(root), { type: 'success', status: 200, data: { action: 'unsubscribe', ok: true, target: 'w-9' } });
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-remove-result-s-17"]')!.textContent).not.toContain('Removed');
  });

  it('changing the ticker (a reused page) resets the panel', async () => {
    const { root, props } = await mountRemove();
    await submitEnhancedWithResult(formOf(root), { type: 'failure', status: 403, data: { refusal: { kind: 'refused', code: 'SUBSCRIBE_FORBIDDEN', message: 'x' } } });
    await tick(2);
    expect(root.querySelector('[data-refusal]')).not.toBeNull();
    props.ticker = { id: 'tk-2', name: 'other' };
    await tick(2);
    expect(root.querySelector('[data-refusal]')).toBeNull();
    expect(formOf(root)).toBeTruthy();
  });
});
