import { expect, it } from 'vitest';
import { page } from '$lib/test/stubs/app-stores';
import { mountComponent } from '$lib/test/mountComponent';
import Page from './+page.svelte';

it('renders committed loader data when client query spelling differs from Kit canonicalization', () => {
  const path = '/app/apps/app/usage';
  // Kit data requests delete internal params, reserializing URLSearchParams.
  // The browser URL can retain this equally valid, noncanonical spelling.
  const browser = new URL('https://portal.test' + path + '?account=[%22shared%22,%22one%22,%22codex%22]');
  const canonical = new URL(browser);
  canonical.searchParams.delete('x-sveltekit-invalidated');
  expect(browser.search).not.toBe(canonical.search);
  page.update(p => ({ ...p, url: browser }));
  const m = mountComponent(Page as never, { data: {
    app: { id: 'app', name: 'Demo' }, view: { kind: 'hidden' },
    key: canonical.pathname + canonical.search,
  } } as never);
  try {
    expect(m.target.textContent).toContain('Token use is not shown to you.');
    expect(m.target.textContent).not.toContain('Loading…');
  } finally { m.unmount(); }
});
