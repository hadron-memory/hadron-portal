import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * #1031 — the node edit page is now the node page's Properties tab.
 *
 * This route held the object type, typed-properties and skill-export form
 * (#588, #864, #878) behind an "Edit" button on that tab. The form now lives
 * on the tab itself, so the URL only redirects there. It stays a route rather
 * than a 404 because it is in the wild: bookmarks, issue and PR text, and the
 * Task Nodes list linked here until #1031.
 *
 * The caller's query rides along (`hrn:node:hadronmemory.com:hadron-portal:review:redirect-must-carry-query-and-count-hops`),
 * with `tab` forced to `properties`. The node page then makes at most one more
 * hop, its #237 memory canonicalization, which carries the query too, and
 * applies the node page's own access guards.
 *
 * An endpoint rather than a page: there is nothing left to render.
 *
 * No access check here: the node page is the gate, and redirecting to it
 * reveals nothing the URL did not already contain.
 */
export const GET: RequestHandler = ({ params, url }) => {
  const query = new URLSearchParams(url.search);
  query.set('tab', 'properties');
  redirect(307, `/app/memories/${params.id}/nodes/${params.nodeId}?${query}`);
};
