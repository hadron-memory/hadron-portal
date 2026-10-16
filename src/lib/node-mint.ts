/**
 * #992 slice C — per-node minting (hadron-server#1591 PR 2), turned into what
 * the portal renders. Pure: no fetching, no DOM.
 *
 * - A node is minted once, at a revision: `Node.mintStatus` records which, by
 *   whom, and the approval hash it was minted with.
 * - The #1591 migration BACKFILLED every node of a memory that was never a
 *   draft as minted (`mintedByInfo: 'backfill'`, no revision, no hash).
 *   Holger's ruling (team chat #6255): those get a quiet secondary label, not
 *   a headline badge, so ordinary memories don't look newly governed.
 * - Mint refusals and report findings map to FIXED copy by code or kind; the
 *   server's prose is never shown (the same rule as `$lib/node-approval`).
 */
import { t } from '$lib/i18n/t';
import type { ProvenanceResult } from '$lib/node-provenance';
import type { OpenFeedback } from '$lib/comments';

export interface NodeMintStatus {
  minted: boolean;
  mintedAt: string | null;
  mintedBy: { handle: string | null; urn: string | null } | null;
  mintedByInfo: string | null;
  /** The minted revision. Null for a backfilled node, whose revision is unknown. */
  revision: number | null;
  hash: string | null;
}

/** The marker the #1591 migration writes into `mintedByInfo`. */
export const BACKFILL_MINTER = 'backfill';

/**
 * Accept a mint status only when its read describes the revision the page
 * rendered, like the approval it rides with.
 */
export function bindMintToRevision(
  read: { revision: number; mintStatus?: NodeMintStatus | null } | null | undefined,
  shownRevision: number | null | undefined,
): ProvenanceResult<NodeMintStatus> {
  if (!read?.mintStatus) return { ok: false };
  if (shownRevision == null || read.revision !== shownRevision) return { ok: false, changed: true };
  return { ok: true, value: read.mintStatus };
}

export type MintView =
  | { kind: 'minted'; status: NodeMintStatus; minter: string | null; editedSince: boolean }
  | { kind: 'backfilled' }
  | { kind: 'unminted' }
  | { kind: 'none' };

/**
 * What to show. `none` (a failed or outdated read) shows nothing: the mint
 * label is secondary, and the approval badge beside it already says when the
 * status couldn't load.
 */
export function mintView(result: ProvenanceResult<NodeMintStatus | null | undefined>, shownRevision: number | null | undefined): MintView {
  if (!result.ok || !result.value) return { kind: 'none' };
  const s = result.value;
  if (!s.minted) return { kind: 'unminted' };
  if (s.mintedByInfo === BACKFILL_MINTER) return { kind: 'backfilled' };
  const handle = s.mintedBy?.handle?.trim();
  const minter = handle ? `@${handle}` : s.mintedByInfo?.trim() || null;
  const editedSince = s.revision != null && shownRevision != null && s.revision !== shownRevision;
  return { kind: 'minted', status: s, minter, editedSince };
}

// ── Mint (the memory action) ───────────────────────────────────────────

export type MintFindingKind =
  | 'PLACEHOLDER'
  | 'UNRESOLVED_REFERENCE'
  | 'LINT'
  | 'STALE_ABSTRACT'
  | 'NOT_APPROVED'
  | 'TAMPERED'
  | 'CITES_UNMINTED';

export interface MintFinding {
  kind: MintFindingKind;
  loc: string;
  rule: string | null;
  targetLoc: string | null;
}

/** The report the mint endpoint returns: counts, not the full loc list. */
export interface MintReport {
  dryRun: boolean;
  minted: boolean;
  mintedCount: number;
  /** How many nodes this run minted, or a dry run would mint. */
  mintableCount: number;
  blockers: MintFinding[];
  openQuestionCount: number;
  /**
   * portal#1014: nodes with open discussion threads (hadron-server#1607). A
   * WARNING, never a blocker: an open thread never stops a mint
   * (hrn:node:hadronmemory.com:specs:cor:dmo:110:07).
   */
  openFeedback: OpenFeedback[];
}

/** The warning line for open feedback in a mint report, or null when there is none. */
export function openFeedbackWarning(r: Pick<MintReport, 'openFeedback'>): string | null {
  const n = r.openFeedback.length;
  if (n === 0) return null;
  // One node can carry several threads, so the singular copy is only for one thread.
  if (n === 1 && r.openFeedback[0].openThreads > 1) {
    return t('memory.mint.open-feedback-one-node', '1 node has {k} open discussions. They don’t block minting, but read them before you mint.', { k: r.openFeedback[0].openThreads });
  }
  return n === 1
    ? t('memory.mint.open-feedback-one', '1 node has an open discussion. It doesn’t block minting, but read it before you mint.')
    : t('memory.mint.open-feedback-many', '{n} nodes have open discussions. They don’t block minting, but read them before you mint.', { n });
}

