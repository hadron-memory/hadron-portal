import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import LiveRegionHost from '$lib/test/fixtures/LiveRegionHost.svelte';

// portal#2344, hrn:node:hadronmemory.com:hadron-portal:review:live-region-persistent-not-conditionally-mounted
// A screen reader announces a CHANGE inside a live region that already exists. So the
// pin is the lifecycle, not the presence: the region EXISTS and is EMPTY before, holds
// the text during, and STILL EXISTS after.
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const region = (t: HTMLElement) => t.querySelector<HTMLElement>('[role="status"]');

describe('LiveRegion', () => {
  it('is mounted and empty before there is anything to say', async () => {
    mounted = mountComponent(LiveRegionHost as never, {} as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const r = region(mounted.target);
    expect(r).not.toBeNull();
    expect(r!.getAttribute('aria-live')).toBe('polite');
    expect(r!.textContent?.trim()).toBe('');
    expect(r!.querySelector('.host-box')).toBeNull();
  });

  it('keeps the SAME element while its content changes in and out', async () => {
    mounted = mountComponent(LiveRegionHost as never, {} as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const before = region(mounted.target)!;
    (mounted.instance.say as (s: string) => void)('Saved');
    flushSync();
    expect(region(mounted.target)).toBe(before);
    expect(before.querySelector('.host-box')?.textContent).toBe('Saved');
    (mounted.instance.say as (s: string) => void)('');
    flushSync();
    expect(region(mounted.target)).toBe(before);
    expect(before.textContent?.trim()).toBe('');
  });

  it('passes the caller class through and carries the empty:m-0 class (spacing itself is checked in the browser)', async () => {
    mounted = mountComponent(LiveRegionHost as never, {} as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const cls = region(mounted.target)!.className.split(/\s+/);
    expect(cls).toContain('host-region');
    expect(cls).toContain('empty:m-0');
  });
});
