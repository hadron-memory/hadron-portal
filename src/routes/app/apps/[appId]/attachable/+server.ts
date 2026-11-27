// One page of the memories the caller could attach to this App, read as the user types and pages in the Add memory picker.
//
// A thin door onto the server's attachableMemories search: the query and the offset go straight through and the server
// matches, pages, and leaves out anything already attached or not attachable. A failing or hung read answers
// `{ kind: 'failed', code }` with status 200 (a background fetch, like the roster's), never a throw and never server text; the
// code is one of a fixed few so the picker can say why. A session-less caller gets 401.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { readAttachableMemoriesPage, type AttachableMemory } from '../app-memories';
import { ATTACHABLE_PAGE_SIZE, type AttachableFailure } from '../attachable-page';
import type { RequestHandler } from './$types';

export type AttachableRead = { kind: 'ok'; memories: AttachableMemory[]; total: number } | { kind: 'failed'; code: AttachableFailure };

const QUERY_MAX = 200;
const OFFSET_MAX = 100_000;
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token || !locals.user?.id) return json({ kind: 'failed', code: 'UNAUTHENTICATED' } satisfies AttachableRead, { status: 401, headers });
  const n = Number(url.searchParams.get('offset'));
  const offset = Number.isFinite(n) ? Math.min(OFFSET_MAX, Math.max(0, Math.floor(n))) : 0;
  const query = (url.searchParams.get('q') ?? '').slice(0, QUERY_MAX);
  const page = await readAttachableMemoriesPage(gqlClient(locals.token), params.appId, { query, offset, limit: ATTACHABLE_PAGE_SIZE });
  return json((page.ok ? { kind: 'ok', memories: page.memories, total: page.total } : { kind: 'failed', code: page.code }) satisfies AttachableRead, { headers });
};
