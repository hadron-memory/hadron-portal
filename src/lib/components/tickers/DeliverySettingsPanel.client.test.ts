/**
 * portal#1141 slice A — the delivery settings panel, mounted: the form a
 * manager (or an unknown caller) gets, the read-only view for everyone else,
 * and what a save does and does not do. Nothing is optimistic: stored values
 * change only when the page re-reads after a real ok.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import DeliverySettingsPanel from './DeliverySettingsPanel.svelte';

const stored = { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false };
const ok = (over: Record<string, unknown> = {}) => ({ kind: 'ok' as const, value: { ...stored, ...over } });

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});

async function mountPanel(props: Record<string, unknown> = {}) {
  const m = mountComponent(DeliverySettingsPanel as never, {
    appId: 'app-1', settings: ok(), canManage: true, impersonating: null, ...props,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}
const input = (root: HTMLElement, name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
function type(el: HTMLInputElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const form = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/delivery"]')!;

describe('DeliverySettingsPanel', () => {
  it('shows the stored values in labelled number inputs, with the cadence-floor coupling beside the batching window', async () => {
    const root = await mountPanel();
    expect(input(root, 'batchWindowSeconds').value).toBe('120');
    expect(input(root, 'busyDelaySeconds').value).toBe('600');
    expect(input(root, 'stuckWindowSeconds').value).toBe('900');
    for (const n of ['batchWindowSeconds', 'busyDelaySeconds', 'stuckWindowSeconds']) {
      expect(root.querySelector(`label[for="${input(root, n).id}"]`)).not.toBeNull();
      expect(input(root, `${n}Was`).value).toBe(String(stored[n as keyof typeof stored]));
    }
    expect(root.textContent).toContain('same setting as the fastest ticker');
    expect(root.textContent).toContain('server currently accepts');
  });

  it('never offers or carries a standby switch, and states the stored and effective values as read', async () => {
    const root = await mountPanel();
    expect(root.querySelector('input[name="standbyEnabled"]')).toBeNull();
    expect(root.textContent).toContain('Standby: off');
    expect(root.textContent).not.toMatch(/not in effect/);
    const on = await mountPanel({ settings: ok({ standbyEnabled: true, standbyEffective: false }) });
    expect(on.textContent).toContain('Standby: configured, not in effect yet.');
    expect(on.textContent).not.toMatch(/standby (works|is active)/i);
  });

  it('a manager who is known not to manage sees the values read-only and no form', async () => {
    const root = await mountPanel({ canManage: false });
    expect(form(root)).toBeNull();
    expect(root.textContent).toContain('120');
    expect(root.textContent).toContain('Only whoever manages the App can change these settings.');
  });

  it('an unknown capability (null) still offers the form: the server’s refusal answers', async () => {
    expect(form(await mountPanel({ canManage: null }))).not.toBeNull();
  });

  it('a support session sees the values and a switched-off note, no form', async () => {
    const root = await mountPanel({ impersonating: 'Rae' });
    expect(form(root)).toBeNull();
    expect(root.textContent).toContain('Viewing as Rae');
  });

  it('a failed read says so and shows no numbers (no invented defaults)', async () => {
    const root = await mountPanel({ settings: { kind: 'failed' } });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load');
    expect(form(root)).toBeNull();
    expect(root.textContent).not.toMatch(/\b(120|600|900)\b/);
  });

  it('a refusal keeps the typed values in the form, shows the server’s sentence verbatim, and does not reload', async () => {
    const root = await mountPanel();
    type(input(root, 'batchWindowSeconds'), '600');
    await tick(2);
    const message = 'The floor 600s is above the cadence of: engineering (300s). Slow or delete them first.';
    await submitEnhancedWithResult(form(root), {
      type: 'failure', status: 400, data: { action: 'delivery', refusal: { kind: 'refused', code: 'TICKER_SETTINGS_CONFLICT', message } },
    });
    await tick(3);
    const alert = root.querySelector('form [role="alert"]');
    expect(alert?.textContent).toContain(`“${message}”`);
    expect(alert?.textContent).toContain('TICKER_SETTINGS_CONFLICT');
    expect(input(root, 'batchWindowSeconds').value).toBe('600');
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });

  it('an uncertain outcome shows the fixed line, not "failed", and no success', async () => {
    const root = await mountPanel();
    type(input(root, 'busyDelaySeconds'), '5');
    await tick(2);
    await submitEnhancedWithResult(form(root), { type: 'failure', status: 502, data: { action: 'delivery', refusal: { kind: 'uncertain' } } });
    await tick(3);
    expect(root.textContent).toContain('The change may or may not have gone through. Reload to check.');
    expect(root.querySelector('[role="status"]')).toBeNull();
  });

  it('typed text survives an unrelated re-render of the stored values', async () => {
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app-1', settings: ok(), canManage: true, impersonating: null });
    const m = mountComponent(DeliverySettingsPanel as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    type(input(m.target, 'busyDelaySeconds'), '42');
    await tick(2);
    props.settings = ok();
    await tick(3);
    expect(input(m.target, 'busyDelaySeconds').value).toBe('42');
  });

  it('a success reloads, then shows the STORED values from the re-read, not the typed ones, and says so', async () => {
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app-1', settings: ok(), canManage: true, impersonating: null });
    const m = mountComponent(DeliverySettingsPanel as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    type(input(m.target, 'busyDelaySeconds'), '300');
    await tick(2);
    await submitEnhancedWithResult(form(m.target), { type: 'success', status: 200, data: { action: 'delivery', ok: true } });
    // the page's re-read stores something other than what was typed
    props.settings = ok({ busyDelaySeconds: 301 });
    await tick(3);
    flushSync();
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
    expect(input(m.target, 'busyDelaySeconds').value).toBe('301');
    const status = m.target.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Saved');
    expect(document.activeElement).toBe(status);
  });

  it('navigating to another App reseeds: nothing typed for the first survives', async () => {
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app-1', settings: ok(), canManage: true, impersonating: null });
    const m = mountComponent(DeliverySettingsPanel as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    type(input(m.target, 'busyDelaySeconds'), '42');
    await tick(2);
    props.appId = 'app-2';
    props.settings = ok({ busyDelaySeconds: 7 });
    await tick(3);
    expect(input(m.target, 'busyDelaySeconds').value).toBe('7');
    expect(m.target.querySelector('[role="status"]')).toBeNull();
  });

  it('the submit is disabled while a save is in flight (no duplicate submit)', async () => {
    const root = await mountPanel();
    type(input(root, 'busyDelaySeconds'), '5');
    await tick(2);
    const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(false);
    // start a submit without delivering its result
    const { submitEnhanced } = await import('$lib/test/stubs/app-forms');
    await submitEnhanced(form(root));
    await tick(2);
    expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
});
