import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { SEARCH_USERS_QUERY } from '$lib/server/queries';
import type { RequestHandler } from './$types';

// User search for the "Add existing user" picker (#414). Browser → this
// endpoint → hadron-server `searchUsers`. GraphQL only runs server-side (the
// token lives in locals), so SelectUser fetches here, the same way the node
// search picker hits /api/nodes/search.
//
// Privacy is the whole point of this endpoint: the org-members page no longer
// bulk-loads every user into the page. We forward only the typed query, and we
// strip name + raw email from the response — the client gets a handle, an
// optional github username, an avatar, and a *masked* email for display only.
// Selection is by opaque id, so the UI never needs the real address.

interface SearchUserRow {
  id: string;
  handle: string | null;
  urn: string | null;
  githubUsername: string | null;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
}

// "john.doe@example.com" → "j•••@example.com". Returns null when there's no
// local part to keep (so the row falls through to a non-email label).
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return null;
  return `${email[0]}•••${email.slice(at)}`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { query } = await request.json();
  const q = typeof query === 'string' ? query.trim() : '';
  // Mirror the picker's 3-char gate server-side so the "don't match too broadly"
  // contract holds for any caller, not just the UI button-disable.
  if (q.length < 3) return json({ users: [] });

  try {
    const data = await gqlClient(locals.token).request<{ searchUsers: SearchUserRow[] }>(
      SEARCH_USERS_QUERY,
      { query: q },
    );
    // Drop name + raw email before the data leaves the server.
    const users = (data.searchUsers ?? []).map((u) => ({
      id: u.id,
      handle: u.handle,
      urn: u.urn,
      githubUsername: u.githubUsername,
      avatarUrl: u.avatarUrl,
      emailMasked: maskEmail(u.email),
    }));
    return json({ users });
  } catch (e: unknown) {
    // Log detail server-side; return a generic message so GraphQL/DB internals
    // aren't leaked to the client (mirrors /api/nodes/search).
    console.error('[/api/users/search] failed:', e);
    return json({ error: 'Search failed' }, { status: 500 });
  }
};
