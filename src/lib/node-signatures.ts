/**
 * portal#1022 — a node's passkey signatures (hadron-server#1864, S2b-1),
 * turned into what the portal renders. Pure: no fetching, no DOM.
 *
 * - Display only. The portal never derives a signature's state: CURRENT,
 *   EARLIER, PENDING and the rest come from the server on every read
 *   (hrn:node:hadronmemory.com:specs:cor:dmo:130:04), and an invalid record is
 *   never a signature, only a count (`integrityProblems`).
 * - **No signatures and no integrity problems shows nothing.** The signing
 *   surfaces sit behind a server switch that is off in production
 *   (hadron-server#1895), and a switched-off surface must not show that the
 *   feature exists. An encrypted node reads NOT_APPLICABLE with no
 *   signatures, so it shows nothing for the same reason.
 * - Bound to the rendered revision like the approval beside it: a signature's
 *   state describes the node's CURRENT content, so a read describing a newer
 *   revision than the page shows is withheld.
 */
import { t } from '$lib/i18n/t';
import type { ProvenanceResult } from '$lib/node-provenance';

export type SignatureState = 'CURRENT' | 'EARLIER' | 'PENDING' | 'CANCELLED' | 'NOT_APPLICABLE' | 'ENDED_ENCRYPTED_MEMORY';

export interface NodeSignature {
  id: string;
  signer: { handle: string | null; urn: string | null } | null;
  passkeyLabel: string;
  passkeyRevokedAt: string | null;
  revision: number;
  verifiedAt: string;
  state: SignatureState;
}

export interface NodeSignatureStatus {
  state: SignatureState | null;
  signatures: NodeSignature[];
  integrityProblems: number;
}

/** What NODE_SIGNATURES_QUERY returns: the status plus the revision it describes. */
export interface NodeSignatureRead {
  id: string;
  revision: number;
  signatureStatus: NodeSignatureStatus | null;
}

export function bindSignaturesToRevision(
  read: NodeSignatureRead | null | undefined,
  shownRevision: number | null | undefined,
): ProvenanceResult<NodeSignatureStatus> {
  if (!read?.signatureStatus) return { ok: false };
  if (shownRevision == null || read.revision !== shownRevision) return { ok: false, changed: true };
  return { ok: true, value: read.signatureStatus };
}

export type SignatureTone = 'signed' | 'attention' | 'neutral';

export interface SignatureRow {
  id: string;
  state: SignatureState | null;
  label: string;
  tone: SignatureTone;
  signer: string;
  signerUrn: string | null;
  passkeyLabel: string;
  passkeyRevokedAt: string | null;
  revision: number;
  verifiedAt: string;
}

export type SignaturesView =
  | { kind: 'none' }
  | { kind: 'shown'; label: string; tone: SignatureTone; rows: SignatureRow[]; integrityProblems: number };

const TONE: Record<SignatureState, SignatureTone> = {
  CURRENT: 'signed',
  EARLIER: 'attention',
  PENDING: 'attention',
  CANCELLED: 'neutral',
  NOT_APPLICABLE: 'neutral',
  ENDED_ENCRYPTED_MEMORY: 'neutral',
};

/**
 * Fixed copy per state. A state this build doesn't know renders as such
 * rather than borrowing a known one's wording: never claim "Signed" for a
 * state the server added later.
 */
export function signatureStateLabel(state: SignatureState | string | null): string {
  switch (state) {
    case 'CURRENT': return t('node.signatures.state.current', 'Signed');
    case 'EARLIER': return t('node.signatures.state.earlier', 'Signed an earlier version');
    case 'PENDING': return t('node.signatures.state.pending', 'Signature pending');
    case 'CANCELLED': return t('node.signatures.state.cancelled', 'Signature cancelled');
    case 'NOT_APPLICABLE': return t('node.signatures.state.not-applicable', 'Signing does not apply (encrypted memory)');
    case 'ENDED_ENCRYPTED_MEMORY': return t('node.signatures.state.ended-encrypted', 'Signature ended (encrypted memory)');
    default: return t('node.signatures.state.unknown', 'Signature state unknown');
  }
}

