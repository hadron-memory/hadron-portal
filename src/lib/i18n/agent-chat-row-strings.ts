/**
 * portal#2098 — the App agent chat list's per-row actions. The visible words
 * stay short; the accessible names carry the chat's title so a screen reader
 * can tell two rows' actions apart. IDs live under `agent-chat.row.*`.
 */

import { t } from './t';

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
  /** The row's message count, one form for 1 and one for every other count (portal#2104). */
  messages: (n: number): string =>
    n === 1
      ? t('agent-chat.row.messages-one', '{n} msg', { n: String(n) })
      : t('agent-chat.row.messages-other', '{n} msgs', { n: String(n) }),
  /** Between the count and the time on the row's meta line. */
  separator: (): string => t('agent-chat.row.meta-separator', '·'),
};
