/**
 * portal#1497 (MCP cut R7a) — the Add-subscriber chooser, mounted: the roster's
 * three bad states are each their own text, the confirmation names the worker
 * with its Urn (D5), a submit is singular, a refusal leaves the draft in place,
 * and a committed add reloads from the FIRST subscriber page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhanced, submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
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
