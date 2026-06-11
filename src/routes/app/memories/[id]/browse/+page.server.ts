import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// #266: /browse is superseded by the /graph and /nodes tabs. Redirect (keeping
// any ?focus=<nodeId>) so old links/bookmarks land on the graph view.
export const load: PageServerLoad = ({ params, url }) => {
  redirect(308, `/app/memories/${params.id}/graph${url.search}`);
};
