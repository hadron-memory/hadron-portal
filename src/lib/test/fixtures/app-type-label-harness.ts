/**
 * Browser-proof harness for the App type's labels (portal#2249).
 *
 * Mounts the real `+page.svelte` with the shared `app-page.fixture` data on a
 * bare document, the way `app-page-roster-harness` does: no SvelteKit request
 * context, no backend — `$app/*` imports are rewritten to the test stubs by
 * the driver's transform, and `window.fetch` is replaced by a recorder that
 * answers the non-essential polls with degraded-but-ok, as in the client-lane
 * tests. `window.__mountAppTypePage({ tab, appType })` returns the handle the
 * proof driver needs; the driver reads the Type rows itself, like a reader
 * would, and clicks the Settings card's Edit button to see the options.
 */
import { mount, unmount } from 'svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from '../../../routes/app/apps/[appId]/+page.svelte';
import { pageData } from '../../../routes/app/apps/[appId]/app-page.fixture';

export interface HarnessOptions {
  /** Which panel to open: the Profile tab or the Settings tab (read-only view). */
  tab: 'profile' | 'settings';
  /** The App type to render ('FUTURE' proves the raw-value fallback). */
  appType: string;
}

declare global {
  interface Window {
    __mountAppTypePage: (options: HarnessOptions) => Promise<{ unmount: () => void }>;
  }
}

window.fetch = (async (input: RequestInfo | URL) => {
  // Everything (the team chat poll among them): degraded-but-ok, as in the
  // client-lane tests, so nothing here depends on poll timing.
  return new Response(JSON.stringify({ items: [], total: 0, loadFailed: true }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

window.__mountAppTypePage = async ({ tab, appType }: HarnessOptions) => {
  const url = `/app/apps/a1?tab=${tab}`;
  setStubPage(`https://example.test${url}`, { appId: 'a1' });
  window.history.replaceState({}, '', url);
  const base = await pageData();
  const data = {
    ...base,
    app: { ...base.app, appType },
    initialTab: tab,
    canManageApp: true,
  };
  const target = document.createElement('div');
  target.className = 'p-4';
  document.body.appendChild(target);
  const app = mount(Page as never, { target, props: { data, form: null } as never });
  return {
    unmount: () => {
      void unmount(app);
      target.remove();
    },
  };
};

export {};
