/**
 * portal#2098 — the App agent chat list's per-row actions. The visible words
 * stay short; the accessible names carry the chat's title so a screen reader
 * can tell two rows' actions apart. IDs live under `agent-chat.row.*`.
 */

import { t } from './t';

/**
 * The locale the shipped copy is written in. Plural forms are chosen by its
 * CLDR rules, not by `n === 1`: French puts 0 in `one`, Russian puts 21 in
 * `one` and 3 in `few` (#2110 BLIND). When a locale ships, this follows it.
 */
const COPY_LOCALE = 'en';

/**
 * The count in `locale`'s CLDR plural category. Ids are
 * `agent-chat.row.messages-<category>`: `-one` and `-other` carry English
 * defaults; `-zero`, `-two`, `-few` and `-many` exist for locales that need
 * them; an untranslated category falls back to the English form for n.
 */
export function messagesIn(locale: string, n: number): string {
  const category = new Intl.PluralRules(locale).select(n);
  // The untranslated fallback is English, so English rules pick its form:
  // a Russian 21 is `one` there but "21 msgs" here (#2110 BLIND delta).
  const english = new Intl.PluralRules(COPY_LOCALE).select(n) === 'one' ? '{n} msg' : '{n} msgs';
  return t(`agent-chat.row.messages-${category}`, english, { n: String(n) });
}

export const agentChatRowStrings = {
  /** Visible label of the Rename action. */
  renameShort: (): string => t('agent-chat.row.rename-short', 'rename'),
  /** Visible label of the Delete action. */
  deleteShort: (): string => t('agent-chat.row.delete-short', 'delete'),
  /** Accessible name of the Rename action. */
  rename: (title: string): string => t('agent-chat.row.rename', 'Rename chat {title}', { title }),
  /** Accessible name of the Delete action. */
  delete: (title: string): string => t('agent-chat.row.delete', 'Delete chat {title}', { title }),
  /** Accessible name of the inline rename field. */
  renameInput: (title: string): string => t('agent-chat.row.rename-input', 'New title for chat {title}', { title }),
  /** The row's message count, in the plural form CLDR picks for the copy's locale (portal#2104). */
  messages: (n: number): string => messagesIn(COPY_LOCALE, n),
  /** Between the count and the time on the row's meta line. */
  separator: (): string => t('agent-chat.row.meta-separator', '·'),
};
