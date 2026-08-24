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
export const load: PageServerLoad = ({ params, url }) => {
  redirect(307, withQuery(`/app/memories/${params.id}/info`, url.search));
};
