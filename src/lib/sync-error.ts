/**
 * #988 — why a Git sync or push failed, in words that are safe to show.
 *
 * The server's failure text (`Memory.syncError`, and the `syncMemory` /
 * `pushMemoryToGit` error messages) is the RAW git error. It can carry
 * credentials: Node's execFile puts the whole argv in its message, and the
 * argv holds the tokenized remote URL (hadron-server#1578, team chat #5968).
 *
 * A redaction blacklist cannot make that text safe. A credential can also
 * sit in a query string (`?access_token=…`), an `Authorization: Bearer …`
 * argument, or a non-GitHub stored token, in shapes no list anticipates
 * (Codex P1 on #989). So this is an ALLOWLIST: a few failures git reports in
 * recognisable words map to fixed product copy, and anything else gets
 * generic copy. **No server text is ever returned for display.**
 */
import { t } from '$lib/i18n/t';

/** The server's one-time review hold (hadron-server#1576). */
export const REVIEW_REQUIRED_CODE = 'GIT_SYNC_REVIEW_REQUIRED';

export type GitFailure =
  | 'review-required'
  | 'branch-not-found'
  | 'repo-not-found'
  | 'auth-failed'
  | 'push-rejected'
  | 'network'
  | 'unknown';

/**
 * Recognise a failure from the server's text. Only the KIND leaves this
 * function, never any part of the text. Checked most-specific first: a
 * 403/404 also reads "unable to access", which on its own means network.
 */
export function classifyGitFailure(text: string | null | undefined): GitFailure {
  const s = text?.trim() ?? '';
  if (!s) return 'unknown';
  if (s.startsWith(REVIEW_REQUIRED_CODE)) return 'review-required';
  if (/\[rejected\]|non-fast-forward|updates were rejected|failed to push some refs/i.test(s)) return 'push-rejected';
  if (/remote branch \S+ not found|couldn'?t find remote ref|pathspec .* did not match|invalid reference/i.test(s)) return 'branch-not-found';
  if (/authentication failed|could not read (username|password)|permission to \S+ denied|invalid username or password|returned error: 403|terminal prompts disabled/i.test(s)) return 'auth-failed';
  if (/repository .*not found|does not appear to be a git repository|returned error: 404/i.test(s)) return 'repo-not-found';
  if (/could not resolve host|connection (timed out|refused|reset)|failed to connect|operation timed out|unable to access/i.test(s)) return 'network';
  return 'unknown';
}

/** Fixed, translatable copy for a failure. `op` picks the verb for the generic and push-only cases. */
export function gitFailureText(kind: GitFailure, op: 'sync' | 'push'): string {
  switch (kind) {
    case 'review-required':
      // hadron-server#1576: the hold aborts the whole sync, and the ONLY release
      // is an explicit Read branch, which authorizes the cleanup that deletes
      // the held nodes. So the copy must lead with keeping them (Ada #6000).
      return t('sync-error.review-required', 'This sync was held for review: some nodes this memory took from its repository have no matching file on the repository’s default branch, so the sync stopped and changed nothing. To continue, set the memory’s Read branch in Integrations. The next sync then deletes any nodes whose files aren’t on that branch, so export what you want to keep first.');
    case 'branch-not-found':
      return t('sync-error.branch-not-found', 'The branch this memory uses doesn’t exist in its repository. Check the Read and Write branches in Integrations.');
    case 'repo-not-found':
      return t('sync-error.repo-not-found', 'The repository wasn’t found. It may have been renamed or deleted, or Hadron may no longer have access to it.');
    case 'auth-failed':
      return t('sync-error.auth-failed', 'Hadron couldn’t sign in to the repository. Its access to the repository may have been removed or expired.');
    case 'push-rejected':
      return t('sync-error.push-rejected', 'The push was rejected because the branch has changes this memory doesn’t have yet. Sync from Git first, then push again.');
    case 'network':
      return t('sync-error.network', 'Hadron couldn’t reach the repository. Try again shortly.');
    default:
      return op === 'push'
        ? t('sync-error.push-unknown', 'Push to Git failed. The details aren’t shown here because they can contain credentials; an administrator can find them in the server logs.')
        : t('sync-error.sync-unknown', 'The last sync failed. The details aren’t shown here because they can contain credentials; an administrator can find them in the server logs.');
  }
}

/** Safe copy for a failure's raw server text. The text is classified, never echoed. */
export function gitFailureMessage(text: string | null | undefined, op: 'sync' | 'push'): string {
  return gitFailureText(classifyGitFailure(text), op);
}
