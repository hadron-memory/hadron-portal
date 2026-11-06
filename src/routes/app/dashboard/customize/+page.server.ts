// #636 → #788: the separate customize page is retired — dashboard editing now
// happens in place on /app/dashboard (the Customize button flips the widget
// grid into an editor). Permanent redirect for old links/bookmarks.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  // #1732: wait for the app layout (it writes the active-org cookie) first.
  await parent();
  redirect(301, '/app/dashboard');
};
