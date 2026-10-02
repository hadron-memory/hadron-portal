/**
 * #992 — node approvals (hadron-server#1591 PR 1), turned into what the
 * portal renders. Pure: no fetching, no DOM.
 *
 * - An approval belongs to ONE revision. A node edited since its approval is
 *   SUPERSEDED: the old approval still exists, but it vouches for text the
 *   page no longer shows.
 * - Approve sends the revision the reader saw, so an edit landing in between
 *   is refused (REVISION_MISMATCH) instead of approving unread text.
 * - Every refusal and verify outcome maps to FIXED copy keyed by its code. The
 *   server's prose is never shown (the same rule as `$lib/sync-error`).
 */
import { t } from '$lib/i18n/t';
import type { ProvenanceResult } from '$lib/node-provenance';

export type NodeApprovalState = 'NOT_APPROVED' | 'APPROVED' | 'SUPERSEDED';

export interface NodeApproval {
  revision: number;
  approvedAt: string;
  approvedBy: { handle: string | null; urn: string | null } | null;
  /** Set instead of `approvedBy` when the approver was not a user (e.g. an App key). */
  approvedByInfo: string | null;
  hash: string;
}

export interface NodeApprovalStatus {
  state: NodeApprovalState;
  approval: NodeApproval | null;
}

/** What NODE_APPROVAL_QUERY returns: the status plus the revision it describes. */
export interface NodeApprovalRead {
  id: string;
  revision: number;
  approvalStatus: NodeApprovalStatus;
}

/**
 * Accept an approval read only when it describes the revision the page
 * rendered. It runs after the node read, so a concurrent edit can land in
 * between, and an "Approved" beside older text would be a false claim.
 */
export function bindApprovalToRevision(
  read: NodeApprovalRead | null | undefined,
  shownRevision: number | null | undefined,
): ProvenanceResult<NodeApprovalStatus> {
  if (!read?.approvalStatus) return { ok: false };
  if (shownRevision == null || read.revision !== shownRevision) return { ok: false, changed: true };
  return { ok: true, value: read.approvalStatus };
}

export type ApprovalTone = 'approved' | 'attention' | 'neutral';

export interface ApprovalView {
  state: NodeApprovalState | 'UNAVAILABLE' | 'CHANGED';
  tone: ApprovalTone;
  approval: NodeApproval | null;
  /** True when Approve is worth offering: the shown revision isn't approved yet. */
  canApprove: boolean;
}

const KNOWN: readonly NodeApprovalState[] = ['NOT_APPROVED', 'APPROVED', 'SUPERSEDED'];

export function approvalView(result: ProvenanceResult<NodeApprovalStatus | null | undefined>): ApprovalView {
  if (!result.ok) {
    return { state: result.changed ? 'CHANGED' : 'UNAVAILABLE', tone: 'neutral', approval: null, canApprove: false };
  }
  const status = result.value;
  if (!status || !KNOWN.includes(status.state)) {
    return { state: 'UNAVAILABLE', tone: 'neutral', approval: null, canApprove: false };
  }
  const approval = status.state === 'NOT_APPROVED' ? null : status.approval;
  return {
    state: status.state,
    tone: status.state === 'APPROVED' ? 'approved' : status.state === 'SUPERSEDED' ? 'attention' : 'neutral',
    approval,
    canApprove: status.state !== 'APPROVED',
  };
}

export function approvalText(view: ApprovalView): string {
  switch (view.state) {
    case 'APPROVED':
      return t('node.approval.approved', 'Approved');
    case 'SUPERSEDED':
      return t('node.approval.superseded', 'Changed since approval');
    case 'NOT_APPROVED':
      return t('node.approval.not-approved', 'Not approved');
    case 'CHANGED':
      return t('node.approval.changed', 'Approval status changed; reload to see it');
    default:
      return t('node.approval.unavailable', "Approval status couldn't load");
  }
}

/** Who approved, as a reader should see it. Null when the server didn't say. */
export function approverLabel(a: NodeApproval | null | undefined): string | null {
  if (!a) return null;
  const handle = a.approvedBy?.handle?.trim();
  if (handle) return `@${handle}`;
  const info = a.approvedByInfo?.trim();
  return info || null;
}

/** A content hash shortened for display; the full value goes in a title. */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '';
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

