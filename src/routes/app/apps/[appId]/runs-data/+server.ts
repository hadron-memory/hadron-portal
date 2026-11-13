import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadAppRunsPage } from '$lib/server/app-runs-page';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params, locals, url }) => json(await loadAppRunsPage(gqlClient(locals.token), params.appId, url.searchParams), { headers: { 'cache-control': 'private, no-store' } });
