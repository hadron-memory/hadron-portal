import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** #1936: the templates are a tab of the App page now. This route stays as a deep link. */
export const load: PageServerLoad = ({ params }) => {
  redirect(308, `/app/apps/${encodeURIComponent(params.appId!)}?tab=node-role-templates`);
};