/**
 * The HTTP status for a refusal code. Only codes this module has copy for get
 * a 4xx; anything else is a failure, not a refusal (Gene on #993).
 */
export function approvalRefusalStatus(code: string | null | undefined): 403 | 404 | 409 | 423 | 500 {
  switch (code) {
    case 'FORBIDDEN':
      return 403;
    case 'NODE_NOT_FOUND':
    case 'NOT_FOUND':
      return 404;
    case 'REVISION_MISMATCH':
    case 'NODE_IS_PLACEHOLDER':
      return 409;
    case 'SESSION_EXPIRED':
      return 423;
    default:
      return 500;
  }
}

/** Fixed copy for an approveNode refusal, keyed by its GraphQL error code. */
export function approveRefusalText(code: string | null | undefined): string {
  switch (code) {
    case 'FORBIDDEN':
      return t('node.approval.refused.forbidden', "You don't have permission to approve nodes in this memory.");
    case 'REVISION_MISMATCH':
      return t('node.approval.refused.revision-mismatch', 'This node changed after you opened it, so nothing was approved. Review the current revision, then approve it.');
    case 'NODE_IS_PLACEHOLDER':
      return t('node.approval.refused.placeholder', 'This node is a reserved placeholder. It has no spec to approve yet.');
    // Not an expired sign-in: #1592 answers this when an ENCRYPTED memory's
    // key isn't held for this session, and approving has to hash the plaintext.
    case 'SESSION_EXPIRED':
      return t('node.approval.refused.key-unavailable', "This memory is encrypted and its key isn't available to your session right now, so nothing was approved.");
    case 'NODE_NOT_FOUND':
    case 'NOT_FOUND':
      return t('node.approval.refused.not-found', 'This node no longer exists, or you no longer have access to it.');
    default:
      return t('node.approval.refused.unknown', "The approval didn't go through. Try again.");
  }
}

export type IntegrityState = 'INTACT' | 'TAMPERED' | 'SUPERSEDED' | 'NOT_APPROVED';

export interface NodeIntegrityCheck {
  state: IntegrityState;
  revision: number;
  approvedRevision: number | null;
  expectedHash: string | null;
  actualHash: string | null;
}

/**
 * The verify verdict as fixed copy, and whether it is a problem. Only
 * TAMPERED is: the approved revision's text no longer matches the hash
 * recorded when it was approved, so it changed without a new revision.
 */
export function integrityText(check: Pick<NodeIntegrityCheck, 'state' | 'revision' | 'approvedRevision'>): { text: string; problem: boolean } {
  switch (check.state) {
    case 'INTACT':
      return { text: t('node.approval.verify.intact', 'Verified: revision {rev} matches what was approved.', { rev: check.revision }), problem: false };
    case 'TAMPERED':
      return { text: t('node.approval.verify.tampered', "Verification failed: the approved text of revision {rev} has changed since it was approved. Treat this node's content as unverified.", { rev: check.approvedRevision ?? check.revision }), problem: true };
    case 'SUPERSEDED':
      return { text: t('node.approval.verify.superseded', 'Revision {approved} was approved, but the node has changed since (now revision {rev}). The current revision is not approved.', { approved: check.approvedRevision ?? '?', rev: check.revision }), problem: false };
    case 'NOT_APPROVED':
      return { text: t('node.approval.verify.not-approved', 'Nothing to verify: this node has never been approved.'), problem: false };
    default:
      return { text: t('node.approval.verify.unknown', "Verification returned a result this page doesn't recognise."), problem: true };
  }
}

/** Fixed copy for a verifyNode failure (not a verdict: the check didn't run). */
export function verifyFailureText(code: string | null | undefined): string {
  switch (code) {
    case 'FORBIDDEN':
      return t('node.approval.verify-refused.forbidden', "You don't have permission to verify this node.");
    case 'SESSION_EXPIRED':
      return t('node.approval.verify-refused.key-unavailable', "This memory is encrypted and its key isn't available to your session right now, so it couldn't be verified.");
    case 'NODE_NOT_FOUND':
    case 'NOT_FOUND':
      return t('node.approval.verify-refused.not-found', 'This node no longer exists, or you no longer have access to it.');
    default:
      return t('node.approval.verify-refused.unknown', "Verification didn't run. Try again.");
  }
}
