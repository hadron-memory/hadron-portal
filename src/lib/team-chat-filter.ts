// The team-chat team filter (#1137) and its multi-select extension (#1482).
//
// A viewer filters the App's team chat to one or SEVERAL team heads, or to the
// messages that carry no stored team tag. Both are SERVER-SIDE reads on
// `teamChatMessages` (`teamHeadRefs` / `untagged`, mutually exclusive): the
// portal never filters a loaded page, never reads a body for `@team`, and never
// computes a team. A person has no team, so there is no "my team" default.
//
// #1482 (built on server#3759): the selection is a SET of heads — messages
// tagged with ANY of them are shown. One head is the set of one, and the
// portal sends `teamHeadRefs` on that path too, so there is exactly one wire
// shape for the team arm. The URL carries the set as repeated `?team=` values.
//
// The identity is the head's stable ID. A tag's `label` is a post-time display
// snapshot and can collide or go stale, so nothing here is keyed on one.

export type TeamChatFilter =
  | { kind: 'none' }
  | { kind: 'teams'; headRefs: string[] }
  | { kind: 'untagged' };

export const NO_TEAM_FILTER: TeamChatFilter = { kind: 'none' };

/** The `?team=` value that selects the untagged view. A head id never spells it. */
export const UNTAGGED_PARAM = 'untagged';

// Ids are opaque to the portal; this only keeps a hostile or mangled value out
// of a URL and a GraphQL variable. The server's typed refusal stays the
// authority on whether a well-formed id is a usable head.
const HEAD_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Read the `?team=` values (`searchParams.getAll`: the selection is a set,
 * carried as repeated parameters). A malformed value — or `untagged` mixed
 * with heads, which the server would refuse as mutually exclusive — is
 * `{ ok: false }`, never the unfiltered thread: falling back would show a
 * reader MORE than they asked for under a filter they believe is applied.
 * Duplicates collapse (the set is the selection); first-seen order is kept
 * for display.
 */
export function parseTeamParam(raws: readonly string[] | null): { ok: true; filter: TeamChatFilter } | { ok: false } {
  if (raws === null || raws.length === 0) return { ok: true, filter: NO_TEAM_FILTER };
  if (raws.length === 1 && raws[0] === UNTAGGED_PARAM) return { ok: true, filter: { kind: 'untagged' } };
  const headRefs: string[] = [];
  for (const raw of raws) {
    if (raw === UNTAGGED_PARAM || !HEAD_REF_PATTERN.test(raw)) return { ok: false };
    if (!headRefs.includes(raw)) headRefs.push(raw);
  }
  return { ok: true, filter: { kind: 'teams', headRefs } };
}

/**
 * Toggle one head in a selection (a message tag chip's click): add it, or
 * remove it when it is already selected. Removing the last head clears the
 * filter entirely — an empty `teamHeadRefs` list is "no filter" (the server
 * reads `[]` that way), and the portal models that as `none`, never as a set
 * of zero.
 */
export function toggleTeamHead(filter: TeamChatFilter, headRef: string): TeamChatFilter {
  const current = filter.kind === 'teams' ? filter.headRefs : [];
  const next = current.includes(headRef) ? current.filter((r) => r !== headRef) : [...current, headRef];
  return next.length > 0 ? { kind: 'teams', headRefs: next } : NO_TEAM_FILTER;
}

/** The GraphQL variables for a filter: exactly one of the pair, or neither. */
export function filterVariablesOf(filter: TeamChatFilter): { teamHeadRefs?: string[]; untagged?: true } {
  if (filter.kind === 'teams') return { teamHeadRefs: filter.headRefs };
  if (filter.kind === 'untagged') return { untagged: true };
  return {};
}

/** The query-string fragment (no leading `?`/`&`) that carries a filter, or ''. */
export function filterQueryOf(filter: TeamChatFilter): string {
  if (filter.kind === 'teams') return filter.headRefs.map((ref) => `team=${encodeURIComponent(ref)}`).join('&');
  if (filter.kind === 'untagged') return `team=${UNTAGGED_PARAM}`;
  return '';
}

/**
 * Identity for stale-response guards: what a response was read UNDER. The
 * selection is a set, so the key is order-insensitive — `[b, a]` and `[a, b]`
 * are one filter — and adding or removing any member changes it.
 */
export function filterKeyOf(filter: TeamChatFilter): string {
  if (filter.kind === 'teams') return `teams:${[...filter.headRefs].sort().join('+')}`;
  if (filter.kind === 'untagged') return 'untagged';
  return 'all';
}

/**
 * The page URL carrying a filter: `team` set (once per head) or removed, every
 * other parameter (`tab`, `chat`, `view`, worklog filters) kept. The filter is
 * URL state of ONE App's page, so another App's page never inherits it.
 */
export function withTeamFilter(url: URL, filter: TeamChatFilter): URL {
  const next = new URL(url);
  next.searchParams.delete('team');
  if (filter.kind === 'teams') for (const ref of filter.headRefs) next.searchParams.append('team', ref);
  else if (filter.kind === 'untagged') next.searchParams.set('team', UNTAGGED_PARAM);
  return next;
}

/** The isolated poll/paging endpoint URL, carrying the cursor and the filter. */
export function teamChatReadUrl(
  appId: string,
  cursor: { sinceSeq?: number; beforeSeq?: number },
  filter: TeamChatFilter,
): string {
  const params = new URLSearchParams();
  if (cursor.sinceSeq !== undefined) params.set('sinceSeq', String(cursor.sinceSeq));
  if (cursor.beforeSeq !== undefined) params.set('beforeSeq', String(cursor.beforeSeq));
  if (filter.kind === 'teams') for (const ref of filter.headRefs) params.append('team', ref);
  else if (filter.kind === 'untagged') params.set('team', UNTAGGED_PARAM);
  const qs = params.toString();
  return `/app/apps/${appId}/team-chat${qs ? `?${qs}` : ''}`;
}
