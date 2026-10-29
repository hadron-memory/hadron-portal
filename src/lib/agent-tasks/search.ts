import { t } from '$lib/i18n/t';
import type { BoardFilter } from './status';

/**
 * portal#1400 — the board's text search.
 *
 * The server matches a case-insensitive substring of a task's title or
 * description, and refuses text outside 1 to 200 characters after trimming
 * with BAD_USER_INPUT. "Characters" there is the JS string length, so an
 * astral character (an emoji) counts two. The portal measures nothing and
 * truncates nothing: what a person typed goes to the server as typed, so the
 * server's word is the only one on what is too long.
 */
export const BOARD_TEXT_MAX = 200;

/** The URL's `text`, trimmed. Blank or absent is `''`, which sends no text at all. */
export function parseBoardText(raw: string | null): string {
  return (raw ?? '').trim();
}

/** The board's own URL for a status filter and a search; the defaults are omitted. */
export function boardHref(basePath: string, filter: BoardFilter, text: string): string {
  const params: string[] = [];
  if (filter !== 'active') params.push(`status=${filter}`);
  // encodeURIComponent, not URLSearchParams: a space is %20, and `%`, `_` and `\` stay literal on the way back.
  if (text !== '') params.push(`text=${encodeURIComponent(text)}`);
  return params.length === 0 ? basePath : `${basePath}?${params.join('&')}`;
}

export function boardTextGuidance(): string {
  return t('app.tasks.search.too-long', 'Search text is 1 to 200 characters. Shorten it and search again.');
}

/** An empty result while a search is active names the search; it is not the filter's empty state. */
export function boardNoMatchText(text: string): string {
  return t('app.tasks.search.no-match', 'No tasks match “{text}”.', { text });
}

export function boardShownText(n: number): string {
  return n === 1
    ? t('app.tasks.shown.one', '1 task shown')
    : t('app.tasks.shown.other', '{n} tasks shown', { n });
}
