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
import { holdInvalidateAll, navigationCalls, navigationGuards, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { REFRESH_MARKER_KEY, setRefreshMarker } from '$lib/tickers/refresh-marker';
import { refreshScope } from '$lib/test/refreshScope';
import ApplyAgentTickers from './ApplyAgentTickers.svelte';

// portal#1462: the signed-in viewer a test mounts the panel for (null: none known).
let viewer: string | null = null;
// portal#1462: which worker the page showing an error is for, once a refresh resolves (kit's error-route path); null: no error.
let errorAt: string | null = null;
// portal#1462: the worker's canonical ids the panel records in the marker (null: unavailable, so no marker).
let identity: { id: string; urn: string | null; appId: string | null; orgId: string | null } | null = { id: 'w-A', urn: null, appId: 'app-1', orgId: 'org-1' };
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  sessionStorage.clear();
  viewer = null;
  errorAt = null;
  identity = { id: 'w-A', urn: null, appId: 'app-1', orgId: 'org-1' };
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  resetNavigationGuards();
});

async function mountApply(props: Record<string, unknown>) {
  const p = reactiveProps<Record<string, unknown>>({ canManage: true, action: '?tab=wake&/applyTickerTemplates', workerKey: 'w-1', result: null, floorSeconds: 300, viewerId: viewer, workerIdentity: identity, errorPageWorker: () => errorAt, ...props });
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
    // The refresh (invalidateAll) comes first, then kit's update applies the result.
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    flushSync();
    const pending = root.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    // Not `disabled`: a disabled button drops keyboard focus mid-request (Uma's P3 on #1464).
    expect(pending.getAttribute('aria-disabled')).toBe('true');
    expect(pending.disabled).toBe(false);
    expect(pending.textContent?.trim()).toBe('Applying…');
    release();
    await done;
    await tick(2);
    flushSync();
    expect(update).toHaveBeenCalledWith({ reset: false, invalidateAll: false });
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

  it('also lands on the result region when focus is still on the apply button', async () => {
    const { root } = await mountApply({});
    root.querySelector<HTMLButtonElement>('form button[type="submit"]')!.focus();
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update: async () => {} });
    await finish(ok);
    await tick(3);
    expect(document.activeElement).toBe(root.querySelector('#apply-tickers-result'));
  });

  it('does not steal focus from a control the reader moved to while the request ran, through kit’s own body reset (George’s P2 on the delta)', async () => {
    const { root, props } = await mountApply({});
    const other = document.createElement('input');
    document.body.appendChild(other);
    root.querySelector<HTMLButtonElement>('form button[type="submit"]')!.focus();
    // The same path the positive test takes: kit's applyAction blurs to the body inside update.
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update: async () => { await applyAction(ok); props.result = ok.data.applyTickers; } });
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

  it('a mount that navigated away DURING the awaited refresh applies nothing (A → B → A while invalidateAll is pending)', async () => {
    const a1 = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(a1.root.querySelector('form')!, { update });
    const release = holdInvalidateAll();
    const done = finish(ok);
    await tick(2);
    mounted.pop()!.unmount();
    await mountApply({ workerKey: 'w-B' });
    mounted.pop()!.unmount();
    const a2 = await mountApply({ workerKey: 'w-A' });
    release();
    await done;
    await tick(2);
    flushSync();
    expect(update).not.toHaveBeenCalled();
    expect(a2.root.querySelector('[data-testid="apply-receipt"]')).toBeNull();
  });

  it('the same for A → B while the refresh is pending', async () => {
    const a1 = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(a1.root.querySelector('form')!, { update });
    const release = holdInvalidateAll();
    const done = finish(ok);
    await tick(2);
    mounted.pop()!.unmount();
    await mountApply({ workerKey: 'w-B' });
    release();
    await done;
    await tick(2);
    expect(update).not.toHaveBeenCalled();
  });

  it('a late FAILURE does not refresh at all (kit only refreshes a success), and is applied only by the live mount', async () => {
    const a = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(a.root.querySelector('form')!, { update });
    await finish({ type: 'failure', status: 409, data: { applyTickers: { key: 'w-A', refusal: { code: 'TICKER_LIMIT_REACHED', message: 'x', outcomeUnknown: false } } } });
    await tick(2);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
    expect(update).toHaveBeenCalledWith({ reset: false, invalidateAll: false });
  });

  it('a refresh that rejects does not leave the button blocked: the next apply goes through (Anne’s P2 on faa250eb)', async () => {
    const { root } = await mountApply({ workerKey: 'w-A' });
    const form = root.querySelector('form')!;
    const first = await submitEnhancedDeferred(form, { update: vi.fn(async () => {}) });
    const navigation = await import('$lib/test/stubs/app-navigation');
    navigation.navigationHooks.onInvalidateAll = async () => { throw new Error('refresh failed'); };
    await first.finish(ok);
    await tick(2);
    flushSync();
    const button = root.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    expect(button.textContent?.trim()).toBe('Apply the Agent’s tickers');
    navigation.navigationHooks.onInvalidateAll = undefined;
    const update = vi.fn(async () => {});
    const second = await submitEnhancedDeferred(form, { update });
    await second.finish(ok);
    await tick(2);
    expect(update).toHaveBeenCalledWith({ reset: false, invalidateAll: false });
  });

  it('the live mount’s own result still goes through update (the current-request control)', async () => {
    const a = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(a.root.querySelector('form')!, { update });
    await finish(ok);
    await tick(2);
    expect(update).toHaveBeenCalledWith({ reset: false, invalidateAll: false });
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
  });
});

