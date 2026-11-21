/**
 * The App page's mount data for the App type proofs (portal#2249/#2254): the
 * shared `app-page.fixture` data with the tab opened and the App overridden,
 * plus the stub route the page reads its tab from. One source for the client
 * test (`mountTab`) and the browser-proof harness, so the two cannot drift.
 * Side-effect free on import (the harness replaces `window.fetch`; this must
 * not).
 */
import { setStubPage } from '$lib/test/stubs/app-stores';
import { pageData } from '../../../routes/app/apps/[appId]/app-page.fixture';

export async function appTypePageData(tab: 'profile' | 'settings', appType: string) {
  const url = `/app/apps/a1?tab=${tab}`;
  setStubPage(`https://example.test${url}`, { appId: 'a1' });
  window.history.replaceState({}, '', url);
  const base = await pageData();
  return { ...base, app: { ...base.app, appType }, initialTab: tab, canManageApp: true };
}
