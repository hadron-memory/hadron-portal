/**
 * Browser-proof harness for the App page's roster states (portal#2238).
 *
 * Mounts the real `+page.svelte` with the shared `app-page.fixture` data on a
 * bare document, the way `agent-chat-phone-harness` mounts AgentChat for the
 * phone-layout proofs: no SvelteKit request context, no backend — `$app/*`
 * imports are rewritten to the test stubs by the driver's transform, and
 * `window.fetch` is replaced by a recorder whose `/roster` answer is whatever
 * `window.__roster` says ('hang' never resolves, otherwise it is the JSON the
 * endpoint would return). The fetch log lets the proof assert the acceptance
 * line that no roster request starts before the AI Team tab is shown.
 *
 * `window.__mountAppPage()` returns the roster-read-only view the driver
 * needs; the driver clicks the tab itself, like a reader would.
 */
import { mount, unmount } from 'svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from '../../../routes/app/apps/[appId]/+page.svelte';
import { pageData } from '../../../routes/app/apps/[appId]/app-page.fixture';

export interface HarnessRosterControl {
  /** 'hang' = never resolve; else the TeamRosterRead JSON to answer with. */
  mode: 'hang' | { kind: 'ok'; byWorker: Record<string, unknown> } | { kind: 'failed' } | { kind: 'hidden' };
}

declare global {
  interface Window {
    __roster: HarnessRosterControl['mode'];
    __fetchLog: string[];
    __mountAppPage: () => Promise<{ unmount: () => void }>;
  }
}

window.__roster = { kind: 'failed' };
window.__fetchLog = [];

window.fetch = (async (input: RequestInfo | URL) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  window.__fetchLog.push(href);
  if (href.endsWith('/roster')) {
    if (window.__roster === 'hang') return new Promise<Response>(() => {});
    // The control IS the TeamRosterRead JSON the endpoint would return.
    return new Response(JSON.stringify(window.__roster), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  // Everything else (the team chat poll among them): degraded-but-ok, as in
  // the client-lane tests, so nothing here depends on poll timing.
  return new Response(JSON.stringify({ items: [], total: 0, loadFailed: true }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

window.__mountAppPage = async () => {
  setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
  window.history.replaceState({}, '', '/app/apps/a1?tab=chats');
  const data = {
    ...(await pageData()),
    // portal#2238: a non-staff open carries NO roster — that is the state
    // under proof. Two workers so the grid shows a tasked row and a paused
    // row, and a task the loaded roster can name.
    teamRoster: null,
    staff: [
      { id: 'w1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', retiredAt: null },
      { id: 'w2', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara', retiredAt: null },
    ],
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
