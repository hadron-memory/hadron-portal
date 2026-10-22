import { afterEach, expect, it } from 'vitest';
import { navigating } from '$lib/test/stubs/app-stores';
import { mountComponent, tick } from '$lib/test/mountComponent';
import NavigationFeedback from './NavigationFeedback.svelte';
afterEach(() => navigating.set(null));
it('shows navigation feedback while the router is pending, and clears it on settle', async () => {
  const m = mountComponent(NavigationFeedback, {});
  try {
    expect(m.target.querySelector('[role=status]')).toBeNull();
    navigating.set({ to: { url: new URL('http://localhost/app/dashboard') } });
    await tick();
    expect(m.target.textContent).toContain('Loading page');
    navigating.set(null);
    await tick();
    expect(m.target.querySelector('[role=status]')).toBeNull();
  } finally { m.unmount(); }
});