describe('ApplyAgentTickers: a refresh that fails after a committed apply says so (George’s, Uma’s and Cedar’s P2 on 3cc623de)', () => {
  const receipt = { key: 'w-A', ok: true as const, created: [created()], alreadyPresent: [] };
  const ok = { type: 'success' as const, status: 200, data: { applyTickers: receipt } };
  const guidance = (root: Element) => root.querySelector('#apply-tickers-result [data-testid="apply-refresh-failed"]');
  async function rejectRefresh(after?: () => Promise<void>) {
    const navigation = await import('$lib/test/stubs/app-navigation');
    navigation.navigationHooks.onInvalidateAll = async () => {
      await after?.();
      throw new Error('refresh failed');
    };
    return () => { navigation.navigationHooks.onInvalidateAll = undefined; };
  }

  it('still applies the result the server returned, and says the page could not reload, without calling the apply unconfirmed or "nothing created"', async () => {
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => { props.result = receipt; });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update });
    const restore = await rejectRefresh();
    await finish(ok);
    await tick(3);
    flushSync();
    restore();
    expect(update).toHaveBeenCalledWith({ reset: false, invalidateAll: false });
    expect(root.querySelector('[data-testid="apply-receipt"]')).not.toBeNull();
    const note = guidance(root)!;
    expect(note).not.toBeNull();
    expect(note.textContent).toMatch(/reload|refresh/i);
    for (const token of ['rounded-md', 'border', 'border-amber-300', 'bg-amber-50', 'text-amber-900', 'dark:border-amber-900', 'dark:bg-amber-950', 'dark:text-amber-200']) expect(note.classList.contains(token), token).toBe(true);
    expect(note.textContent).not.toMatch(/nothing was created|not created|may or may not/i);
  });

  it('never retries the apply by itself: one refresh attempt, no second submit, and the button is usable again', async () => {
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => { props.result = receipt; });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update });
    const restore = await rejectRefresh();
    await finish(ok);
    await tick(3);
    flushSync();
    restore();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(root.querySelector('form button[type="submit"]')!.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('is fenced to its mount: a mount that was replaced during the failing refresh shows nothing and applies nothing', async () => {
    const a1 = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(a1.root.querySelector('form')!, { update });
    let go!: () => void;
    const gate = new Promise<void>((r) => (go = r));
    const restore = await rejectRefresh(() => gate);
    const done = finish(ok);
    await tick(2);
    mounted.pop()!.unmount();
    const b = await mountApply({ workerKey: 'w-B' });
    go();
    await done;
    await tick(3);
    flushSync();
    restore();
    expect(update).not.toHaveBeenCalled();
    expect(guidance(b.root)).toBeNull();
  });

  it('belongs to the worker it was written for: the reused page moving to another worker drops it', async () => {
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => { props.result = receipt; });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update });
    const restore = await rejectRefresh();
    await finish(ok);
    await tick(3);
    flushSync();
    restore();
    expect(guidance(root)).not.toBeNull();
    props.workerKey = 'w-B';
    props.result = { key: 'w-B', ok: true, created: [], alreadyPresent: [] };
    await tick(2);
    flushSync();
    expect(guidance(root)).toBeNull();
  });

  it('clears on the next apply, and is absent after an apply whose refresh worked', async () => {
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const form = root.querySelector('form')!;
    const first = await submitEnhancedDeferred(form, { update: vi.fn(async () => { props.result = receipt; }) });
    const restore = await rejectRefresh();
    await first.finish(ok);
    await tick(3);
    flushSync();
    restore();
    expect(guidance(root)).not.toBeNull();
    const second = await submitEnhancedDeferred(form, { update: vi.fn(async () => { props.result = receipt; }) });
    await second.finish(ok);
    await tick(3);
    flushSync();
    expect(guidance(root)).toBeNull();
  });

  it('a refusal attempts no refresh, so it never carries the refresh line', async () => {
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const refusal = { key: 'w-A', refusal: { code: 'TICKER_LIMIT_REACHED', message: 'x', outcomeUnknown: false } };
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update: vi.fn(async () => { props.result = refusal; }) });
    await finish({ type: 'failure', status: 409, data: { applyTickers: refusal } });
    await tick(3);
    flushSync();
    expect(guidance(root)).toBeNull();
  });
});

