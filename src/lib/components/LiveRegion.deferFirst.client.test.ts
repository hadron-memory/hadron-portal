import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { firstPaint } from '$lib/test/firstPaint';
import LiveRegionDeferHost from '$lib/test/fixtures/LiveRegionDeferHost.svelte';

// portal#2388: `deferFirst` inserts the region EMPTY and fills it after the first paint, so the first read is a
// change inside a region that already exists. It is opt-in, and it must clean up if the host goes first.
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.useRealTimers(); });
const host = (props: Record<string, unknown>) => (mounted = mountComponent(LiveRegionDeferHost as never, props as never) as Mounted<Record<string, unknown>>);
const region = () => mounted!.target.querySelector<HTMLElement>('[data-testid="host-region"]')!;

describe('LiveRegion deferFirst', () => {
  it('is inserted empty, idle, and fills after the first paint in the SAME element', async () => {
    host({ defer: true });
    const before = region();
    await tick(4);
    expect(before.textContent?.trim(), 'nothing is present in the frame that inserts the region').toBe('');
    expect(before.getAttribute('role')).toBe('status');
    expect(before.hasAttribute('data-idle')).toBe(true);
    await firstPaint();
    expect(region()).toBe(before);
    expect(before.textContent?.trim()).toBe('Loading…');
    expect(before.hasAttribute('data-idle')).toBe(false);
  });

  it('is opt-in: without it the text is there at once', async () => {
    host({ defer: false });
    await tick(2);
    expect(region().textContent?.trim()).toBe('Loading…');
  });

  it('a host that unmounts before the first paint leaves no timer and never fills', async () => {
    vi.useFakeTimers();
    host({ defer: true });
    const el = region();
    mounted!.unmount();
    mounted = undefined;
    expect(vi.getTimerCount(), 'the pending frame is cancelled with the region').toBe(0);
    await vi.runAllTimersAsync();
    expect(el.textContent?.trim()).toBe('');
  });
});
