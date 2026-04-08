import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Redirect to the canonical agent detail page — avoids maintaining two copies
export const load: PageServerLoad = async ({ params }) => {
  redirect(301, `/app/agents/${params.aid}`);
};
