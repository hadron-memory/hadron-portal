// #648: navigation alias → the canonical org-optional App run detail page.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  redirect(303, `/app/apps/${params.appId}/runs/${params.runId}`);
};
