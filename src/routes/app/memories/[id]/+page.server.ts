import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// #266: the memory-detail page is a tab layout. The index has no content of its
// own — it redirects to the default tab. (Becomes /info once that tab ships.)
export const load: PageServerLoad = ({ params }) => {
  redirect(307, `/app/memories/${params.id}/nodes`);
};
