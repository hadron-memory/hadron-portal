import { rulesPageData } from '$lib/server/memory-config/page-data';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
  setHeaders({ 'cache-control': 'private, no-store' });
  return { ...await rulesPageData(locals, params.id), memoryRef: params.id };
};
