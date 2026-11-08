import { json } from '@sveltejs/kit';
import { readUserApiKeys } from '$lib/server/user-api-keys';
import type { RequestHandler } from './$types';

// #1653 QA P2 (Colette, e7ccec27): the key list's own re-read after a
// confirmed delete. The Delete dialog used to refresh with invalidateAll(),
// and a failed __data.json there is rendered by kit as the error page over the
// whole page before any catch runs (invalidateAll resolves, it does not
// reject), so the confirmed deletion and its Reload were lost to a generic 500
// (hrn:node:hadronmemory.com:hadron-portal:findings:refresh-failure-lands-on-the-error-page).
// Through this endpoint a failed re-read is a failed request inside the page,
// which the page reports itself
// (hrn:node:hadronmemory.com:hadron-portal:findings:section-retry-owns-its-re-read).
//
// Same token, same reader and same view parameter as the page loader. A
// refused read answers `{ failed: true }` in a 200, never the server's prose;
// only an unauthenticated caller gets an HTTP error.
export const GET: RequestHandler = async ({ locals, url }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  const includeHidden = url.searchParams.get('includeHidden') === 'true';
  try {
    return json({ keys: await readUserApiKeys(locals.token, includeHidden) }, { headers });
  } catch (e) {
    console.error('[account/api-keys/list] re-read failed:', e);
    return json({ failed: true }, { headers });
  }
};
