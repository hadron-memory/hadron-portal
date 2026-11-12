import { redirect } from '@sveltejs/kit';
import { withQuery } from '$lib/safeRedirect';
import type { PageServerLoad } from './$types';

// #266: the memory-detail page is a tab layout. The index has no content of its
// own — it redirects to the default (Info) tab.
//
// #761: carrying `url.search` matters here for a reason that is invisible from
// this file. A memory URN resolved through /app/u/[urn] lands on
// /app/memories/<id> and is immediately redirected AGAIN by this loader, so a
// deep link's state has to survive TWO hops. Fixing only the resolver left the
// memory kind — alone among the seven — still silently losing its query string
// at this second hop.
//
// #1394: wait for the parent layout before redirecting. The app layout writes
// the active-org cookie after its GraphQL awaits, and SvelteKit runs layout and
// page loads in parallel, so a redirect that settles first can let the response
// be generated before `cookies.set` runs ("Cannot use cookies.set(...) after the
// response has been generated"). A defensive ordering on a static lead; the root
// cause of the intermittent 500 is unconfirmed. Same pattern as
// routes/app/assets/+page.server.ts.
export const load: PageServerLoad = async ({ params, url, parent }) => {
  await parent();
  redirect(307, withQuery(`/app/memories/${params.id}/info`, url.search));
};
