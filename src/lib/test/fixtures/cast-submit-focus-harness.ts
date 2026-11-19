/**
 * portal#1796: mounts the real App page on its AI Team tab for scripts/test-cast-submit-focus.mjs.
 *
 * Same shape as app-page-roster-harness: the real `+page.svelte` over the shared fixture data, no
 * backend. `$app/*` imports are rewritten to the test stubs by the driver EXCEPT `$app/forms`, which
 * stays real: the point is superforms' real `use:enhance` round trip, so the POST to `?/castWorker`
 * is faked at the network layer by the driver (page.route) and kit's own deserialize/applyAction
 * chain runs. Returns after the page is mounted and the composer is closed.
 */
import { mount, unmount } from 'svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from '../../../routes/app/apps/[appId]/+page.svelte';
import { pageData } from '../../../routes/app/apps/[appId]/app-page.fixture';

declare global {
  interface Window {
    __mountCastPage: () => Promise<{ unmount: () => void }>;
  }
}

window.__mountCastPage = async () => {
  setStubPage('https://example.test/app/apps/a1?tab=staff', { appId: 'a1' });
  window.history.replaceState({}, '', '/app/apps/a1?tab=staff');
  const data = await pageData();
  Object.assign(data.app, { agents: [
    { id: 'agent-a', name: 'Portal Engineer', urn: 'hrn:agent:acme.com:portal', personaRole: 'portal-engineer' },
  ] });
  data.initialTab = 'staff';
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
