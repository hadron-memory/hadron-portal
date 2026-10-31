// The team-chat team filter (#1137).
//
// A viewer filters the App's team chat to ONE team head, or to the messages
// that carry no stored team tag. Both are SERVER-SIDE reads on
// `teamChatMessages` (`teamHeadRef` / `untagged`, mutually exclusive): the
// portal never filters a loaded page, never reads a body for `@team`, and never
// computes a team. A person has no team, so there is no "my team" default.
//
// The identity is the head's stable ID. A tag's `label` is a post-time display
// snapshot and can collide or go stale, so nothing here is keyed on one.

export type TeamChatFilter =
  | { kind: 'none' }
  | { kind: 'team'; headRef: string }
  | { kind: 'untagged' };

export const NO_TEAM_FILTER: TeamChatFilter = { kind: 'none' };

/** The `?team=` value that selects the untagged view. A head id never spells it. */
export const UNTAGGED_PARAM = 'untagged';

// Ids are opaque to the portal; this only keeps a hostile or mangled value out
// of a URL and a GraphQL variable. The server's typed refusal stays the
// authority on whether a well-formed id is a usable head.
const HEAD_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Read `?team=`. A malformed value is `{ ok: false }`, never the unfiltered
 * thread: falling back would show a reader MORE than they asked for under a
 * filter they believe is applied.
 */
export function parseTeamParam(raw: string | null): { ok: true; filter: TeamChatFilter } | { ok: false } {
  if (raw === null) return { ok: true, filter: NO_TEAM_FILTER };
  if (raw === UNTAGGED_PARAM) return { ok: true, filter: { kind: 'untagged' } };
  if (!HEAD_REF_PATTERN.test(raw)) return { ok: false };
  return { ok: true, filter: { kind: 'team', headRef: raw } };
}

/** The GraphQL variables for a filter: exactly one of the pair, or neither. */
export function filterVariablesOf(filter: TeamChatFilter): { teamHeadRef?: string; untagged?: true } {
  if (filter.kind === 'team') return { teamHeadRef: filter.headRef };
  if (filter.kind === 'untagged') return { untagged: true };
  return {};
}

/** The query-string fragment (no leading `?`/`&`) that carries a filter, or ''. */
export function filterQueryOf(filter: TeamChatFilter): string {
  if (filter.kind === 'team') return `team=${encodeURIComponent(filter.headRef)}`;
  if (filter.kind === 'untagged') return `team=${UNTAGGED_PARAM}`;
  return '';
}

/** Identity for stale-response guards: what a response was read UNDER. */
export function filterKeyOf(filter: TeamChatFilter): string {
  if (filter.kind === 'team') return `team:${filter.headRef}`;
  if (filter.kind === 'untagged') return 'untagged';
  return 'all';
}

/**
 * The page URL carrying a filter: `team` set or removed, every other parameter
 * (`tab`, `chat`, `view`, worklog filters) kept. The filter is URL state of ONE
 * App's page, so another App's page never inherits it.
 */
export function withTeamFilter(url: URL, filter: TeamChatFilter): URL {
  const next = new URL(url);
  next.searchParams.delete('team');
  if (filter.kind === 'team') next.searchParams.set('team', filter.headRef);
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
  if (filter.kind === 'team') params.set('team', filter.headRef);
  else if (filter.kind === 'untagged') params.set('team', UNTAGGED_PARAM);
  const qs = params.toString();
  return `/app/apps/${appId}/team-chat${qs ? `?${qs}` : ''}`;
}