/** What blocks minting a node, as a reader should act on it. Keyed by kind. */
export function findingKindText(kind: string): string {
  switch (kind) {
    case 'PLACEHOLDER':
      return t('memory.mint.blocker.placeholder', 'Placeholder: no spec written yet');
    case 'UNRESOLVED_REFERENCE':
      return t('memory.mint.blocker.unresolved', 'Cites a spec that doesn’t exist or is a placeholder');
    case 'LINT':
      return t('memory.mint.blocker.lint', 'Fails a structural check');
    case 'STALE_ABSTRACT':
      return t('memory.mint.blocker.stale-abstract', 'Abstract written for an earlier body');
    case 'NOT_APPROVED':
      return t('memory.mint.blocker.not-approved', 'Current content not approved');
    case 'TAMPERED':
      return t('memory.mint.blocker.tampered', 'Approved text changed outside the revision history; re-approve it');
    case 'CITES_UNMINTED':
      return t('memory.mint.blocker.cites-unminted', 'Links to a node in another memory that isn’t minted');
    default:
      return t('memory.mint.blocker.unknown', 'Blocks minting');
  }
}

export function mintSummary(r: MintReport): string {
  if (r.dryRun) {
    if (r.blockers.length > 0) {
      return r.blockers.length === 1
        ? t('memory.mint.blocked-one', '1 item blocks minting. Fix it, then try again.')
        : t('memory.mint.blocked', '{n} items block minting. Fix them, then try again.', { n: r.blockers.length });
    }
    if (r.mintableCount === 0) return t('memory.mint.nothing', 'Every node in this memory is already minted.');
    return r.mintableCount === 1
      ? t('memory.mint.ready-one', '1 node is ready to mint.')
      : t('memory.mint.ready-many', '{n} nodes are ready to mint.', { n: r.mintableCount });
  }
  return r.mintedCount === 1
    ? t('memory.mint.minted-one', 'Minted 1 node.')
    : t('memory.mint.minted-many', 'Minted {n} nodes.', { n: r.mintedCount });
}

/**
 * The HTTP status and fixed copy for a mint failure. The typed refusals are
 * raised before anything is stamped, so "nothing was minted" is true for them.
 * Anything else is an unknown outcome for a real run (Gene on #994), but a dry
 * run can't mint, so its failure is only a failed check (Codex on #996).
 */
export function mintFailure(code: string | null | undefined, dryRun = false): { status: 403 | 404 | 409 | 422 | 503 | 500; text: string } {
  switch (code) {
    case 'FORBIDDEN':
      return { status: 403, text: t('memory.mint.refused.forbidden', "You don't have permission to mint this memory's nodes.") };
    case 'NOT_FOUND':
    case 'MEMORY_NOT_FOUND':
      return { status: 404, text: t('memory.mint.refused.not-found', 'This memory no longer exists, or you no longer have access to it.') };
    case 'SPEC_CORPUS_MINT_BLOCKED':
      return { status: 409, text: t('memory.mint.refused.blocked', 'Something now blocks minting, so nothing was minted. The list below is current.') };
    case 'SPEC_CORPUS_BUSY':
      return { status: 503, text: t('memory.mint.refused.busy', 'This memory is being written to right now, so nothing was minted. Try again in a moment.') };
    case 'SPEC_CORPUS_ENCRYPTED_UNSUPPORTED':
      return { status: 422, text: t('memory.mint.refused.encrypted', "Encrypted memories can't be minted yet.") };
    default:
      return { status: 500, text: dryRun ? mintCheckFailedText() : mintUnconfirmedText() };
  }
}

/** Copy for a dry run that failed: nothing could have been minted. */
export function mintCheckFailedText(): string {
  return t('memory.mint.check-failed', "Couldn't check this memory. Try again.");
}

/** A response body is a usable mint report only with every field the dialog reads. */
export function isMintReport(v: unknown): v is MintReport {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.dryRun === 'boolean' && typeof r.minted === 'boolean' && typeof r.mintedCount === 'number'
    && typeof r.mintableCount === 'number' && typeof r.openQuestionCount === 'number' && Array.isArray(r.blockers)
    && Array.isArray(r.openFeedback);
}

/** Copy for a blocked refusal when the fresh list couldn't be fetched either. */
export function mintBlockedUnlistedText(): string {
  return t('memory.mint.refused.blocked-unlisted', 'Something now blocks minting, so nothing was minted. Check again to see what.');
}

export function mintUnconfirmedText(): string {
  return t('memory.mint.unconfirmed', "Minting couldn't be confirmed. It may or may not have gone through. Reload the page to see each node's status before trying again.");
}
