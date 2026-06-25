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
