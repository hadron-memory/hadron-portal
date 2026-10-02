/**
 * #992 — "Approve all" for a memory (hadron-server#1591 `approveMemoryNodes`):
 * what the result and the refusals say. Pure: no fetching, no DOM.
 *
 * The server approves the current revision of every live, UNMINTED node that
 * isn't approved yet, in one transaction, and skips reserved placeholders
 * (they have no spec to approve). Refusals map to fixed copy by code; the
 * server's prose is never shown.
 */
import { t } from '$lib/i18n/t';

export interface ApproveMemoryNodesResult {
  approvedCount: number;
  alreadyApprovedCount: number;
  skippedPlaceholders: string[];
}

/** One line summarising a completed Approve all. */
export function approveAllSummary(r: ApproveMemoryNodesResult): string {
  const parts = [
    r.approvedCount === 1
      ? t('memory.approve-all.approved-one', 'Approved 1 node.')
      : t('memory.approve-all.approved-many', 'Approved {n} nodes.', { n: r.approvedCount }),
  ];
  if (r.alreadyApprovedCount > 0) {
    parts.push(t('memory.approve-all.already', '{n} were already approved.', { n: r.alreadyApprovedCount }));
  }
  if (r.skippedPlaceholders.length > 0) {
    parts.push(t('memory.approve-all.skipped', 'Skipped {n} placeholders, which have no spec to approve yet:', { n: r.skippedPlaceholders.length }));
  }
  return parts.join(' ');
}

/** The HTTP status and fixed copy for an approveMemoryNodes failure. */
export function approveAllFailure(code: string | null | undefined): { status: 403 | 404 | 423 | 500; text: string } {
  switch (code) {
    case 'FORBIDDEN':
      return { status: 403, text: t('memory.approve-all.refused.forbidden', "You don't have permission to approve nodes in this memory.") };
    case 'NOT_FOUND':
    case 'MEMORY_NOT_FOUND':
      return { status: 404, text: t('memory.approve-all.refused.not-found', 'This memory no longer exists, or you no longer have access to it.') };
    // #1592 answers this when an ENCRYPTED memory's key isn't held for the
    // session (approving hashes the plaintext), not for an expired sign-in.
    case 'SESSION_EXPIRED':
      return { status: 423, text: t('memory.approve-all.refused.key-unavailable', "This memory is encrypted and its key isn't available to your session right now, so nothing was approved.") };
    default:
      return { status: 500, text: t('memory.approve-all.refused.unknown', "Approve all didn't go through, and nothing was approved. Try again.") };
  }
}
