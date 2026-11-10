import { error } from '@sveltejs/kit';
import { templatesPageData } from '$lib/server/memory-config/page-data';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
  if (!locals.user) error(401, 'Sign in to continue.');
  setHeaders({ 'cache-control': 'private, no-store' });
  return templatesPageData(locals, 'USER', locals.user?.id!);
};
