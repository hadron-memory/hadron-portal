import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// #336: AI service configs moved into the Integrations tab. Keep this route as
// a redirect so existing links/bookmarks (e.g. global search hits) still land.
export const load: PageServerLoad = ({ params }) => {
  redirect(308, `/app/orgs/${params.id}/integrations`);
};
