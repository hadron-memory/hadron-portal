// #648: navigation alias → the canonical org-optional App runs page.
import { withQuery } from '$lib/safeRedirect';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent, url }) => {
  // #1732: wait for the app layout (it writes the active-org cookie) first.
  await parent();
  const query = new URLSearchParams(url.search); query.set('tab', 'runs');
  redirect(308, withQuery(`/app/apps/${encodeURIComponent(params.appId)}`, query.toString()));
};
