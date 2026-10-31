/**
 * portal#1497 (MCP cut R7a) / portal#1502 (review) — the Remove panel the page
 * mounts above the subscribers table: the form carries its own id, a submit is
 * singular, a committed remove reloads from the FIRST subscriber page, and a
 * stale-row refusal (SUBSCRIPTION_NOT_FOUND) reloads too — through NO refresh
 * marker, because a refused write must never claim "the write stands" on the
 * error boundary (Gemma P2-1 and Gaby's P2, found independently). The refusal
 * sentence survives a document FALLBACK through its own outcome marker
 * (portal#1502, Colette QA delta) — present only while the reload is
 * unsettled, cleared at live settlement.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhanced, submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { TICKER_REFRESH_MARKER_KEY } from '$lib/tickers/ticker-refresh-marker';
import { TICKER_REMOVE_OUTCOME_MARKER_KEY } from '$lib/tickers/ticker-remove-outcome-marker';
import TickerRemoveSubscriber from './TickerRemoveSubscriber.svelte';

const ROW = { subscription: { id: 's-17' }, worker: { id: 'w-2', name: 'Liam', urn: 'hrn:worker:acme.com:team:liam' } };

const mounted: Array<Mounted<Record<string, unknown>>> = [];
let closed = 0;
let outcomes: Array<Record<string, unknown>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  sessionStorage.clear();
});

async function mountRemove(props: Record<string, unknown> = {}) {
  closed = 0;
  outcomes = [];
  const p = reactiveProps<Record<string, unknown>>({
    appId: 'app-1',
    ticker: { id: 'tk-1', name: 'standup' },
    subscription: ROW.subscription,
    worker: ROW.worker,
    viewerId: 'u-1',
    onClose: () => { closed++; },
    onOutcome: (o: Record<string, unknown>) => { outcomes.push(o); },
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

  it('Escape inside the panel closes it (the page refocuses the row’s trigger)', async () => {
    const { root } = await mountRemove();
    formOf(root).querySelector<HTMLButtonElement>('button[type="submit"]')!.focus();
    root.querySelector('[data-testid="ticker-remove-confirm-s-17"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(2);
    expect(closed).toBe(1);
  });

  it('Escape OUTSIDE the panel leaves it open (portal#1502 delta: the handler is the panel’s own, not the window’s)', async () => {
    const { root } = await mountRemove();
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await tick(2);
      expect(closed).toBe(0);
      expect(formOf(root)).toBeTruthy();
    } finally {
      other.remove();
    }
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

  it('busy stays held until the reload settles and the outcome is delivered — not when the result arrives (portal#1502 BLIND delta, Gizelle P2-1)', async () => {
    const { root, props } = await mountRemove();
    let settleReload!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { settleReload = resolve; });
    await submitEnhancedWithResult(formOf(root), UNSUB_SUCCESS);
    await tick(2);
    expect(props.busy).toBe(true); // the result is in; the reload it caused is not
    settleReload();
    await tick(2);
    expect(outcomes).toHaveLength(1); // the outcome was delivered at settlement
    expect(props.busy).toBe(false);
  });

  it('a success reports "Removed <worker>" — with the ticker it happened on and the worker’s Urn — to the page (it outlives the panel’s unmount), reloads from the FIRST subscriber page, and closes the fence', async () => {
    const { root } = await mountRemove();
    await submitEnhancedWithResult(formOf(root), UNSUB_SUCCESS);
    await tick(2);
    // portal#1502 BLIND/UX deltas: the outcome names whom (Uma P3-1 / Gaby
    // P3-2 — the row is gone, this sentence is all that’s left) and carries
    // the ticker id, so the page can fence it by entity on its reused route
    // (Gaby P2 — a removal of tk-1 may claim nothing on tk-2).
    expect(outcomes).toContainEqual({ tickerId: 'tk-1', subscriptionId: 's-17', text: 'Removed Liam', workerUrn: 'hrn:worker:acme.com:team:liam', announcementFailed: false, refreshFailed: false });
    const goto = navigationCalls.find((c) => c.fn === 'goto');
    expect(goto?.args[0]).toBe('/app/apps/app-1/tickers/tk-1');
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('a stale-row refusal (SUBSCRIPTION_NOT_FOUND) reports its sentence to the page and reloads to the FIRST page — the copy says the list is back there', async () => {
    const { root } = await mountRemove();
    await submitEnhancedWithResult(formOf(root), STALE_ROW);
    await tick(2);
    expect(root.querySelector('[data-refusal="refused"]')!.textContent).toContain('No longer subscribed');
    expect(outcomes).toContainEqual({ tickerId: 'tk-1', subscriptionId: 's-17', text: 'No longer subscribed. The list is back at its first page.', workerUrn: null, announcementFailed: false, refreshFailed: false });
    const goto = navigationCalls.find((c) => c.fn === 'goto');
    expect(goto?.args[0]).toBe('/app/apps/app-1/tickers/tk-1');
  });

  it('…and leaves NO refresh marker when the reload resolves: a refused write may never claim "the write stands" — and no outcome marker either: the sentence was delivered live (Colette QA delta)', async () => {
    const { root } = await mountRemove();
    await submitEnhancedWithResult(formOf(root), STALE_ROW);
    await tick(2);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
  });

  it('…and when the reload never settles (the document FALLBACK proxy): the outcome marker carries the server’s sentence to the fresh page, and only until settlement (Colette QA delta)', async () => {
    const { root } = await mountRemove();
    // In a real kit an aborted data refresh does not reject — the router
    // falls back to a full document navigation and the settle continuation
    // dies with the old document. A goto that never settles is that proxy.
    let settleReload!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { settleReload = resolve; });
    await submitEnhancedWithResult(formOf(root), STALE_ROW);
    await tick(2);
    const raw = sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY);
    expect(raw).not.toBeNull();
    const marker = JSON.parse(raw!) as { viewer: string; appId: string; tickerId: string; subscriptionId: string; sentence: string };
    expect(marker).toMatchObject({ viewer: 'u-1', appId: 'app-1', tickerId: 'tk-1', subscriptionId: 's-17', sentence: 'No longer subscribed. The list is back at its first page.' });
    // Settlement, when a live navigation DOES reach it, retires the marker:
    // the outcome was delivered live, so the sentence may not surface twice.
    settleReload();
    await tick(2);
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull();
  });

  it('…and when the reload itself fails: the base sentence claims no navigation that did not happen, no marker (Uma P2 / Gizelle delta)', async () => {
    const { root } = await mountRemove();
    navigationHooks.onGoto = () => Promise.reject(new Error('refresh failed'));
    await submitEnhancedWithResult(formOf(root), STALE_ROW);
    await tick(2);
    // The reload failed, so "the list is back at its first page" would claim a
    // navigation that never happened, and "Saved" a write the server refused:
    // the outcome carries only the first truth (no longer subscribed), and the
    // caveat names the reload. The WHOLE panel says the same — including its
    // refusal alert, which is suppressed in this state (its sentence is the
    // false one).
    expect(outcomes).toContainEqual({ tickerId: 'tk-1', subscriptionId: 's-17', text: 'No longer subscribed.', workerUrn: null, announcementFailed: false, refreshFailed: 'refused' });
    const panel = root.querySelector('#ticker-remove-panel-s-17')!;
    expect(panel.textContent).toContain('No longer subscribed.');
    expect(panel.textContent).not.toContain('first page');
    expect(panel.textContent).not.toContain('Saved');
    expect(root.querySelector('[data-testid="ticker-remove-refresh-failed-s-17"]')!.textContent).toBe('The page couldn’t reload.');
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
    expect(sessionStorage.getItem(TICKER_REMOVE_OUTCOME_MARKER_KEY)).toBeNull(); // delivered live, with the corrected copy
  });

  it('a COMMITTED removal whose reload fails keeps its own caveat — "Saved; …" is true there (the write stands)', async () => {
    const { root } = await mountRemove();
    navigationHooks.onGoto = () => Promise.reject(new Error('refresh failed'));
    await submitEnhancedWithResult(formOf(root), UNSUB_SUCCESS);
    await tick(2);
    expect(outcomes).toContainEqual({ tickerId: 'tk-1', subscriptionId: 's-17', text: 'Removed Liam', workerUrn: 'hrn:worker:acme.com:team:liam', announcementFailed: false, refreshFailed: 'committed' });
    expect(root.querySelector('[data-testid="ticker-remove-refresh-failed-s-17"]')!.textContent).toBe('Saved; the page couldn’t reload.');
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

  it('…and takes no lock: a foreign result releases busy with the result, not at its reload’s settlement (cd0ded22 self-review)', async () => {
    const { root, props } = await mountRemove();
    let settleReload!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { settleReload = resolve; });
    await submitEnhancedWithResult(formOf(root), { type: 'success', status: 200, data: { action: 'unsubscribe', ok: true, target: 'w-9' } });
    await tick(2);
    // Not this panel's write: no exclusivity window is owed for it, so the
    // page's other rows are not held for a reload this result merely caused.
    expect(props.busy).toBe(false);
    settleReload();
    await tick(2);
    expect(outcomes).toHaveLength(0); // and nothing is reported for a row that wasn't removed
  });

  it('a foreign result claims NOTHING of its reload either: no refresh marker is left in this row’s name, and a failed reload decorates this panel with no caveat (28b680ce review)', async () => {
    const { root } = await mountRemove();
    // The reload is held PENDING for the mid-flight assert below: a mutant
    // that opens the fence for a foreign result leaves its marker exactly
    // here, where nothing has cleared it yet (efae752b review, Gemma P3 /
    // Riana P3-3: an end-state-only assert cannot see it — the settle of a
    // rejected goto clears while mounted, so the mutant survives).
    let rejectReload!: (reason?: unknown) => void;
    navigationHooks.onGoto = () => new Promise<void>((_resolve, reject) => { rejectReload = reject; });
    await submitEnhancedWithResult(formOf(root), { type: 'success', status: 200, data: { action: 'unsubscribe', ok: true, target: 'w-9' } });
    await tick(2);
    // The write was someone else's: no refresh marker may name THIS row's
    // worker — MID-FLIGHT, before any settlement could hide it.
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
    // The reload FAILS from here (044fdfc6 BLIND review, Gizelle P3: a
    // resolved goto exercises only settle(false) — the failure settle is the
    // path a wrong implementation decorates, so this must reject).
    rejectReload(new Error('refresh failed'));
    await tick(2);
    // …and the failure decorates this panel with nothing: the confirmation
    // may not say "Saved; the page couldn't reload." for a removal that never
    // ran.
    const panel = root.querySelector('#ticker-remove-panel-s-17')!;
    expect(panel.textContent).not.toContain('Saved');
    expect(root.querySelector('[data-testid="ticker-remove-refresh-failed-s-17"]')).toBeNull();
    expect(outcomes).toHaveLength(0);
  });

  it('a stale FOREIGN settle may not clobber a newer submit’s panel: its reload caveat arrives only for the attempt that owns the panel (28b680ce review)', async () => {
    const { root } = await mountRemove();
    // Two independent reloads: the foreign one (held), then the reader's OWN
    // re-submit the early release makes possible.
    const settles: Array<() => void> = [];
    const rejects: Array<(reason?: unknown) => void> = [];
    navigationHooks.onGoto = () => new Promise<void>((resolve, reject) => { settles.push(resolve); rejects.push(reject); });
    await submitEnhancedWithResult(formOf(root), { type: 'success', status: 200, data: { action: 'unsubscribe', ok: true, target: 'w-9' } });
    await tick(2);
    await submitEnhancedWithResult(formOf(root), STALE_ROW);
    await tick(2);
    // The OLD, foreign goto now fails — its settle must write nothing into a
    // panel the new attempt owns: no "Saved;" for a write that was neither.
    rejects[0]!(new Error('refresh failed'));
    await tick(2);
    const panel = root.querySelector('#ticker-remove-panel-s-17')!;
    expect(panel.textContent).not.toContain('Saved');
    expect(root.querySelector('[data-testid="ticker-remove-refresh-failed-s-17"]')).toBeNull();
    // The NEW attempt settles its own reload and delivers its own outcome.
    settles[1]!();
    await tick(2);
    expect(outcomes).toContainEqual({ tickerId: 'tk-1', subscriptionId: 's-17', text: 'No longer subscribed. The list is back at its first page.', workerUrn: null, announcementFailed: false, refreshFailed: false });
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
