// #648: navigation alias → the canonical org-optional App runs page.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
  // #1732: wait for the app layout (it writes the active-org cookie) first.
  await parent();
  redirect(303, `/app/apps/${params.appId}/runs`);
};
