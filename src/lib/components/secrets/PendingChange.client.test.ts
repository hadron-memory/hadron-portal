import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
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
