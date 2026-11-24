/**
 * Spec 017 — i18n strings for the chat scope picker, badges, and
 * scope-related errors.
 *
 * Pattern matches `delete-memory-strings.ts` (spec 013) and
 * `create-node-strings.ts` (spec 011): user-visible strings route
 * through `t(id, defaultText)` per Constitution Principle III.
 *
 * IDs are stable under the namespace `chat-scope.*`.
 */

import { t } from './t';

export const chatScopeStrings = {
  /** Composer-header segmented control: the Private option. */
  pickerPrivate: (): string => t('chat-scope.picker.private', 'Private'),

  /**
   * Composer-header segmented control: the Shared option, with a
   * group label sourced from the Agent's installation policy when
   * available. `t()` interpolates since #817 — pass vars rather than
   * chaining `.replace`, which expands `$&` and friends out of a group
   * label the installation policy supplied.
   */
  pickerShared: (group: string): string =>
    t('chat-scope.picker.shared', 'Shared with {group}', { group }),

  /** Composer-header segmented control: Shared option fallback label. */
  pickerSharedFallback: (): string =>
    t('chat-scope.picker.shared-fallback', 'Shared with App members'),

  /** New chat menu: save the chat into the App's shared memory. */
  newChatShared: (): string => t('chat-scope.new-chat.shared', 'Save to the shared app memory'),

  /** New chat menu: save the chat into the user's own private memory. */
  newChatPrivate: (): string => t('chat-scope.new-chat.private', 'Save to my private memory'),

  /** Tooltip / help under the Private option. */
  pickerHelpPrivate: (): string =>
    t('chat-scope.picker.help.private', 'Only you can see this chat.'),

  /** Tooltip / help under the Shared option. */
  pickerHelpShared: (): string =>
    t(
      'chat-scope.picker.help.shared',
      'Everyone in this App will see this chat.',
    ),

  /** Chat-list / active-chat-header badge: Private. */
  badgePrivate: (): string => t('chat-scope.badge.private', 'Private'),

  /** Chat-list / active-chat-header badge: Shared. */
  badgeShared: (): string => t('chat-scope.badge.shared', 'Shared'),

  /** Error heading when shared chat is requested without an App context. */
  errorNoAppContextTitle: (): string =>
    t(
      'chat-scope.error.no-app-context.title',
      "Can't share — no App context",
    ),

  /** Error body when shared chat is requested without an App context. */
  errorNoAppContextBody: (): string =>
    t(
      'chat-scope.error.no-app-context.body',
      "You're not a member of any App that installs this Agent. Sharing a chat needs an App to share within.",
    ),

  /**
   * Surfaced when an MCP App-key session attempts to start a shared
   * chat. Practically unreachable via the portal (`/api/agent-chat/start`
   * is JWT-only) but kept for defense-in-depth so the user sees a
   * typed message instead of a generic 500.
   */
  errorAppSessionShared: (): string =>
    t(
      'chat-scope.error.app-session-shared',
      "Shared chats aren't available from this connection. Open the chat from a signed-in browser session.",
    ),

  /**
   * Generic in-chat error surfaced when a tool tries to read a
   * memory outside the chat's allowed read-set (per FR-014).
   * Deliberately does NOT name the offending memory.
   */
  errorToolOutOfScope: (): string =>
    t(
      'chat-scope.error.tool-out-of-scope',
      "This tool can't run inside a shared chat.",
    ),

  /** Delete-confirmation body for a PRIVATE chat. */
  deleteConfirmPrivate: (): string =>
    t(
      'chat-scope.delete-confirm.private',
      "This will remove the chat and all its messages from your personal memory. This can't be undone.",
    ),

  /** Delete-confirmation body for a SHARED chat. Note: other App
   *  members will lose access too — name it. */
  deleteConfirmShared: (): string =>
    t(
      'chat-scope.delete-confirm.shared',
      "This will remove the shared chat and all its messages from the App's shared memory. Other App members will lose access too. This can't be undone.",
    ),
};
