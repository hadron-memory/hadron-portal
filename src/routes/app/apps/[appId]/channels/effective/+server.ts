import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ATTENDEE_REGISTER_QUERY } from '$lib/server/queries';
import { effectiveRows, type RegisterViewRow } from '$lib/register-view';
import type { RequestHandler } from './$types';

/**
 * #942 slice 4: one attendee's EFFECTIVE register, on demand. The Channels
 * page asks per attendee rather than resolving every Worker and Agent up
 * front (one request each).
 *
 * The server gates it on App participation, and a foreign or unknown attendee
 * is an empty list: never an oracle, and not an error. Only facts true about
 * the ATTENDEE are returned (see $lib/register-view). The resolver's
 * canRead/canPost/disclosure describe the attendee since server #1560. Only
 * worded standing leaves this closed projection, and only for a host memory
 * visible to the viewer; the raw fields remain server-side.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
  const attendee = url.searchParams.get('attendee')?.trim() ?? '';
  const kind = url.searchParams.get('kind');
  if (!attendee || (kind !== 'worker' && kind !== 'agent')) {
    return json({ loadFailed: true, reason: 'bad-request' }, { status: 400 });
  }
  const vars = kind === 'worker' ? { workerRef: attendee } : { agentRef: attendee, appRef: params.appId };
  try {
    const r = await gqlClient(locals.token).request<{ attendeeRegister: RegisterViewRow[] }>(ATTENDEE_REGISTER_QUERY, vars);
    return json({ loadFailed: false, rows: effectiveRows(r.attendeeRegister, kind), loadedAt: new Date().toISOString() });
  } catch (e) {
    console.warn(`[app-channels] attendeeRegister failed for ${kind} ${attendee}:`, e);
    // A failed read is not an empty register; the page says which.
    return json({ loadFailed: true, reason: 'fetch-failed' }, { status: 502 });
  }
};
