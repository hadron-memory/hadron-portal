// The caller's own memories that could be added to this App, read when the Add memory picker opens.
//
// Not part of the page load: most visits never open the picker, and the list is the caller's own, so it
// is asked for on demand with the caller's token. A failing or hung read answers `{ kind: 'failed' }`
// with status 200 (a background fetch, like the roster's), never a throw and never server text; a
// session-less caller gets 401. The org comes from the App itself, not from the request. Who may attach
// what is the server's decision when the attach runs; this list only saves the user a refusal.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { APP_ORG_QUERY, readAttachableMemories, type AttachableMemory } from '../app-memories';
import type { RequestHandler } from './$types';

export type AttachableRead = { kind: 'ok'; memories: AttachableMemory[] } | { kind: 'failed' };

export const GET: RequestHandler = async ({ params, locals }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token || !locals.user?.id) return json({ kind: 'failed' } satisfies AttachableRead, { status: 401, headers });
  const client = gqlClient(locals.token);
  try {
    const { app } = await client.request<{ app: { organizationId: string | null } | null }>(APP_ORG_QUERY, { ref: params.appId });
    if (!app) return json({ kind: 'failed' } satisfies AttachableRead, { headers });
    const memories = await readAttachableMemories(client, app.organizationId);
    return json((memories ? { kind: 'ok', memories } : { kind: 'failed' }) satisfies AttachableRead, { headers });
  } catch {
    return json({ kind: 'failed' } satisfies AttachableRead, { headers });
  }
};