describe('ApplyAgentTickers: the refresh marker (Xavier’s ruling A, #51237)', () => {
  const receipt = { key: 'w-A', ok: true as const, created: [created()], alreadyPresent: [] };
  const ok = { type: 'success' as const, status: 200, data: { applyTickers: receipt } };
  const marker = () => {
    const raw = sessionStorage.getItem(REFRESH_MARKER_KEY);
    return raw ? JSON.parse(raw) : null;
  };
  const asViewer = (id: string | null) => { viewer = id; };

  it('is written for this viewer and worker BEFORE the refresh starts, and only after a confirmed success', async () => {
    asViewer('u-1');
    const nav = await import('$lib/test/stubs/app-navigation');
    let seen: unknown = 'unset';
    nav.navigationHooks.onInvalidateAll = () => { seen = marker(); };
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update: vi.fn(async () => { props.result = receipt; }) });
    await finish(ok);
    expect(seen).toMatchObject({ viewer: 'u-1', worker: 'w-A' });
  });

  it('is not written for a refusal, which attempts no refresh', async () => {
    asViewer('u-1');
    const { root } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!);
    await finish({ type: 'failure', status: 409, data: { applyTickers: { key: 'w-A', refusal: { code: 'X', message: 'x', outcomeUnknown: false } } } });
    expect(marker()).toBeNull();
  });

  it('survives a refresh that lands on the error page, which unmounts this panel (the real kit path)', async () => {
    asViewer('u-1');
    const nav = await import('$lib/test/stubs/app-navigation');
    const { root } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!);
    nav.navigationHooks.onInvalidateAll = () => { mounted.pop()!.unmount(); errorAt = 'w-A'; };
    await finish(ok);
    await tick(2);
    expect(marker()).toMatchObject({ viewer: 'u-1', worker: 'w-A' });
  });

  it('is cleared when the panel was unmounted and the refresh was cut short by a navigation to ANOTHER worker whose page errors (George’s P2 on b3fa8201)', async () => {
    asViewer('u-1');
    const nav = await import('$lib/test/stubs/app-navigation');
    const { root } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!);
    nav.navigationHooks.onInvalidateAll = () => { mounted.pop()!.unmount(); errorAt = 'w-B'; };
    await finish(ok);
    await tick(2);
    expect(marker()).toBeNull();
  });

  it('is kept when the error page is for this worker spelled by its canonical URN', async () => {
    asViewer('u-1');
    identity = { id: 'w-A', urn: 'hrn:worker:a.com:team:gaby', appId: 'app-1', orgId: 'org-1' };
    const nav = await import('$lib/test/stubs/app-navigation');
    const { root } = await mountApply({ workerKey: 'gaby' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!);
    nav.navigationHooks.onInvalidateAll = () => { mounted.pop()!.unmount(); errorAt = 'hrn:worker:a.com:team:gaby'; };
    await finish(ok);
    await tick(2);
    expect(marker()).toMatchObject({ worker: 'gaby' });
  });

  it('S9d: keeps the committed-apply marker when a URN producer lands on the canonical-id error page', async () => {
    asViewer('u-1');
    const urn = 'hrn:worker:example.test:team:worker-a';
    identity = { id: 'w-A', urn, appId: 'app-1', orgId: 'org-1' };
    const nav = await import('$lib/test/stubs/app-navigation');
    const { root } = await mountApply({ workerKey: urn });
    const update = vi.fn(async () => {});
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update });
    nav.navigationHooks.onInvalidateAll = () => { mounted.pop()!.unmount(); errorAt = 'w-A'; };
    await finish({ ...ok, data: { applyTickers: { ...receipt, key: urn } } });
    expect(marker()).toMatchObject({ viewer: 'u-1', worker: urn, workerId: 'w-A' });
    expect(update).not.toHaveBeenCalled();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
  });

  // Kit's `invalidateAll` is not a navigation: it fires no `beforeNavigate`. A real navigation, which cancels the
  // pending refresh, does. So a marker whose refresh is still in flight is cleared the moment the reader navigates,
  // not when the cancelled refresh finally resolves (George's P2 on 704ad591: an unrelated A error could consume
  // it in between).
  const fireBeforeNavigate = () => { for (const g of navigationGuards) if (g.fn === 'beforeNavigate') (g.callback as () => void)(); };

  it('is cleared when the reader navigates while the refresh is still pending, so an error before the refresh resolves cannot consume it (George’s P2 on 704ad591)', async () => {
    asViewer('u-1');
    const nav = await import('$lib/test/stubs/app-navigation');
    const { root } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!);
    let midFlight: unknown = 'unset';
    nav.navigationHooks.onInvalidateAll = () => {
      fireBeforeNavigate();
      midFlight = marker();
      mounted.pop()!.unmount();
      errorAt = 'w-A';
    };
    await finish(ok);
    await tick(2);
    expect(midFlight).toBeNull();
    expect(marker()).toBeNull();
  });

  it('a navigation clears only this panel’s own pending attempt: a newer attempt survives, and so does a marker after the refresh settled', async () => {
    asViewer('u-1');
    const nav = await import('$lib/test/stubs/app-navigation');
    const { root } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!);
    let newer: string | null = null;
    nav.navigationHooks.onInvalidateAll = () => {
      newer = setRefreshMarker(refreshScope('u-1', 'w-A'));
      fireBeforeNavigate();
      mounted.pop()!.unmount();
      errorAt = 'w-A';
    };
    await finish(ok);
    await tick(2);
    expect(marker()).toMatchObject({ attempt: newer });
    fireBeforeNavigate();
    expect(marker()).toMatchObject({ attempt: newer });
  });

  it('is cleared when the panel was unmounted but the refresh WORKED (the reader moved A to B): no error page, so nothing may claim a failed reload later', async () => {
    asViewer('u-1');
    const nav = await import('$lib/test/stubs/app-navigation');
    const { root } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!);
    nav.navigationHooks.onInvalidateAll = () => { mounted.pop()!.unmount(); errorAt = null; };
    await finish(ok);
    await tick(2);
    expect(marker()).toBeNull();
  });

  it('cleans up only its own attempt: a newer attempt’s marker survives an older refresh that worked', async () => {
    asViewer('u-1');
    const nav = await import('$lib/test/stubs/app-navigation');
    const { root } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!);
    let newer: string | null = null;
    nav.navigationHooks.onInvalidateAll = () => {
      mounted.pop()!.unmount();
      newer = setRefreshMarker(refreshScope('u-1', 'w-A'));
      errorAt = null;
    };
    await finish(ok);
    await tick(2);
    expect(newer).toBeTruthy();
    expect(marker()).toMatchObject({ attempt: newer });
  });

  it('is cleared once the refresh worked and this panel is still the one showing', async () => {
    asViewer('u-1');
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update: vi.fn(async () => { props.result = receipt; }) });
    await finish(ok);
    await tick(2);
    expect(marker()).toBeNull();
  });

  it('is cleared when the refresh rejects in this panel, which says so itself rather than leaving a second claim behind', async () => {
    asViewer('u-1');
    const nav = await import('$lib/test/stubs/app-navigation');
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update: vi.fn(async () => { props.result = receipt; }) });
    nav.navigationHooks.onInvalidateAll = () => { throw new Error('refresh failed'); };
    await finish(ok);
    await tick(2);
    expect(marker()).toBeNull();
    expect(root.querySelector('[data-testid="apply-refresh-failed"]')).not.toBeNull();
  });

  it('a stale marker is cleared when the panel mounts, and when the next apply starts', async () => {
    asViewer('u-1');
    setRefreshMarker(refreshScope('u-1', 'w-A'));
    const { root } = await mountApply({ workerKey: 'w-A' });
    expect(marker()).toBeNull();
    setRefreshMarker(refreshScope('u-1', 'w-A'));
    await submitEnhancedDeferred(root.querySelector('form')!);
    expect(marker()).toBeNull();
  });

  it('a mount that was replaced writes no marker', async () => {
    asViewer('u-1');
    const a = await mountApply({ workerKey: 'w-A' });
    const { finish } = await submitEnhancedDeferred(a.root.querySelector('form')!);
    mounted.pop()!.unmount();
    await finish(ok);
    expect(marker()).toBeNull();
  });

  it('with no known viewer writes nothing and still refreshes, applies and shows the receipt', async () => {
    asViewer(null);
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => { props.result = receipt; });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update });
    await finish(ok);
    await tick(2);
    expect(marker()).toBeNull();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('storage that throws never blocks the apply: the refresh is still attempted and the receipt applied', async () => {
    asViewer('u-1');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => { props.result = receipt; });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update });
    await finish(ok);
    await tick(2);
    vi.restoreAllMocks();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-testid="apply-receipt"]')).not.toBeNull();
  });

  it('records the App and the worker’s canonical ids in the marker (Xavier #51470)', async () => {
    asViewer('u-1');
    const nav = await import('$lib/test/stubs/app-navigation');
    let seen: Record<string, unknown> | null = null;
    nav.navigationHooks.onInvalidateAll = () => { seen = marker(); };
    identity = { id: 'w-A', urn: 'hrn:worker:a.com:team:gaby', appId: 'app-1', orgId: 'org-1' };
    const { root } = await mountApply({ workerKey: 'hrn:worker:a.com:team:gaby' });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!);
    await finish(ok);
    expect(seen).toMatchObject({ worker: 'hrn:worker:a.com:team:gaby', workerId: 'w-A', workerUrn: 'hrn:worker:a.com:team:gaby', appId: 'app-1', orgId: 'org-1' });
  });

  it('fails closed without the App: no marker is written, and the apply and refresh still run', async () => {
    asViewer('u-1');
    identity = { id: 'w-A', urn: null, appId: null, orgId: null };
    const { root, props } = await mountApply({ workerKey: 'w-A' });
    const update = vi.fn(async () => { props.result = receipt; });
    const { finish } = await submitEnhancedDeferred(root.querySelector('form')!, { update });
    await finish(ok);
    await tick(2);
    expect(marker()).toBeNull();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
