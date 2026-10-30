/**
 * portal#1462 — the manager's "Apply the Agent's tickers" action, mounted
 * (hadron-server#2860). Hidden on an explicit `canManage === false` and
 * offered otherwise (the pointer form's rule: the server decides); a receipt
 * for created and already-present templates with the bounded cadence copy; a
 * refusal in plain words, escaped; and a result kept to the worker it was
 * written for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import ApplyAgentTickers from './ApplyAgentTickers.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountApply(props: Record<string, unknown>) {
  const p = reactiveProps<Record<string, unknown>>({ canManage: true, action: '?tab=wake&/applyTickerTemplates', workerKey: 'w-1', result: null, floorSeconds: 300, ...props });
  const m = mountComponent(ApplyAgentTickers as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { root: m.target, props: p };
}
const created = (over: Record<string, unknown> = {}) => ({
  tickerId: 'k1', tickerName: 'Heartbeat · gaby', tickerUrn: 'hrn:ticker:a.com:team:heartbeat-gaby', templateId: 't1', templateName: 'Heartbeat', effectiveCadenceSeconds: 600, ...over,
});

describe('ApplyAgentTickers: who sees it', () => {
  it('shows the action to a manager (true) and when the audit was unknown (null); hides it on an explicit false', async () => {
    for (const [canManage, shown] of [[true, true], [null, true], [false, false]] as const) {
      const { root } = await mountApply({ canManage });
      const button = [...root.querySelectorAll('button')].find((b) => /Apply the Agent’s tickers/.test(b.textContent ?? ''));
      expect(!!button, `canManage=${canManage}`).toBe(shown);
      expect(!!root.querySelector('form'), `form, canManage=${canManage}`).toBe(shown);
    }
  });

  it('is a POST form to the action, carrying no worker field (the route names the worker)', async () => {
    const { root } = await mountApply({});
    const form = root.querySelector('form')!;
    expect(form.method).toBe('post');
    expect(form.getAttribute('action')).toBe('?tab=wake&/applyTickerTemplates');
    expect([...new FormData(form).keys()]).toEqual([]);
  });
});

describe('ApplyAgentTickers: the receipt', () => {
  it('lists each created ticker with its template, effective cadence and URN; no label above the floor', async () => {
    const { root } = await mountApply({ result: { key: 'w-1', ok: true, created: [created()], alreadyPresent: [] } });
    const receipt = root.querySelector('[data-testid="apply-receipt"]')!;
    expect(receipt.getAttribute('role')).toBe('status');
    expect(receipt.textContent).toContain('Heartbeat · gaby');
    expect(receipt.textContent).toContain('Heartbeat');
    expect(receipt.textContent).toMatch(/10 min|600/);
    expect(receipt.querySelector('[title="hrn:ticker:a.com:team:heartbeat-gaby"]')).not.toBeNull();
    expect(receipt.textContent).not.toContain('App’s floor');
    expect(receipt.textContent).not.toMatch(/rais/i);
  });

  it('effective equal to the floor says "the App’s floor" and never "raised"', async () => {
    const { root } = await mountApply({ result: { key: 'w-1', ok: true, created: [created({ effectiveCadenceSeconds: 300 })], alreadyPresent: [] } });
    const text = root.querySelector('[data-testid="apply-receipt"]')!.textContent!;
    expect(text).toContain('the App’s floor');
    expect(text).not.toMatch(/rais/i);
  });

  it('an unreadable floor gives no label even at a round cadence', async () => {
    const { root } = await mountApply({ floorSeconds: null, result: { key: 'w-1', ok: true, created: [created({ effectiveCadenceSeconds: 300 })], alreadyPresent: [] } });
    expect(root.querySelector('[data-testid="apply-receipt"]')!.textContent).not.toContain('App’s floor');
  });

  it('a repeat run says "nothing to create" and lists the templates the worker already had', async () => {
    const { root } = await mountApply({ result: { key: 'w-1', ok: true, created: [], alreadyPresent: [{ id: 't1', name: 'Heartbeat' }, { id: 't2', name: 'Daily digest' }] } });
    const text = root.querySelector('[data-testid="apply-receipt"]')!.textContent!;
    expect(text).toMatch(/nothing to create/i);
    expect(text).toContain('Heartbeat');
    expect(text).toContain('Daily digest');
  });

  it('names from the server are text, never markup', async () => {
    const { root } = await mountApply({ result: { key: 'w-1', ok: true, created: [created({ tickerName: '<img src=x onerror=alert(1)>' })], alreadyPresent: [{ id: 't', name: '<b>bold</b>' }] } });
    expect(root.querySelector('[data-testid="apply-receipt"] img')).toBeNull();
    expect(root.querySelector('[data-testid="apply-receipt"] b')).toBeNull();
    expect(root.querySelector('[data-testid="apply-receipt"]')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('ApplyAgentTickers: a refusal', () => {
  it('is an alert with the message and code, escaped, and the action stays offered', async () => {
    const message = 'Nothing was created. <img src=x onerror=alert(1)>';
    const { root } = await mountApply({ result: { key: 'w-1', refusal: { code: 'TICKER_LIMIT_REACHED', message, outcomeUnknown: false } } });
    const alert = root.querySelector('[data-testid="apply-refusal"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain(message);
    expect(alert.textContent).toContain('TICKER_LIMIT_REACHED');
    expect(alert.querySelector('img')).toBeNull();
    expect(root.querySelector('form button[type="submit"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="apply-receipt"]')).toBeNull();
  });
});

describe('ApplyAgentTickers: submit and isolation', () => {
  it('an enhanced submit calls update without resetting, disables the button while pending, then re-enables it', async () => {
    const { root } = await mountApply({});
    let release!: () => void;
    const update = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const done = submitEnhancedWithResult(root.querySelector('form')!, { type: 'success', status: 200, data: { applyTickers: { key: 'w-1', ok: true, created: [], alreadyPresent: [] } } }, { update });
    await tick(2);
    flushSync();
    expect(root.querySelector<HTMLButtonElement>('form button[type="submit"]')!.disabled).toBe(true);
    release();
    await done;
    await tick(2);
    flushSync();
    expect(update).toHaveBeenCalledWith({ reset: false });
    expect(root.querySelector<HTMLButtonElement>('form button[type="submit"]')!.disabled).toBe(false);
  });

  it('a result written for another worker is not shown (A→B→A late result)', async () => {
    const { root, props } = await mountApply({ workerKey: 'w-B', result: { key: 'w-A', ok: true, created: [created()], alreadyPresent: [] } });
    expect(root.querySelector('[data-testid="apply-receipt"]')).toBeNull();
    expect(root.querySelector('[data-testid="apply-refusal"]')).toBeNull();
    props.workerKey = 'w-A';
    await tick(2);
    flushSync();
    expect(root.querySelector('[data-testid="apply-receipt"]')).not.toBeNull();
  });
});
