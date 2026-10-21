// Shared shape + display label for the privacy user-search picker (#414).
// Lives outside the .svelte components so both SelectUser and its callers use
// one definition (avoids the label precedence drifting between the picker rows
// and the "selected user" display on the members page).

// Lean projection returned by POST /api/users/search — deliberately no `name`
// and no raw email; `emailMasked` is masked server-side.
export interface SearchUser {
  id: string;
  handle: string | null;
  urn: string | null; // hrn:user:<handle>; null for a handle-less user
  githubUsername: string | null;
  avatarUrl: string | null;
  emailMasked: string | null;
}

// Best identifier we're allowed to show: handle, then @github, then the masked
// email; never a name or raw address. '—' only if a user has none of these.
export function userLabel(u: SearchUser): string {
  if (u.handle) return `@${u.handle}`;
  if (u.githubUsername) return `@${u.githubUsername}`;
  return u.emailMasked ?? '—';
}

/** One page of picker results. `truncated` is true when the server holds more matches than it returned. */
export interface SearchUserPage {
  users: SearchUser[];
  truncated: boolean;
}

/**
 * POST /api/users/search, minus anyone the caller already lists. `truncated`
 * compares the server's `total` with the rows it returned BEFORE the exclusion,
 * so hiding existing members never reads as "no more matches".
 */
export async function searchUsersPage(query: string, exclude: ReadonlySet<string> = new Set()): Promise<SearchUserPage> {
  const res = await fetch('/api/users/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error('Search failed');
  const data = (await res.json()) as { users?: SearchUser[]; total?: number };
  const rows = data.users ?? [];
  return { users: rows.filter((u) => !exclude.has(u.id)), truncated: (data.total ?? rows.length) > rows.length };
}
