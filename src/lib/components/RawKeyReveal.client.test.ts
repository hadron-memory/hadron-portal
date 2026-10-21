/** #498 — the one-shot new-key reveal counts down and vanishes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import RawKeyReveal from './RawKeyReveal.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers();
});
function mountReveal(props: Record<string, unknown>) {
  const m = mountComponent(RawKeyReveal as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}
const countdown = (m: Mounted<Record<string, unknown>>) =>
  m.target.querySelector('[data-testid="raw-key-countdown"]')?.textContent ?? '';

describe('RawKeyReveal (#498)', () => {
  it('shows the key and a mm:ss countdown', () => {
    const m = mountReveal({ rawKey: 'hk_secret', ttlMs: 300_000, ondismiss: () => {} });
    expect(m.target.textContent).toContain('hk_secret');
    expect(countdown(m)).toContain('5:00');
  });

  it('ticks down once a second', () => {
    const m = mountReveal({ rawKey: 'hk_secret', ttlMs: 300_000, ondismiss: () => {} });
    vi.advanceTimersByTime(61_000);
    flushSync();
    expect(countdown(m)).toContain('3:59');
  });

  it('dismisses itself, exactly once, when the time is up', () => {
    const ondismiss = vi.fn();
    mountReveal({ rawKey: 'hk_secret', ttlMs: 300_000, ondismiss });
    vi.advanceTimersByTime(299_000);
    expect(ondismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });

  it('stops its timer on teardown: no dismiss fires after unmount', () => {
    const ondismiss = vi.fn();
    const m = mountReveal({ rawKey: 'hk_secret', ttlMs: 300_000, ondismiss });
    m.unmount();
    vi.advanceTimersByTime(400_000);
    expect(ondismiss).not.toHaveBeenCalled();
  });

  it('dismisses on the button click', () => {
    const ondismiss = vi.fn();
    const m = mountReveal({ rawKey: 'hk_secret', ttlMs: 300_000, ondismiss });
    m.target.querySelector<HTMLButtonElement>('[data-testid="raw-key-dismiss"]')!.click();
    expect(ondismiss).toHaveBeenCalledTimes(1);
  });
});
