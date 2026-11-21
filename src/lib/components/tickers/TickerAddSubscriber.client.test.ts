/**
 * portal#1497 (MCP cut R7a) — the Add-subscriber chooser, mounted: the roster's
 * three bad states are each their own text, the confirmation names the worker
 * with its Urn (D5), a submit is singular, a refusal leaves the draft in place,
 * and a committed add reloads from the FIRST subscriber page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureUnhandledRejections, mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhanced, submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { TICKER_REFRESH_MARKER_KEY } from '$lib/tickers/ticker-refresh-marker';
import TickerAddSubscriber from './TickerAddSubscriber.svelte';

const WORKERS = [
  { id: 'w-1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' },
  { id: 'w-2', name: null, urn: 'hrn:worker:acme.com:team:unnamed' },
];

const ROSTER = {
  ok: { kind: 'ok', workers: WORKERS },
  hidden: { kind: 'hidden' },
  failed: { kind: 'failed' },
  empty: { kind: 'ok', workers: [] },
};

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  resetStubPage();
  sessionStorage.clear();
});

async function mountAdd(props: Record<string, unknown> = {}) {
  const p = reactiveProps<Record<string, unknown>>({
    appId: 'app-1',
    ticker: { id: 'tk-1', name: 'standup' },
    roster: ROSTER.ok,
    viewerId: 'u-1',
    impersonating: null,
    onRosterRetry: () => {},
    ...props,
  });
  const m = mountComponent(TickerAddSubscriber as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { root: m.target, props: p };
}

async function openChooser(root: HTMLElement) {
  ([...root.querySelectorAll('button')].find((b) => /Add subscriber/.test(b.textContent ?? '')) as HTMLButtonElement).click();
  await tick(2);
  return root.querySelector<HTMLFormElement>('form')!;
}

const SUB_SUCCESS = (target: string) => ({ type: 'success' as const, status: 200, data: { action: 'subscribe', ok: true, target } });

describe('TickerAddSubscriber: the roster’s states', () => {
  it('hidden: the fixed sentence, and no Add control at all', async () => {
    const { root } = await mountAdd({ roster: ROSTER.hidden });
    expect(root.querySelector('[data-testid="ticker-roster-hidden"]')!.textContent).toContain('You can’t list this App’s workers here.');
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('button')).toBeNull();
  });

  it('failed: the fixed sentence with a Retry that re-reads the roster', async () => {
    const retry = vi.fn();
    const { root } = await mountAdd({ roster: ROSTER.failed, onRosterRetry: retry });
    expect(root.querySelector('[data-testid="ticker-roster-failed"]')!.textContent).toContain('Couldn’t load the App’s workers.');
    const again = [...root.querySelectorAll('button')].find((b) => /Try again/.test(b.textContent ?? ''))!;
    again.click();
    await tick(2);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('empty: "No workers to add", never an empty select', async () => {
    const { root } = await mountAdd({ roster: ROSTER.empty });
    expect(root.querySelector('[data-testid="ticker-roster-empty"]')!.textContent).toContain('No workers to add.');
    expect(root.querySelector('select')).toBeNull();
  });

  it('ok: a native select with every worker, named by name, else URN, else id — none dropped', async () => {
    const { root } = await mountAdd({ roster: { kind: 'ok', workers: [
      { id: 'w-1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' },
      { id: 'w-2', name: null, urn: 'hrn:worker:acme.com:team:unnamed' },
      { id: 'w-3', name: null, urn: null },
    ] } });
    const form = await openChooser(root);
    const options = [...form.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toContain('Gaby');
    expect(options).toContain('hrn:worker:acme.com:team:unnamed');
    expect(options).toContain('w-3');
    expect(options.filter((o) => o === 'w-3')).toHaveLength(1);
  });

  it('an impersonation session renders the note, no chooser', async () => {
    const { root } = await mountAdd({ impersonating: 'Ada' });
    expect(root.querySelector('select')).toBeNull();
    expect(root.textContent).toContain('changes are switched off');
  });
});

describe('TickerAddSubscriber: spacing (portal#2376)', () => {
  it('the trailing regions cancel the space-y unit they would leave behind when empty and last', async () => {
    const { root } = await mountAdd({ roster: ROSTER.failed });
    expect(root.querySelector('[data-testid="ticker-roster-failed"]')!.closest('[role="status"]')!.className).toContain('last:idle:-mt-2');
    const { root: ok } = await mountAdd();
    const form = await openChooser(ok);
    const regions = [...form.querySelectorAll<HTMLElement>('[role="status"]')];
    expect(regions.at(-1)!.className).toContain('last:idle:-mt-2');
  });

  it('the collapsed opener is block-level so the trailing cancel can collapse its margin (QA F1)', async () => {
    const { root } = await mountAdd();
    const opener = root.querySelector<HTMLElement>('[data-testid="ticker-add-subscriber"] > button')!;
    expect(opener.className).toContain('block');
    expect(opener.className).not.toContain('inline-block');
    expect(opener.nextElementSibling!.className).toContain('last:idle:-mt-2');
  });
});

describe('TickerAddSubscriber: chooser → confirmation', () => {
  it('choosing a worker shows its Urn chip under the select (D5)', async () => {
    const { root } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    expect(form.querySelector('[title="hrn:worker:acme.com:team:gaby"]')).toBeNull();
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    expect(form.querySelector('[title="hrn:worker:acme.com:team:gaby"]')).not.toBeNull();
  });

  it('the confirmation names the worker, with its Urn, and the form posts exactly that worker id', async () => {
    const { root } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    ([...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    await tick(2);
    const confirm = root.querySelector('[data-testid="ticker-add-confirm"]')!;
    expect(confirm.textContent).toContain('Subscribe Gaby');
    expect(form.querySelector('[title="hrn:worker:acme.com:team:gaby"]')).not.toBeNull();
    expect(new FormData(form).get('worker')).toBe('w-1');
    expect(form.getAttribute('action')).toBe('?/subscribe');
  });

  it('Escape cancels the confirmation (the draft survives) and focus returns to the chooser', async () => {
    const { root } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    ([...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    await tick(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-add-confirm"]')).toBeNull();
    expect(select.value).toBe('w-1'); // the draft survives
    expect(document.activeElement?.textContent).toContain('Continue');
  });
});

describe('TickerAddSubscriber: submits', () => {
  it('a second submit while one is pending is cancelled; the rendered submit is disabled meanwhile', async () => {
    const { root } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    ([...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    await tick(2);
    const submit = [...form.querySelectorAll('button')].find((b) => b.type === 'submit')!;
    const pending = await submitEnhancedDeferred(form);
    expect(submit.disabled).toBe(true);
    const second = await submitEnhanced(form);
    expect(second.cancelled).toBe(true);
    await pending.finish(SUB_SUCCESS('w-1'));
    await tick(2);
  });

  it('a success says the neutral "Subscribed" — the same word for a fresh row and an idempotent one', async () => {
    const { root } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    ([...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    await tick(2);
    await submitEnhancedWithResult(form, SUB_SUCCESS('w-1'));
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-add-result"]')!.textContent).toBe('Subscribed');
    expect(root.textContent).not.toMatch(/already|created/i);
  });

  it('a committed add reloads from the FIRST subscriber page (?after= dropped)', async () => {
    const { root } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    ([...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    await tick(2);
    await submitEnhancedWithResult(form, SUB_SUCCESS('w-1'));
    await tick(2);
    const goto = navigationCalls.find((c) => c.fn === 'goto');
    expect(goto?.args[0]).toBe('/app/apps/app-1/tickers/tk-1');
    expect(JSON.stringify(goto?.args[1])).toContain('"invalidateAll":true');
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull(); // the fence closed behind the reload
  });

  it('a refusal keeps the selection and the draft, shows the sentence, and reports no success', async () => {
    const { root } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    ([...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    await tick(2);
    await submitEnhancedWithResult(form, { type: 'failure', status: 403, data: { refusal: { kind: 'refused', code: 'SUBSCRIBE_FORBIDDEN', message: 'Only this worker’s holder or whoever manages the App can subscribe or unsubscribe it.' } } });
    await tick(2);
    expect(root.querySelector('[data-refusal="refused"]')!.textContent).toContain('Only this worker’s holder');
    expect(select.value).toBe('w-1');
    expect(root.querySelector('[data-testid="ticker-add-result"]')).toBeNull();
    // and the chooser still offers the same draft to correct and retry
    expect(root.querySelector('form')).not.toBeNull();
  });

  it('a FAILED grant announcement is said, once, and never retried', async () => {
    const { root } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    ([...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    await tick(2);
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { action: 'subscribe', ok: true, target: 'w-1', announcementFailed: true } });
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-add-announcement"]')!.textContent).toContain('didn’t go out');
  });

  it('a success for ANOTHER target (a late result) decorates nothing', async () => {
    const { root } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    ([...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    await tick(2);
    await submitEnhancedWithResult(form, SUB_SUCCESS('w-9'));
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-add-result"]')).toBeNull();
  });

  it('changing the ticker (a reused page) resets the draft and every result', async () => {
    const { root, props } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    props.ticker = { id: 'tk-2', name: 'other' };
    await tick(2);
    expect(root.querySelector('select')).toBeNull(); // collapsed back to the opener
    const form2 = await openChooser(root);
    expect(new FormData(form2).get('worker')).toBe(''); // no stale draft
  });
});

// portal#1511 — the sibling of #1502's Remove exclusivity window: a submit that
// triggered a reload holds the chooser until THAT reload settles, and the
// enhance handler resolves first (kit's own post-result work never waits on a
// full navigation).
describe('TickerAddSubscriber: the exclusivity window around its own reload (portal#1511)', () => {
  async function toConfirmation() {
    const { root, props } = await mountAdd();
    const form = await openChooser(root);
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    ([...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement).click();
    await tick(2);
    const submit = [...form.querySelectorAll('button')].find((b) => b.type === 'submit') as HTMLButtonElement;
    return { root, props, form, select, submit };
  }

  // Resolves to true when the promise settled within a few ticks, false when it is still pending.
  async function settled(p: Promise<unknown>): Promise<boolean> {
    let done = false;
    void p.then(() => (done = true), () => (done = true));
    await tick(4);
    return done;
  }

  it('a second submit is refused until the reload settles, and the enhance handler resolves BEFORE it does', async () => {
    const { root, form, select, submit } = await toConfirmation();
    let settleReload!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { settleReload = resolve; });
    const pending = await submitEnhancedDeferred(form);
    const handlerReturned = await settled(pending.finish(SUB_SUCCESS('w-1')));
    expect(handlerReturned).toBe(true); // the handler did not wait on the navigation
    expect(navigationCalls.some((c) => c.fn === 'goto')).toBe(true); // the reload is in flight
    expect(submit.disabled).toBe(true); // …and the chooser is still held
    expect(select.disabled).toBe(true);
    for (const label of [/^Subscribe$|^Subscribing/, /^Cancel$/]) {
      expect(([...form.querySelectorAll('button')].find((b) => label.test((b.textContent ?? '').trim())) as HTMLButtonElement).disabled).toBe(true);
    }
    const second = await submitEnhanced(form);
    expect(second.cancelled).toBe(true);
    expect(navigationCalls.filter((c) => c.fn === 'goto')).toHaveLength(1);
    settleReload();
    await tick(3);
    expect(submit.disabled).toBe(false); // released at settlement
    expect(select.disabled).toBe(false);
    expect(root.querySelector('[data-testid="ticker-add-result"]')!.textContent).toBe('Subscribed');
  });

  it('Escape does not collapse the chooser while its own reload is in flight', async () => {
    const { root, form } = await toConfirmation();
    let settleReload!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { settleReload = resolve; });
    await submitEnhancedWithResult(form, SUB_SUCCESS('w-1'));
    await tick(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(2);
    expect(root.querySelector('form')).not.toBeNull();
    settleReload();
    await tick(3);
  });

  it('a reload that fails releases the chooser and says the page could not reload; the write is not replayed', async () => {
    const { root, form, submit } = await toConfirmation();
    navigationHooks.onGoto = () => Promise.reject(new Error('refresh failed'));
    await submitEnhancedWithResult(form, SUB_SUCCESS('w-1'));
    await tick(3);
    expect(submit.disabled).toBe(false);
    expect(root.querySelector('[data-testid="ticker-add-refresh-failed"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="ticker-add-result"]')!.textContent).toBe('Subscribed'); // the write stands
    expect(navigationCalls.filter((c) => c.fn === 'goto')).toHaveLength(1);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull();
  });

  it('a refusal has no reload to wait for: the chooser is released with the result', async () => {
    const { form, select } = await toConfirmation();
    await submitEnhancedWithResult(form, { type: 'failure', status: 403, data: { refusal: { kind: 'refused', code: 'SUBSCRIBE_FORBIDDEN', message: 'No.' } } });
    await tick(2);
    // a refusal closes the confirmation, so the submit is gone: the rest of the chooser is what must be live
    expect([...form.querySelectorAll('button')].some((b) => b.disabled)).toBe(false);
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('w-1');
    expect(navigationCalls.some((c) => c.fn === 'goto')).toBe(false);
  });

  it('unmounting mid-reload leaves nothing stuck and throws nothing when the reload settles late', async () => {
    const { form } = await toConfirmation();
    let settleReload!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { settleReload = resolve; });
    await submitEnhancedWithResult(form, SUB_SUCCESS('w-1'));
    await tick(2);
    const errors = await captureUnhandledRejections(async () => {
      mounted.pop()!.unmount();
      settleReload();
      await tick(4);
    });
    expect(errors).toEqual([]);
    expect(sessionStorage.getItem(TICKER_REFRESH_MARKER_KEY)).toBeNull(); // a foreign settle closes its own fence
    // a fresh mount is a fresh control: its submit is not held by the dead one
    const next = await mountAdd();
    const form2 = await openChooser(next.root);
    expect(form2.querySelector<HTMLSelectElement>('select')!.disabled).toBe(false);
  });

  it.each(['settles', 'fails'] as const)('a reload that %s after the page moved to another ticker writes nothing onto it', async (how) => {
    const { root, props, form } = await toConfirmation();
    let settleReload!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve, reject) => { settleReload = how === 'settles' ? resolve : () => reject(new Error('refresh failed')); });
    await submitEnhancedWithResult(form, SUB_SUCCESS('w-1'));
    await tick(2);
    props.ticker = { id: 'tk-2', name: 'other' };
    await tick(2);
    const form2 = await openChooser(root);
    settleReload();
    await tick(3);
    expect(root.querySelector('[data-testid="ticker-add-result"]')).toBeNull();
    expect(root.querySelector('[data-testid="ticker-add-refresh-failed"]')).toBeNull();
    expect(form2.querySelector<HTMLSelectElement>('select')!.disabled).toBe(false);
  });
});
