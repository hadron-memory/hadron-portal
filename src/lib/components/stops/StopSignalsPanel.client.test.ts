/**
 * portal#1139 — the set/lift panel, MOUNTED: the controls each manager hint
 * shows, the confirmation (Cancel focused, per-level copy, no notice promise),
 * single-flight, a refusal that sets nothing, and a late result that must not
 * land on another App or after teardown. Both directions are pinned.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { captureUnhandledRejections, mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { beginEnhanced, submitEnhanced } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import Panel from './StopSignalsPanel.svelte';

const workers = [
  { id: 'w1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' },
  { id: 'w2', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada' },
];

let oldShow: PropertyDescriptor | undefined;
let oldClose: PropertyDescriptor | undefined;
beforeAll(() => {
  oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
});
afterAll(() => {
  for (const [key, old] of [['showModal', oldShow], ['close', oldClose]] as const) {
    if (old) Object.defineProperty(HTMLDialogElement.prototype, key, old);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  document.body.innerHTML = '';
});

async function mountPanel(over: Record<string, unknown> = {}) {
  const props = reactiveProps({ appId: 'app-1', manages: 'yes', workers, impersonating: null, lifting: null, onliftclose: () => {}, ...over });
  const m = mountComponent(Panel as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { root: m.target, props };
}

const setForm = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/set"]')!;
const liftForm = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/lift"]')!;
function choose(root: HTMLElement, worker = 'w1') {
  const sel = root.querySelector<HTMLSelectElement>('#stop-worker')!;
  sel.value = worker;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}
function radio(root: HTMLElement, name: string, value: string) {
  const el = root.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}
async function review(root: HTMLElement) {
  root.querySelector<HTMLButtonElement>('button[data-open-confirm]')!.click();
  await tick(3);
}
const alertText = (root: HTMLElement) => root.querySelector('[role="alert"]')?.textContent ?? '';

describe('what each manager hint shows', () => {
  it('yes: the set form', async () => {
    const { root } = await mountPanel({ manages: 'yes' });
    expect(setForm(root)).not.toBeNull();
    expect(root.querySelector('[data-testid="stop-unknown-hint"]')).toBeNull();
  });

  it('no: read-only, no form', async () => {
    const { root } = await mountPanel({ manages: 'no' });
    expect(setForm(root)).toBeNull();
    expect(root.querySelector('[data-testid="stop-read-only"]')).not.toBeNull();
  });

  it('unknown: explains and offers no controls, never reads as no', async () => {
    const { root } = await mountPanel({ manages: 'unknown' });
    expect(root.querySelector('[data-testid="stop-unknown-hint"]')?.textContent).toContain('Couldn’t check');
    expect(setForm(root)).toBeNull();
    expect(root.querySelector('[data-testid="stop-read-only"]')).toBeNull();
  });

  it('a support session sees no controls even when the hint is yes', async () => {
    const { root } = await mountPanel({ manages: 'yes', impersonating: 'Dana' });
    expect(setForm(root)).toBeNull();
    expect(root.textContent).toContain('Viewing as Dana');
  });
});

describe('the set form', () => {
  it('labels every control and offers the three levels as a radio group', async () => {
    const { root } = await mountPanel();
    expect(root.querySelector('label[for="stop-worker"]')).not.toBeNull();
    expect(root.querySelector('label[for="stop-until"]')).not.toBeNull();
    expect(root.querySelectorAll('input[name="level-choice"]')).toHaveLength(3);
    expect(root.querySelector('fieldset legend')).not.toBeNull();
  });

  it('Review is not a submit: clicking it opens the dialog and sends nothing', async () => {
    const { root } = await mountPanel();
    choose(root);
    const button = root.querySelector<HTMLButtonElement>('button[data-open-confirm]')!;
    expect(button.type).toBe('button');
    await review(root);
    expect(root.querySelector('dialog')!.open).toBe(true);
  });

  it('a submit that arrives before the confirmation is cancelled, not sent', async () => {
    const { root } = await mountPanel();
    choose(root);
    expect((await submitEnhanced(setForm(root))).cancelled).toBe(true);
    await tick(3);
    expect(root.querySelector('dialog')!.open).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-testid="stop-confirm-cancel"]')!.click();
    await tick(2);
    expect(root.querySelector('dialog')).toBeNull();
  });

  it('review without a worker shows a message and opens no confirmation', async () => {
    const { root } = await mountPanel();
    await review(root);
    expect(alertText(root)).toContain('Choose a worker');
    expect(root.querySelector('dialog')).toBeNull();
  });

  it('opens a confirmation with Cancel focused, naming the level, the target and its coverage', async () => {
    const { root } = await mountPanel();
    radio(root, 'scope-choice', 'TEAM');
    radio(root, 'level-choice', 'PAUSE');
    choose(root, 'w1');
    await review(root);
    const dialog = root.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(dialog.querySelector('[data-testid="stop-confirm-cancel"]'));
    expect(dialog.textContent).toContain('Pause');
    expect(dialog.textContent).toContain('Gaby');
    expect(dialog.textContent).toContain('every worker reporting to it');
    expect(dialog.textContent).toContain('Messages are not held');
  });

  it('sends the reader’s instant with its zone and shows the worker URN in the confirmation', async () => {
    const { root } = await mountPanel();
    choose(root);
    const input = root.querySelector<HTMLInputElement>('#stop-until')!;
    input.value = '2099-10-30T14:00';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
    expect(input.name).toBe('');
    expect(root.querySelector<HTMLInputElement>('input[type="hidden"][name="until"]')!.value).toBe(new Date('2099-10-30T14:00').toISOString());
    await review(root);
    const dialog = root.querySelector('dialog')!;
    expect(dialog.textContent).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(dialog.textContent).not.toContain('2099-10-30T14:00');
    expect(dialog.textContent).toContain('acme.com:team:gaby');
  });

  it('an unparseable until sends no end time and the dialog says the stop runs until lifted (#1413 A1)', async () => {
    const { root } = await mountPanel();
    choose(root);
    const input = root.querySelector<HTMLInputElement>('#stop-until')!;
    // jsdom keeps whatever is assigned; a browser can hand back a value the
    // Date constructor rejects, which is the case the guard must not trust.
    Object.defineProperty(input, 'value', { configurable: true, get: () => 'not-a-date', set: () => {} });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(2);
    const sent = root.querySelector<HTMLInputElement>('input[type="hidden"][name="until"]')!.value;
    expect(sent).toBe('');
    await review(root);
    const text = root.querySelector('dialog')!.textContent ?? '';
    expect(text).not.toContain('ends on its own');
    expect(text).toContain('until someone lifts it');
  });

  it('PAUSE_DISPATCH does not claim ticks or stall time stop; PAUSE does', async () => {
    const { root } = await mountPanel();
    choose(root);
    await review(root);
    expect(root.querySelector('dialog')!.textContent).toContain('Its ticks, its messages and its stall time are not affected');
    root.querySelector<HTMLButtonElement>('[data-testid="stop-confirm-cancel"]')!.click();
    await tick(2);
    radio(root, 'level-choice', 'PAUSE');
    await review(root);
    expect(root.querySelector('dialog')!.textContent).toContain('no ticks');
  });

  it('HALT copy promises no interruption and no notice', async () => {
    const { root } = await mountPanel();
    radio(root, 'level-choice', 'HALT');
    choose(root);
    await review(root);
    const text = root.querySelector('dialog')!.textContent ?? '';
    expect(text).toContain('Interrupting a worker is not available yet');
    expect(text).toContain('no one is told');
    expect(text).not.toMatch(/will be (told|notified|interrupted)/i);
  });

  it('Cancel closes the confirmation and sends nothing', async () => {
    const { root } = await mountPanel();
    choose(root);
    await review(root);
    root.querySelector<HTMLButtonElement>('[data-testid="stop-confirm-cancel"]')!.click();
    await tick(2);
    expect(root.querySelector('dialog')).toBeNull();
    expect(navigationCalls).toHaveLength(0);
  });

  it('submits the chosen level, scope, worker and until', async () => {
    const { root } = await mountPanel();
    radio(root, 'level-choice', 'PAUSE');
    radio(root, 'scope-choice', 'TEAM');
    choose(root, 'w2');
    await review(root);
    const fd = new FormData(setForm(root));
    expect(fd.get('level')).toBe('PAUSE');
    expect(fd.get('scope')).toBe('TEAM');
    expect(fd.get('worker')).toBe('w2');
  });
});

describe('after a submit', () => {
  async function opened() {
    const m = await mountPanel();
    choose(m.root);
    await review(m.root);
    return m;
  }

  it('single flight: a second submit while one is pending is cancelled', async () => {
    const { root } = await opened();
    await beginEnhanced(setForm(root));
    expect((await submitEnhanced(setForm(root))).cancelled).toBe(true);
  });

  it('a success re-reads, closes and says the server state is below; the form resets', async () => {
    const { root } = await opened();
    const deliver = await beginEnhanced(setForm(root));
    await deliver({ type: 'success', status: 200, data: { action: 'set', ok: true, signalId: 'new' } });
    await tick(3);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    expect(root.querySelector('dialog')).toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Stop set');
    expect(root.querySelector<HTMLSelectElement>('#stop-worker')!.value).toBe('');
  });

  it('STOP_SIGNAL_UNAVAILABLE shows its own sentence, sets nothing, and never says stop set', async () => {
    const { root } = await opened();
    const deliver = await beginEnhanced(setForm(root));
    await deliver({
      type: 'failure',
      status: 400,
      data: { action: 'set', refusal: { kind: 'refused', code: 'STOP_SIGNAL_UNAVAILABLE', message: 'Nothing was set. A worker this stop would cover has no consumer that can receive stop notices yet.' } },
    });
    await tick(3);
    expect(alertText(root)).toContain('Nothing was set');
    expect(root.textContent).not.toContain('Stop set.');
    expect(root.querySelector('dialog')).toBeNull();
  });

  it('a transport failure shows the uncertain line and re-reads server state', async () => {
    const { root } = await opened();
    const deliver = await beginEnhanced(setForm(root));
    await deliver({ type: 'failure', status: 502, data: {} });
    await tick(3);
    expect(alertText(root)).toContain('may or may not have gone through');
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
  });

  it('a redirect result (expired session) follows the redirect, not the uncertain line (#1413 A3)', async () => {
    const { root } = await opened();
    const deliver = await beginEnhanced(setForm(root));
    await deliver({ type: 'redirect', status: 303, location: '/signin?next=/app/apps/app-1/stops' } as never);
    await tick(3);
    expect(navigationCalls.some((c) => c.fn === 'goto' && c.args[0] === '/signin?next=/app/apps/app-1/stops')).toBe(true);
    expect(alertText(root)).not.toContain('may or may not have gone through');
  });

  it('a failure carrying a known refusal shows that refusal and does not re-read (#1413 A3)', async () => {
    const { root } = await opened();
    const deliver = await beginEnhanced(setForm(root));
    await deliver({ type: 'failure', status: 400, data: { action: 'set', refusal: { kind: 'refused', code: 'STOP_SIGNAL_NOT_FOUND', message: 'That stop no longer exists.' } } });
    await tick(3);
    expect(alertText(root)).toContain('That stop no longer exists.');
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(false);
  });

  it('a late result for App A never lands on App B', async () => {
    const { root, props } = await opened();
    const deliver = await beginEnhanced(setForm(root));
    props.appId = 'app-2';
    flushSync();
    await tick(2);
    await deliver({ type: 'success', status: 200, data: { action: 'set', ok: true, signalId: 'new' } });
    await tick(3);
    expect(root.textContent).not.toContain('Stop set.');
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(false);
    expect(root.querySelector<HTMLSelectElement>('#stop-worker')!.value).toBe('');
  });

  it('navigating to another App clears the form and an open confirmation', async () => {
    const { root, props } = await opened();
    props.appId = 'app-2';
    flushSync();
    await tick(3);
    expect(root.querySelector<HTMLSelectElement>('#stop-worker')!.value).toBe('');
    expect(root.querySelector('dialog')).toBeNull();
  });

  it('unmounting mid-flight leaves no unhandled rejection and no re-read', async () => {
    const m = await opened();
    const deliver = await beginEnhanced(setForm(m.root));
    mounted.pop()!.unmount();
    const rejections = await captureUnhandledRejections(async () => {
      await deliver({ type: 'success', status: 200, data: { action: 'set', ok: true, signalId: 'new' } });
      await wait(10);
    });
    expect(rejections).toEqual([]);
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(false);
  });
});

describe('lifting', () => {
  const lifting = { id: 's1', label: 'Pause · One worker · Gaby' };

  it('opens a confirmation naming the one stop, saying others still apply, Cancel focused', async () => {
    const { root } = await mountPanel({ lifting });
    await tick(3);
    const dialog = root.querySelector<HTMLDialogElement>('dialog[aria-labelledby="stop-lift-title"]')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Pause · One worker · Gaby');
    expect(dialog.textContent).toContain('Other stops covering the same workers still apply');
    expect(dialog.textContent).not.toMatch(/notice|resume/i);
    expect(document.activeElement).toBe(dialog.querySelector('[data-testid="stop-confirm-cancel"]'));
    expect(new FormData(liftForm(root)).get('id')).toBe('s1');
  });

  it('an open lift confirmation goes away when the hint turns from yes to unknown', async () => {
    const { root, props } = await mountPanel({ lifting });
    await tick(3);
    expect(root.querySelector('dialog[aria-labelledby="stop-lift-title"]')).not.toBeNull();
    props.manages = 'unknown';
    await tick(3);
    expect(root.querySelector('dialog[aria-labelledby="stop-lift-title"]')).toBeNull();
  });

  it('navigating to another App closes an open lift confirmation and tells the page', async () => {
    let closed = 0;
    const { root, props } = await mountPanel({ lifting, onliftclose: () => closed++ });
    await tick(3);
    expect(root.querySelector<HTMLDialogElement>('dialog[aria-labelledby="stop-lift-title"]')!.open).toBe(true);
    props.appId = 'app-2';
    flushSync();
    await tick(3);
    expect(closed).toBe(1);
  });

  it('changed:false says it had already ended, not an error', async () => {
    const { root } = await mountPanel({ lifting });
    await tick(3);
    const deliver = await beginEnhanced(liftForm(root));
    await deliver({ type: 'success', status: 200, data: { action: 'lift', ok: true, id: 's1', changed: false } });
    await tick(3);
    expect(root.querySelector('[role="status"]')?.textContent).toContain('already ended');
  });

  it('changed:true never claims every overlapping stop ended', async () => {
    const { root } = await mountPanel({ lifting });
    await tick(3);
    const deliver = await beginEnhanced(liftForm(root));
    await deliver({ type: 'success', status: 200, data: { action: 'lift', ok: true, id: 's1', changed: true } });
    await tick(3);
    const text = root.querySelector('[role="status"]')?.textContent ?? '';
    expect(text).toContain('Other stops covering the same workers still apply');
    expect(text).not.toMatch(/all stops/i);
  });

  it('a refused lift (revoked manager) shows its sentence', async () => {
    const { root } = await mountPanel({ lifting });
    await tick(3);
    const deliver = await beginEnhanced(liftForm(root));
    await deliver({
      type: 'failure',
      status: 400,
      data: { action: 'lift', refusal: { kind: 'refused', code: 'APP_MANAGER_REQUIRED', message: 'Only whoever manages this App can set or lift a stop.' } },
    });
    await tick(3);
    expect(alertText(root)).toContain('Only whoever manages this App');
  });
});