/** Why a state counts or doesn't, for the badge's title. Null when the label says it all. */
export function signatureStateHint(state: SignatureState | string | null): string | null {
  switch (state) {
    case 'EARLIER': return t('node.signatures.hint.earlier', 'The content changed after this signature was made. Restoring the old text does not make it current again.');
    case 'PENDING': return t('node.signatures.hint.pending', "Made with a first passkey that is still in its cooling-off window. It doesn't count until the window ends.");
    case 'CANCELLED': return t('node.signatures.hint.cancelled', 'Made with a first passkey that was revoked during its cooling-off window. It never counts.');
    default: return null;
  }
}

const known = (s: string | null | undefined): s is SignatureState => s != null && s in TONE;

function row(s: NodeSignature): SignatureRow {
  const handle = s.signer?.handle?.trim();
  return {
    id: s.id,
    state: known(s.state) ? s.state : null,
    label: signatureStateLabel(s.state),
    tone: known(s.state) ? TONE[s.state] : 'neutral',
    signer: handle ? `@${handle}` : t('node.signatures.unknown-signer', 'Unknown signer'),
    signerUrn: s.signer?.urn?.trim() || null,
    passkeyLabel: s.passkeyLabel,
    passkeyRevokedAt: s.passkeyRevokedAt,
    revision: s.revision,
    verifiedAt: s.verifiedAt,
  };
}

/** What to show. See the module note for why "nothing to report" is `none`, not "Not signed". */
export function signaturesView(result: ProvenanceResult<NodeSignatureStatus | null | undefined> | null | undefined): SignaturesView {
  if (!result?.ok || !result.value) return { kind: 'none' };
  const s = result.value;
  const signatures = s.signatures ?? [];
  const integrityProblems = Math.max(0, s.integrityProblems ?? 0);
  if (signatures.length === 0 && integrityProblems === 0) return { kind: 'none' };
  return {
    kind: 'shown',
    label: signatures.length ? signatureStateLabel(s.state) : t('node.signatures.none-valid', 'No valid signatures'),
    tone: signatures.length && known(s.state) ? TONE[s.state] : 'neutral',
    rows: signatures.map(row),
    integrityProblems,
  };
}

export function integrityProblemsText(n: number): string {
  return n === 1
    ? t('node.signatures.integrity-one', '1 signature record failed verification and is not shown.')
    : t('node.signatures.integrity-many', '{n} signature records failed verification and are not shown.', { n });
}

/**
 * Reader copy for a refused `requestNodeSignature` (portal#1022 links half).
 * The server's typed refusals are the contract
 * (hrn:node:hadronmemory.com:specs:cor:dmo:130:02/:03); each gets portal copy
 * rather than the server's prose, because the reader here just clicked a
 * button and needs to know what to do next, not the wire's wording. An unknown
 * code — including one a newer server added — falls back to the generic line:
 * never claim a reason the map cannot vouch for.
 */
export function signatureRequestRefusalText(code: string | null): string | null {
  switch (code) {
    case 'NODE_NOT_FOUND': return t('node.signatures.request.refused.not-found', 'This node is no longer available.');
    case 'ENCRYPTED_MEMORY_NOT_APPLICABLE': return t('node.signatures.request.refused.encrypted', 'Signing does not apply: this memory is encrypted.');
    case 'COMMENT_NOT_SIGNABLE': return t('node.signatures.request.refused.comment', 'Comments cannot be signed.');
    case 'NODE_IS_PLACEHOLDER': return t('node.signatures.request.refused.placeholder', 'A placeholder node cannot be signed yet.');
    case 'REVISION_MISMATCH': return t('node.signatures.request.refused.revision', 'The node changed since you loaded it. Reload the page and try again.');
    case 'SIGNER_NOT_FOUND': return t('node.signatures.request.refused.signer-not-found', 'The person asked to sign could not be found.');
    case 'SIGNER_NOT_A_WRITER': return t('node.signatures.request.refused.signer-not-writer', 'The person asked to sign may not write this memory.');
    default: return null;
  }
}
