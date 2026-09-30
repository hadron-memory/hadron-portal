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
 *
 * ## And why one reload is not proof
 *
 * An earlier version ended "If it does not, nothing changed." @codex (P1 on
 * #884) pointed out the race that makes that false: the connection can fail
 * while the mutation is still running, so a reload taken immediately shows
 * plaintext and the write lands afterwards. The sentence would then be telling
 * the user it is safe to discard the only key to a memory that is about to be
 * encrypted with it — our message causing the loss, again, in the one direction
 * that cannot be undone.
 *
 * So: never assert the negative. Say the outcome is unknown, that a plaintext
 * reading may simply be early, and that the key must be kept until there is a
 * definite answer. The cost of over-caution here is a retained passphrase; the
 * cost of under-caution is the content.
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
      'The connection failed before we heard back, so we cannot tell you whether the encryption completed. Keep the key you entered. Reload this page: if it says this memory is encrypted, it worked and that key is the key. If it still says plaintext, the request may simply not have finished yet — re-check in a minute, and do not discard the key until you have a definite answer.',
    ),

  /** A definite failure — the server answered and refused. */
  failed: (): string => t('memory.encrypt.failed', 'Failed to encrypt this memory'),
};
