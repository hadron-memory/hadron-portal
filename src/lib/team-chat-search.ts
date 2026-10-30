// Team-chat history search (#1013, server#2299): the shapes and the pure rules
// shared by the endpoint and the panel. Kept free of `$lib/server` so the client
// can import it.

/** The search contract's query bounds, in code points, untrimmed (server#2882). */
export const TEAM_CHAT_SEARCH_MIN = 2;
export const TEAM_CHAT_SEARCH_MAX = 200;

/** The typed refusals the panel renders distinctly. Anything else is `FAILED`. */
export const TEAM_CHAT_SEARCH_REFUSALS = [
  'TEAM_CHAT_SEARCH_QUERY_LENGTH',
  'TEAM_CHAT_SEARCH_CURSOR_INVALID',
  'TEAM_CHAT_SEARCH_ENCRYPTED',
  'CHANNEL_NOT_FOUND',
  'CHANNEL_INCARNATION_CHANGED',
] as const;
export type TeamChatSearchRefusal = (typeof TEAM_CHAT_SEARCH_REFUSALS)[number] | 'FAILED';

export interface TeamChatSearchHit {
  nodeId: string;
  /** The server's canonical message URN; null when it would not resolve. */
  urn: string | null;
  seq: number;
  channelId: string;
  channelIncarnation: number;
  /** The hit's message text via the read path; null when it could not be read. */
  body: string | null;
  at: string | null;
  authorName: string | null;
}

export interface TeamChatSearchPageResult {
  ok: true;
  items: TeamChatSearchHit[];
  /** True only when the search reached the start of the history. */
  complete: boolean;
  cursor: string | null;
  channelId: string | null;
  channelIncarnation: number | null;
}

export interface TeamChatSearchFailure {
  ok: false;
  code: TeamChatSearchRefusal;
}

export type TeamChatSearchResponse = TeamChatSearchPageResult | TeamChatSearchFailure;

/** Whether `query` is within the contract's bounds, counted in code points. */
export function isSearchableQuery(query: string): boolean {
  const n = [...query].length;
  return n >= TEAM_CHAT_SEARCH_MIN && n <= TEAM_CHAT_SEARCH_MAX;
}

/**
 * What a page of results means for the reader. Empty-and-complete is the only
 * "no matches"; empty-and-incomplete is the scan bound firing before any match,
 * which must offer to continue rather than say nothing was found.
 */
export type SearchOutcome = 'matches' | 'no-matches' | 'scan-limit' | 'more';

export function outcomeOf(items: readonly unknown[], complete: boolean, cursor: string | null): SearchOutcome {
  if (items.length === 0) return complete ? 'no-matches' : 'scan-limit';
  return !complete && cursor ? 'more' : 'matches';
}
