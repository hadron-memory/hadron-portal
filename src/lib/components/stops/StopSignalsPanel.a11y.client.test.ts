/**
 * portal#1413 slice B — the stop panel's accessibility and visible copy,
 * MOUNTED. Each pin is red on main: B1 hit areas on the radios, B2 where a
 * refused lift lands, B4 the roster hint, B5 a lift dialog that can still be
 * closed while a set is in flight, B7 `aria-invalid` on every validated field.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { beginEnhanced } from '$lib/test/stubs/app-forms';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import Panel from './StopSignalsPanel.svelte';

const workers = [{ id: 'w1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' }];

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
  const props = reactiveProps({ appId: 'app-1', manages: 'yes', workers, impersonating: null, lifting: null as { id: string; label: string } | null, onliftclose: () => {}, ...over });
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
async function review(root: HTMLElement) {
  root.querySelector<HTMLButtonElement>('button[data-open-confirm]')!.click();
  await tick(3);
}
const lifting = { id: 's1', label: 'Pause · One worker · Gaby' };
const refusedLift = {
  type: 'failure' as const,
  status: 400,
  data: { action: 'lift', refusal: { kind: 'refused', code: 'APP_MANAGER_REQUIRED', message: 'Only whoever manages this App can set or lift a stop.' } },
};

describe('B1 touch targets', () => {
  it('every radio sits in a label that is a 44px hit area', async () => {
    const { root } = await mountPanel();
    const labels = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.closest('label')!);
    expect(labels).toHaveLength(5);
    for (const l of labels) expect(l.className).toMatch(/\bmin-h-11\b/);
  });
});

describe('B2 where a refused lift lands', () => {
  it('shows the message in a status line outside the set form, and moves focus to it', async () => {
    const { root } = await mountPanel({ lifting });
    await tick(3);
    const deliver = await beginEnhanced(liftForm(root));
    await deliver(refusedLift);
    await tick(3);
    const line = root.querySelector<HTMLElement>('[data-testid="stop-lift-status"]');
    expect(line?.getAttribute('role')).toBe('status');
    expect(line?.textContent).toContain('Only whoever manages this App');
    expect(setForm(root).contains(line)).toBe(false);
    expect(setForm(root).textContent).not.toContain('Only whoever manages this App');
    expect(document.activeElement).toBe(line);
  });

  it('a lift that worked says so in the same line, not in the set form', async () => {
    const { root } = await mountPanel({ lifting });
    await tick(3);
    const deliver = await beginEnhanced(liftForm(root));
    await deliver({ type: 'success', status: 200, data: { action: 'lift', ok: true, id: 's1', changed: true } });
    await tick(3);
    const line = root.querySelector<HTMLElement>('[data-testid="stop-lift-status"]');
    expect(line?.textContent).toContain('Stop lifted');
    expect(setForm(root).contains(line)).toBe(false);
  });
});

describe('B4 roster read failure', () => {
  it('keeps Choose… and says the roster did not load', async () => {
    const { root } = await mountPanel({ workers: [], rosterFailed: true });
    const sel = root.querySelector<HTMLSelectElement>('#stop-worker')!;
    expect(sel.options[0].textContent).toContain('Choose…');
    const hint = root.querySelector<HTMLElement>('#stop-worker-hint');
    expect(hint?.textContent).toBe('Couldn’t load the team roster. Reload the page to try again.');
    expect(sel.getAttribute('aria-describedby')).toContain('stop-worker-hint');
  });

  it('a roster that loaded shows no hint', async () => {
    const { root } = await mountPanel();
    expect(root.querySelector('#stop-worker-hint')).toBeNull();
  });
});

describe('B5 the lift dialog while a set is in flight', () => {
  async function setPending() {
    const m = await mountPanel();
    choose(m.root);
    await review(m.root);
    await beginEnhanced(setForm(m.root));
    return m;
  }

  it('Esc closes it and the set request continues', async () => {
    let closed = 0;
    const { root, props } = await mountPanel({ onliftclose: () => closed++ });
    choose(root);
    await review(root);
    await beginEnhanced(setForm(root));
    props.lifting = lifting;
    await tick(3);
    const dialog = root.querySelector<HTMLDialogElement>('dialog[aria-labelledby="stop-lift-title"]')!;
    expect(dialog.open).toBe(true);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await tick(2);
    expect(closed).toBe(1);
    expect(dialog.open).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('form[action="?/set"] dialog button[type="submit"]')?.disabled).toBe(true);
  });

  it('Cancel is enabled while a set is in flight', async () => {
    const { root, props } = await setPending();
    props.lifting = lifting;
    await tick(3);
    const cancel = root.querySelector<HTMLButtonElement>('dialog[aria-labelledby="stop-lift-title"] [data-testid="stop-confirm-cancel"]')!;
    expect(cancel.disabled).toBe(false);
  });

  it('but its own request still holds it open', async () => {
    let closed = 0;
    const { root } = await mountPanel({ lifting, onliftclose: () => closed++ });
    await tick(3);
    await beginEnhanced(liftForm(root));
    const dialog = root.querySelector<HTMLDialogElement>('dialog[aria-labelledby="stop-lift-title"]')!;
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await tick(2);
    expect(closed).toBe(0);
    expect(dialog.open).toBe(true);
  });
});

describe('B7 aria-invalid on every validated field', () => {
  const message = 'That is not accepted.';
  async function flagged(field: string) {
    const m = await mountPanel();
    choose(m.root);
    await review(m.root);
    const deliver = await beginEnhanced(setForm(m.root));
    await deliver({ type: 'failure', status: 400, data: { action: 'set', refusal: { kind: 'invalid', field, message } } });
    await tick(3);
    return m.root;
  }
  const target: Record<string, (r: HTMLElement) => HTMLElement | null> = {
    level: (r) => r.querySelector('[data-field="level"]'),
    scope: (r) => r.querySelector('[data-field="scope"]'),
    worker: (r) => r.querySelector('#stop-worker'),
    until: (r) => r.querySelector('#stop-until'),
  };

  for (const field of ['level', 'scope', 'worker', 'until']) {
    it(`${field}: flagged, described by the message`, async () => {
      const root = await flagged(field);
      const el = target[field](root)!;
      expect(el.getAttribute('aria-invalid')).toBe('true');
      const described = el.getAttribute('aria-describedby') ?? '';
      const messageEl = [...described.split(/\s+/)].map((id) => root.querySelector(`[id="${id}"]`)).find((n) => n?.textContent?.includes(message));
      expect(messageEl).toBeTruthy();
      for (const other of Object.keys(target).filter((f) => f !== field)) {
        expect(target[other](root)!.getAttribute('aria-invalid')).toBeNull();
      }
    });
  }
});
