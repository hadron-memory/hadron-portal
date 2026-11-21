import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { holdInvalidateAll, navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import PendingChange from './PendingChange.svelte';

const LINK = 'https://hadron.example/secret-changes/r1';
const props = { requestId: 'r1', secretId: 's1', ceremonyUrl: LINK, state: 'open', operation: 'CREATE', expiresAt: '2026-11-21T01:00:00Z' };
const rereads = () => navigationCalls.filter((c) => c.fn === 'invalidateAll').length;

beforeEach(() => { resetNavigationCalls(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('PendingChange re-reads the request when the person returns to the tab', () => {
  it('an open request is read again on window focus', () => {
    const m = mountComponent(PendingChange as never, props);
    window.dispatchEvent(new Event('focus'));
    expect(rereads()).toBe(1);
    m.unmount();
  });
  it('after unmount a focus no longer re-reads (listeners are removed)', () => {
    const m = mountComponent(PendingChange as never, props);
    m.unmount();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rereads()).toBe(0);
  });
  it('an ended request is not re-read', () => {
    const m = mountComponent(PendingChange as never, { ...props, state: 'completed' });
    window.dispatchEvent(new Event('focus'));
    expect(rereads()).toBe(0);
    m.unmount();
  });
});

describe('PendingChange copy', () => {
  const text = (p: Record<string, unknown>) => {
    const m = mountComponent(PendingChange as never, { ...props, ...p });
    const out = m.target.textContent ?? '';
    m.unmount();
    return out;
  };
  it('names the secret when given, and announces the new tab', () => {
    const h = text({ secretName: 'stripe-key' });
    expect(h).toContain('stripe-key');
    expect(h).toContain('(opens in a new tab)');
  });
  it('says the waiting fact once in the notice', () => {
    expect(text({}).match(/passkey signature/g)?.length).toBe(1);
  });
});

// portal#2436: the guards inside the re-read, each pinned in both directions.
describe('PendingChange re-read guards', () => {
  const visibility = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  afterEach(() => visibility('visible'));
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); flushSync(); };

  it('a hidden tab does not re-read, a visible one does', async () => {
    const m = mountComponent(PendingChange as never, props);
    visibility('hidden');
    window.dispatchEvent(new Event('focus'));
    expect(rereads()).toBe(0);
    visibility('visible');
    window.dispatchEvent(new Event('focus'));
    expect(rereads()).toBe(1);
    await settle();
    m.unmount();
  });
  it('focus and visibilitychange together make one read; once it settles the next return reads again', async () => {
    const m = mountComponent(PendingChange as never, props);
    const release = holdInvalidateAll();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rereads()).toBe(1);
    release();
    await settle();
    window.dispatchEvent(new Event('focus'));
    expect(rereads()).toBe(2);
    await settle();
    m.unmount();
  });
  it('a failed re-read says the notice may be out of date; the next good one clears it', async () => {
    const m = mountComponent(PendingChange as never, props);
    const failed = () => m.target.querySelector('[data-testid="reread-failed"]');
    expect(failed()).toBeNull();
    navigationHooks.onInvalidateAll = () => { throw new Error('offline'); };
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(failed()?.textContent).toContain("Couldn't check");
    navigationHooks.onInvalidateAll = undefined;
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(failed()).toBeNull();
    m.unmount();
  });
  it('the failure line lives in a live region that was already mounted and idle', async () => {
    const m = mountComponent(PendingChange as never, props);
    const region = m.target.querySelector('[data-testid="reread-status"]') as HTMLElement;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent?.trim()).toBe('');
    navigationHooks.onInvalidateAll = () => { throw new Error('offline'); };
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(m.target.querySelector('[data-testid="reread-status"]')).toBe(region);
    expect(region.textContent).toContain("Couldn't check");
    m.unmount();
  });
  it('a read that settles after unmount neither throws nor shows anything', async () => {
    const m = mountComponent(PendingChange as never, props);
    const release = holdInvalidateAll();
    navigationHooks.onInvalidateAll = () => { throw new Error('offline'); };
    window.dispatchEvent(new Event('focus'));
    m.unmount();
    release();
    await settle();
    expect(document.querySelector('[data-testid="reread-failed"]')).toBeNull();
  });
});

// portal#2436: after Withdraw the page re-renders and drops the notice. Focus must land where the notice
// WAS, which means reading `root.isConnected` after the DOM has caught up (`await tick()`), not before.
describe('PendingChange focus after Withdraw', () => {
  const run = async (dropsNotice: boolean) => {
    const h1 = document.createElement('h1'); h1.textContent = 'Secrets'; document.body.prepend(h1);
    const m = mountComponent(PendingChange as never, props);
    const notice = m.target.querySelector('[data-testid="pending-change"]') as HTMLElement;
    const form = m.target.querySelector('form') as HTMLFormElement;
    // kit's update() resolves, and the re-render that removes the notice lands a few microtasks later.
    const update = async () => {
      if (dropsNotice) void Promise.resolve().then(() => {}).then(() => {}).then(() => notice.remove());
    };
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: {} }, { update });
    const active = document.activeElement;
    m.unmount(); h1.remove();
    return { active, notice, h1 };
  };
  it('a notice that is dropped hands focus to the page title', async () => {
    const { active, h1 } = await run(true);
    expect(active).toBe(h1);
  });
  it('a notice that stays keeps focus', async () => {
    const { active, notice } = await run(false);
    expect(active).toBe(notice);
  });
});
