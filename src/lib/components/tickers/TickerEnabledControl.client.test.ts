/**
 * portal#1497 (MCP cut R7a) — the on/off control, mounted: the POST states the
 * DESIRED value of `enabled` (never a toggle written on click), a submit is
 * singular, and the refresh fence around a committed write behaves (the marker
 * survives exactly when this control was unmounted by its own failed refresh).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhanced, submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { holdInvalidateAll, resetNavigationCalls, navigationCalls } from '$lib/test/stubs/app-navigation';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { TICKER_REFRESH_MARKER_KEY } from '$lib/tickers/ticker-refresh-marker';
import TickerEnabledControl from './TickerEnabledControl.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  resetStubPage();
  sessionStorage.clear();
});

async function mountControl(props: Record<string, unknown> = {}) {
  const p = reactiveProps<Record<string, unknown>>({
    appId: 'app-1',
    ticker: { id: 'tk-1', enabled: true },
    after: null,
    viewerId: 'u-1',
    impersonating: null,
    ...props,
  });
  const m = mountComponent(TickerEnabledControl as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { root: m.target, props: p, unmount: m.unmount };
}

const formOf = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form')!;
const enabledOf = (root: HTMLElement) => formOf(root).querySelector<HTMLInputElement>('input[name="enabled"]')!.value;
const submitOf = (root: HTMLElement) => [...root.querySelectorAll('button')].find((b) => b.type === 'submit')!;

const SUCCESS_OFF = { type: 'success' as const, status: 200, data: { action: 'set-enabled', ok: true, target: { tickerId: 'tk-1' }, enabled: false } };
const SUCCESS_ON = { type: 'success' as const, status: 200, data: { action: 'set-enabled', ok: true, target: { tickerId: 'tk-1' }, enabled: true } };
const REFUSAL = { type: 'failure' as const, status: 403, data: { refusal: { kind: 'refused', code: 'FORBIDDEN', message: 'You can’t turn this ticker on or off.' } } };

describe('TickerEnabledControl: the intent', () => {
  it('a ticking ticker posts enabled=false as a literal; a disabled one posts true — never a toggle', async () => {
    const on = await mountControl();
    expect(enabledOf(on.root)).toBe('false');
    expect(submitOf(on.root).textContent).toContain('Turn off');

    const off = await mountControl({ ticker: { id: 'tk-1', enabled: false } });
    expect(enabledOf(off.root)).toBe('true');
    expect(submitOf(off.root).textContent).toContain('Turn on');
  });

  it('the action URL keeps the page’s own ?after= slice', async () => {
    const { root } = await mountControl({ after: 'cursor-9' });
    expect(formOf(root).getAttribute('action')).toBe('?/set-enabled&after=cursor-9');
    const bare = await mountControl();
    expect(formOf(bare.root).getAttribute('action')).toBe('?/set-enabled');
  });

  it('an impersonation session renders no form at all', async () => {
    const { root } = await mountControl({ impersonating: 'Ada' });
    expect(root.querySelector('form')).toBeNull();
    expect(root.textContent).toContain('changes are switched off');
  });
});

describe('TickerEnabledControl: one submit at a time', () => {
  it('a second submit while one is pending is cancelled, and the rendered button is disabled meanwhile', async () => {
    const { root } = await mountControl();
    const form = formOf(root);
    const pending = await submitEnhancedDeferred(form);
    // The button the reader actually clicks is disabled while the request runs…
    expect(submitOf(root).disabled).toBe(true);
    // …and the stub-lane equivalent of a second click is refused by the control.
    const second = await submitEnhanced(form);
    expect(second.cancelled).toBe(true);
    await pending.finish(SUCCESS_OFF);
    await tick(2);
    expect(submitOf(root).disabled).toBe(false);
  });
});

describe('TickerEnabledControl: outcomes', () => {
  it('a success whose echo equals the desire says "Turned off." and reloads the page’s own view', async () => {
    const { root } = await mountControl();
    await submitEnhancedWithResult(formOf(root), SUCCESS_OFF);
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-enabled-result"]')!.textContent).toContain('Turned off.');
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    // The marker is a fence around the refresh, not a residue: it is gone once the reload landed.
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('the off copy says the subscribers are kept, and never that it removes anyone (cor:agt:080:06)', async () => {
    const { root } = await mountControl();
    expect(root.textContent).toContain('Turning it off keeps its subscribers');
    expect(root.textContent).not.toMatch(/remove|unsubscrib/i);
  });

  it('a refusal is shown as the fixed sentence with its code, and reports no success', async () => {
    const { root } = await mountControl();
    await submitEnhancedWithResult(formOf(root), REFUSAL);
    await tick(2);
    expect(root.querySelector('[data-refusal="refused"]')!.textContent).toContain('You can’t turn this ticker on or off.');
    expect(root.querySelector('[data-testid="ticker-enabled-result"]')!.textContent!.trim()).toBe('');
  });

  it('an unknown transport outcome is the fixed uncertain line, never an automatic retry', async () => {
    const { root } = await mountControl();
    await submitEnhancedWithResult(formOf(root), { type: 'failure', status: 502, data: { refusal: { kind: 'uncertain' } } });
    await tick(2);
    expect(root.querySelector('[data-refusal="uncertain"]')!.textContent).toContain('may or may not have gone through');
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });
});

describe('TickerEnabledControl: the refresh fence (marker)', () => {
  it('a refresh that rejects says "Saved; the page couldn’t reload", never "not changed", and clears the marker', async () => {
    const { root } = await mountControl();
    const { navigationHooks } = await import('$lib/test/stubs/app-navigation');
    navigationHooks.onInvalidateAll = () => {
      throw new Error('load failed');
    };
    await submitEnhancedWithResult(formOf(root), SUCCESS_OFF);
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-refresh-failed"]')!.textContent).toContain('Saved; the page couldn’t reload.');
    expect(root.textContent).not.toContain('Not changed');
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('unmounted by its OWN failed refresh (this ticker’s error page): the marker stays for the boundary', async () => {
    const { root, unmount } = await mountControl();
    const release = holdInvalidateAll();
    const pending = await submitEnhancedDeferred(formOf(root));
    setStubPage('http://localhost/app/apps/app-1/tickers/tk-1', { appId: 'app-1', tickerId: 'tk-1' });
    page.update((p) => ({ ...p, error: new Error('load failed') }));
    const finished = pending.finish(SUCCESS_OFF); // the handler parks on the held reload
    await tick(1);
    unmount(); // kit’s error route unmounts the control
    release();
    await finished;
    await tick(2);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).not.toBeNull();
  });

  it('unmounted with the page NOT on this ticker’s error page: the marker is removed', async () => {
    const { root, unmount } = await mountControl();
    const release = holdInvalidateAll();
    const pending = await submitEnhancedDeferred(formOf(root));
    setStubPage('http://localhost/app/apps/app-1/tickers/tk-1', { appId: 'app-1', tickerId: 'tk-1' }); // no error
    const finished = pending.finish(SUCCESS_OFF);
    await tick(1);
    unmount();
    release();
    await finished;
    await tick(2);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('a result that lands after the ticker changed (reused page) attaches to nothing', async () => {
    const { root, props } = await mountControl();
    const pending = await submitEnhancedDeferred(formOf(root));
    props.ticker = { id: 'tk-2', enabled: true }; // the route reused for another ticker
    await tick(2);
    await pending.finish(SUCCESS_OFF);
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-enabled-result"]')!.textContent!.trim()).toBe('');
  });
});
