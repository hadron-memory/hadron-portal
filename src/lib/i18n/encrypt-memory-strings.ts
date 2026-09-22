/**
 * #873 / spec 041 — i18n strings for memory encryption.
 *
 * Pattern matches `delete-memory-strings.ts` (spec 013) and
 * `create-node-strings.ts` (spec 011): user-visible strings route through
 * `t(id, defaultText)`.
 *
 * ## Why these two live here rather than at their call sites
 *
 * `outcomeUnknown` is rendered from **both sides of the wire**, because the
 * ambiguity it describes can arise on either network hop (#884):
 *
 * - **browser → portal** — the enhanced POST dies after the action ran, caught
 *   in the component's `onError`
 * - **portal → GraphQL** — the mutation commits and its response is lost,
 *   caught in the server action
 *
 * Both leave the same question unanswered, so they must give the same answer.
 * Two copies of a sentence this careful would drift, and the drift would be
 * invisible: each path is reached only by a failure nobody reproduces on
 * purpose.
 *
 * ## Why it says "we cannot tell you" and not "it failed"
 *
 * Because we do not know, and on a one-way operation the confident wrong
 * answer is the expensive one. A user told "it failed" may discard the
 * passphrase to a memory that is now encrypted with it — unrecoverable, and
 * caused by our message rather than by the fault. Telling them how to find out
 * is the only honest move.
 */

import { t } from './t';

export const encryptMemoryStrings = {
  /**
   * The outcome is genuinely unknown: the request was sent, the answer was
   * lost. Names the one action that resolves it.
   */
  outcomeUnknown: (): string =>
    t(
      'memory.encrypt.outcome-unknown',
      'The connection failed before we heard back, so we cannot tell you whether the encryption completed. Reload this page: if it now says this memory is encrypted, it worked and the key you entered is the key. If it does not, nothing changed.',
    ),

  /** A definite failure — the server answered and refused. */
  failed: (): string => t('memory.encrypt.failed', 'Failed to encrypt this memory'),
};
