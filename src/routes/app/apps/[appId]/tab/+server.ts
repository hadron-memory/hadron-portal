// portal#2240 — one tab of the App page, on its first show.
//
// Ruling 0273: the App page loads only what its first screen renders. The
// page load reads the frame and the tab the URL opens on; a tab switch is
// client state (`activeTab = id`, no navigation), so the page asks HERE for
// the tab it has just shown, once per visit (see +page.svelte's tab cache).
//
// The payload is the page load's own, for that tab's read groups only
// (`first-screen.ts`), produced by the same function (`_loadAppPage`), so a
// tab renders the same data whichever way it arrived. The frame is not
// re-read: the page already holds it.
//
// Access control is the GraphQL queries' with the caller's own token, exactly
// as for the page load (cor:acl; the #2240 gate's condition 2): the App read
// gates every tab, and each tab's reads keep their own classified failures.
// No portal-side gate is re-implemented here.
//
// The query string is the page's own (`?tab=<id>` plus whatever the page URL
// carries: a chat, a worklog filter, a list offset), so URL-driven reads and
// the pagers they build see the same state as a page load of that URL.
import { error, isHttpError, json } from '@sveltejs/kit';
import { _loadAppPage } from '../+page.server';
import { APP_TAB_IDS } from '../tab-intent';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'private, no-store' };

export const GET: RequestHandler = async ({ params, locals, url, cookies }) => {
  if (!locals.token || !locals.user?.id) {
    return json({ kind: 'failed' }, { status: 401, headers });
  }
  const tab = url.searchParams.get('tab');
  if (!tab || !(APP_TAB_IDS as readonly string[]).includes(tab)) error(400, 'Unknown tab');
  const pageUrl = new URL(`/app/apps/${encodeURIComponent(params.appId)}${url.search}`, url.origin);
  try {
    const payload = await _loadAppPage(
      { params, locals, url: pageUrl, cookies, setHeaders: () => {} } as unknown as Parameters<typeof _loadAppPage>[0],
      { frame: false, tab },
    );
    return json(payload, { headers });
  } catch (e) {
    // The App read refused (404) or failed (500): the tab shows its "couldn't
    // load" state. The status travels; the server's text does not.
    if (isHttpError(e)) return json({ kind: 'failed' }, { status: e.status, headers });
    console.warn(`[app-tab] ${tab} load failed for ${params.appId}:`, e);
    return json({ kind: 'failed' }, { status: 500, headers });
  }
};
