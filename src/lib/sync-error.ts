/**
 * #988 — why a Git-synced memory's sync failed, made safe to show.
 *
 * `Memory.syncError` (and the `syncMemory` error message) carry the RAW git
 * error. A failed clone's message can include the tokenized remote URL
 * (`https://x-access-token:<installation token>@github.com/…`): Node's
 * execFile puts the whole argv in its error. That was reported as a server
 * bug (team chat #5968/#5969). Whatever the server does, the portal never
 * renders this text unredacted: defence in depth for a credential.
 */

const REDACTED = '***';

/**
 * Strip credentials from free text before it is shown:
 * - userinfo in any URL (`scheme://user:secret@host` → `scheme://***@host`);
 * - a bare `x-access-token:<value>`;
 * - GitHub token shapes (`ghs_`, `ghp_`, `gho_`, `ghu_`, `ghr_`, `github_pat_`).
 */
export function redactCredentials(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/x-access-token:[^\s@/]+/gi, `x-access-token:${REDACTED}`)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g, REDACTED);
}

/** The server's one-time review hold (hadron-server#1576), a typed reason with its own copy. */
export const REVIEW_REQUIRED_CODE = 'GIT_SYNC_REVIEW_REQUIRED';

export type SyncErrorView =
  | { kind: 'review-required' }
  | { kind: 'other'; detail: string | null };

/**
 * Classify a stored sync error. A known typed reason is named by its code
 * prefix (`GIT_SYNC_REVIEW_REQUIRED: …`) and gets product copy, never the
 * server's prose; anything else is shown only redacted.
 */
export function syncErrorView(syncError: string | null | undefined): SyncErrorView {
  const text = syncError?.trim() ?? '';
  if (text.startsWith(REVIEW_REQUIRED_CODE)) return { kind: 'review-required' };
  return { kind: 'other', detail: text ? redactCredentials(text) : null };
}
