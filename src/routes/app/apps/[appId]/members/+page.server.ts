import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * #1005: the members list is the App page's "Human Team" tab now. This URL is
 * in bookmarks, the org-scoped redirect beside it, and old PR text, so it
 * forwards rather than disappearing — an unknown route would 404 where the
 * reader expects the people list.
 */
export const load: PageServerLoad = ({ params }) => {
  redirect(307, `/app/apps/${params.appId}?tab=members`);
};
