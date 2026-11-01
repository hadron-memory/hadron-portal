/** #1013 — team-chat history search. IDs live under `team-chat-search.*`. */
import { t } from './t';
import type { TeamChatSearchRefusal } from '$lib/team-chat-search';

export const teamChatSearchStrings = {
  toggle: () => t('team-chat-search.toggle', 'Search'),
  back: () => t('team-chat-search.back', 'Back to chat'),
  heading: () => t('team-chat-search.heading', 'Search chat history'),
  scope: () => t('team-chat-search.scope', 'Searches this team chat’s full history, newest first. Results do not mark anything as read.'),
  label: () => t('team-chat-search.label', 'Search messages'),
  placeholder: () => t('team-chat-search.placeholder', 'Text to find (2–200 characters)'),
  submit: () => t('team-chat-search.submit', 'Search'),
  searching: () => t('team-chat-search.searching', 'Searching…'),
  tooShort: () => t('team-chat-search.too-short', 'Enter 2 to 200 characters.'),
  noMatches: (q: string) => t('team-chat-search.no-matches', 'No messages match “{q}”. The whole history was searched.', { q }),
  scanLimit: () =>
    t('team-chat-search.scan-limit', 'No match in the most recent messages searched so far. This is not “no matches”: the search stopped at its scan limit.'),
  incomplete: () => t('team-chat-search.incomplete', 'More history remains to be searched.'),
  continueSearch: () => t('team-chat-search.continue', 'Continue searching'),
  loadMore: () => t('team-chat-search.load-more', 'Load more matches'),
  loadedMore: (n: number) =>
    n === 1
      ? t('team-chat-search.loaded-more-one', '{n} more match loaded', { n: String(n) })
      : t('team-chat-search.loaded-more-many', '{n} more matches loaded', { n: String(n) }),
  searchAgain: () => t('team-chat-search.search-again', 'Search again'),
  retry: () => t('team-chat-search.retry', 'Retry'),
  laterFailed: () => t('team-chat-search.later-failed', 'Could not load the next page. The matches below are kept.'),
  unavailable: () => t('team-chat-search.unavailable', 'Message text unavailable'),
  colWhen: () => t('team-chat-search.col.when', 'When'),
  colAuthor: () => t('team-chat-search.col.author', 'Author'),
  colMessage: () => t('team-chat-search.col.message', 'Message'),
  colUrn: () => t('team-chat-search.col.urn', 'Message URN'),
  noLink: () => t('team-chat-search.no-link', 'No link available'),
  refusal: (code: TeamChatSearchRefusal): string => {
    switch (code) {
      case 'TEAM_CHAT_SEARCH_QUERY_LENGTH':
        return t('team-chat-search.refusal.length', 'The search text must be 2 to 200 characters.');
      case 'TEAM_CHAT_SEARCH_CURSOR_INVALID':
        return t('team-chat-search.refusal.cursor', 'This search can no longer be continued. Search again.');
      case 'TEAM_CHAT_SEARCH_ENCRYPTED':
        return t('team-chat-search.refusal.encrypted', 'This chat is stored encrypted and cannot be searched.');
      case 'CHANNEL_NOT_FOUND':
        return t('team-chat-search.refusal.not-found', 'This chat is not available to you.');
      case 'CHANNEL_INCARNATION_CHANGED':
        return t('team-chat-search.refusal.incarnation', 'The chat was replaced while searching. Search again.');
      default:
        return t('team-chat-search.refusal.failed', 'The search failed. Try again.');
    }
  },
};
