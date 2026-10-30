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
import { applyAction, submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import ApplyAgentTickers from './ApplyAgentTickers.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
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
    const pending = root.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    // Not `disabled`: a disabled button drops keyboard focus mid-request (Uma's P3 on #1464).
    expect(pending.getAttribute('aria-disabled')).toBe('true');
    expect(pending.disabled).toBe(false);
    expect(pending.textContent?.trim()).toBe('Adding…');
    release();
    await done;
    await tick(2);
    flushSync();
    expect(update).toHaveBeenCalledWith({ reset: false });
    expect(root.querySelector<HTMLButtonElement>('form button[type="submit"]')!.getAttribute('aria-disabled')).not.toBe('true');
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

describe('ApplyAgentTickers: the receipt is the shared grid (George’s P2-3 on #1464)', () => {
  it('created tickers and already-present templates are DataTable rows, not hand-rolled lists', async () => {
    const { root } = await mountApply({ result: { key: 'w-1', ok: true, created: [created(), created({ tickerId: 'k2', tickerName: 'Digest · gaby', templateName: 'Digest' })], alreadyPresent: [{ id: 't2', name: 'Daily digest' }] } });
    const receipt = root.querySelector('[data-testid="apply-receipt"]')!;
    expect(receipt.querySelectorAll('table')).toHaveLength(2);
    expect(receipt.querySelector('ul')).toBeNull();
    const text = receipt.textContent!;
    for (const s of ['Heartbeat · gaby', 'Digest · gaby', 'Daily digest']) expect(text).toContain(s);
  });
  it('says how many were created with a real plural', async () => {
    const one = await mountApply({ result: { key: 'w-1', ok: true, created: [created()], alreadyPresent: [] } });
    expect(one.root.textContent).toContain('Created 1 ticker:');
    expect(one.root.textContent).not.toContain('ticker(s)');
    const three = await mountApply({ result: { key: 'w-1', ok: true, created: [created(), created({ tickerId: 'a' }), created({ tickerId: 'b' })], alreadyPresent: [] } });
    expect(three.root.textContent).toContain('Created 3 tickers:');
  });
});

describe('ApplyAgentTickers: one live region, mounted before any result (Uma’s P3-1)', () => {
  it('is present and empty before the first apply, and holds the receipt or refusal afterwards', async () => {
    const { root, props } = await mountApply({});
    const region = root.querySelector('#apply-tickers-result')!;
    expect(region).not.toBeNull();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent?.trim()).toBe('');
    props.result = { key: 'w-1', ok: true, created: [], alreadyPresent: [] };
    await tick(2);
    flushSync();
    expect(root.querySelector('#apply-tickers-result')).toBe(region);
    expect(region.textContent).toMatch(/nothing to create/i);
  });
});

describe('ApplyAgentTickers: keyboard focus after an apply (Uma’s P2 on #1464)', () => {
  const ok = { type: 'success' as const, status: 200, data: { applyTickers: { key: 'w-1', ok: true, created: [], alreadyPresent: [] } } };
  const keepKitBehaviour = (result: typeof ok) => async () => { await applyAction(result); };

  it('lands on the result region after kit’s applyAction resets focus to the body', async () => {
    const { root, props } = await mountApply({});
    const button = root.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    button.focus();
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update: async () => { await applyAction(ok); props.result = ok.data.applyTickers; } });
    await finish(ok);
    await tick(3);
    flushSync();
    const region = root.querySelector('#apply-tickers-result')!;
    expect(region.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(region);
  });

  it('does not steal focus from a control the reader moved to while the request ran', async () => {
    const { root } = await mountApply({});
    const other = document.createElement('input');
    document.body.appendChild(other);
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update: async () => {} });
    other.focus();
    await finish(ok);
    await tick(3);
    expect(document.activeElement).toBe(other);
    other.remove();
  });
  void keepKitBehaviour;
});

describe('ApplyAgentTickers: a late result is fenced to the mount that sent it (George’s P2-2 on #1464)', () => {
  const ok = { type: 'success' as const, status: 200, data: { applyTickers: { key: 'w-A', ok: true, created: [created()], alreadyPresent: [] } } };

  it('a result that arrives after the reader moved A → B reaches neither update nor the loader', async () => {
    const a = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(a.root.querySelector('form')!, { update });
    mounted.pop()!.unmount();
    await mountApply({ workerKey: 'w-B' });
    await finish(ok);
    await tick(2);
    expect(update).not.toHaveBeenCalled();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });

  it('A → B → A: the old A result is not applied to the fresh A panel, but A’s data is refreshed once', async () => {
    const a1 = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(a1.root.querySelector('form')!, { update });
    mounted.pop()!.unmount();
    await mountApply({ workerKey: 'w-B' });
    mounted.pop()!.unmount();
    const a2 = await mountApply({ workerKey: 'w-A' });
    await finish(ok);
    await tick(2);
    flushSync();
    expect(update).not.toHaveBeenCalled();
    expect(a2.root.querySelector('[data-testid="apply-receipt"]')).toBeNull();
    expect(a2.root.querySelector('[data-testid="apply-refusal"]')).toBeNull();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
  });

  it('a late refusal is fenced the same way', async () => {
    const a1 = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(a1.root.querySelector('form')!, { update });
    mounted.pop()!.unmount();
    await mountApply({ workerKey: 'w-B' });
    await finish({ type: 'failure', status: 409, data: { applyTickers: { key: 'w-A', refusal: { code: 'TICKER_LIMIT_REACHED', message: 'x', outcomeUnknown: false } } } });
    await tick(2);
    expect(update).not.toHaveBeenCalled();
  });

  it('the live mount’s own result still goes through update (the current-request control)', async () => {
    const a = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(a.root.querySelector('form')!, { update });
    await finish(ok);
    await tick(2);
    expect(update).toHaveBeenCalledWith({ reset: false });
  });
});
