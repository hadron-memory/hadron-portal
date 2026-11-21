import { afterEach, expect, it } from 'vitest';
import { navigating } from '$lib/test/stubs/app-stores';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { announcedStatusRegion } from '$lib/test/firstPopulatedStatusText';
import NavigationFeedback from './NavigationFeedback.svelte';
afterEach(() => navigating.set(null));
it('shows navigation feedback while the router is pending, and clears it on settle', async () => {
  const m = mountComponent(NavigationFeedback, {});
  try {
    // portal#2344: one region, mounted empty, announces the loading line and then goes quiet.
    const region = m.target.querySelector<HTMLElement>('[role=status]');
    expect(region, 'the region exists before navigation').not.toBeNull();
    expect(region!.textContent?.trim()).toBe('');
    navigating.set({ to: { url: new URL('http://localhost/app/dashboard') } });
    await tick();
    expect(announcedStatusRegion(m.target)).toBe(region);
    expect(region!.textContent).toContain('Loading page');
    navigating.set(null);
    await tick();
    expect(m.target.querySelector('[role=status]')).toBe(region);
    expect(region!.textContent?.trim()).toBe('');
  } finally { m.unmount(); }
});
