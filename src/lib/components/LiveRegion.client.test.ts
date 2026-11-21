import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import LiveRegionHost from '$lib/test/fixtures/LiveRegionHost.svelte';
import LiveRegionTwoBlocksHost from '$lib/test/fixtures/LiveRegionTwoBlocksHost.svelte';

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

  it('passes the caller class through and carries the idle:m-0 class', async () => {
    mounted = mountComponent(LiveRegionHost as never, {} as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const cls = region(mounted.target)!.className.split(/\s+/);
    expect(cls).toContain('host-region');
    expect(cls).toContain('idle:m-0');
  });
});

// portal#2394: `:empty` is not enough. Two sibling blocks leave a whitespace text node between their
// anchors, `:empty` never matches, `empty:m-0` stays inert and a `space-y-*` parent keeps its margin on
// a zero-height region. The region says it is idle itself, from its content, not from `:empty`.
describe('LiveRegion: idle state does not depend on :empty (portal#2394)', () => {
  const say = (m: Mounted<Record<string, unknown>>, a: string, b: string) => (m.instance.say as (a: string, b: string) => void)(a, b);

  it('the served shape holds a text node, so :empty is false while the region is idle', async () => {
    mounted = mountComponent(LiveRegionTwoBlocksHost as never, {} as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const r = region(mounted.target)!;
    expect([...r.childNodes].some((n) => n.nodeType === 3 && n.textContent !== '')).toBe(true);
    expect(r.matches(':empty')).toBe(false);
  });

  it('an idle region is marked idle despite that text node, and says so again after content comes and goes', async () => {
    mounted = mountComponent(LiveRegionTwoBlocksHost as never, {} as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const r = region(mounted.target)!;
    expect(r.hasAttribute('data-idle')).toBe(true);
    say(mounted, 'Saved', '');
    await tick(2);
    expect(r.hasAttribute('data-idle')).toBe(false);
    say(mounted, '', '');
    await tick(2);
    expect(r.hasAttribute('data-idle')).toBe(true);
    say(mounted, '', 'Second only');
    await tick(2);
    expect(r.hasAttribute('data-idle')).toBe(false);
  });

  it('a region that is only whitespace is idle; one holding an element is not', async () => {
    mounted = mountComponent(LiveRegionHost as never, {} as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const r = region(mounted.target)!;
    expect(r.hasAttribute('data-idle')).toBe(true);
    (mounted.instance.say as (s: string) => void)('x');
    await tick(2);
    expect(r.hasAttribute('data-idle')).toBe(false);
  });

  it('drops its margin through the idle variant, not only :empty', async () => {
    mounted = mountComponent(LiveRegionHost as never, {} as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    expect(region(mounted.target)!.className.split(/\s+/)).toContain('idle:m-0');
  });
});
