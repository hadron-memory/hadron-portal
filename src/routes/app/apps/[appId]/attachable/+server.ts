// The memories the caller can read that could be linked into this App, read when the Add memory picker opens.
//
// Not part of the page load: most visits never open the picker, and the list is the caller's own, so it
// is asked for on demand with the caller's token. A failing or hung read answers `{ kind: 'failed' }`
// with status 200 (a background fetch, like the roster's), never a throw and never server text; a
// session-less caller gets 401. Nothing from the request narrows the list (no organization, no owner). Who may
// attach what is the server's decision when the attach runs; this list only saves the user a refusal.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { readAttachableMemories, type AttachableMemory } from '../app-memories';
import type { RequestHandler } from './$types';

export type AttachableRead = { kind: 'ok'; memories: AttachableMemory[] } | { kind: 'failed' };

export const GET: RequestHandler = async ({ locals }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token || !locals.user?.id) return json({ kind: 'failed' } satisfies AttachableRead, { status: 401, headers });
  const client = gqlClient(locals.token);
  try {
    const memories = await readAttachableMemories(client);
    return json((memories ? { kind: 'ok', memories } : { kind: 'failed' }) satisfies AttachableRead, { headers });
  } catch {
    return json({ kind: 'failed' } satisfies AttachableRead, { headers });
  }
};
