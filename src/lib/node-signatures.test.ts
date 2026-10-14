/** portal#1022 — node signatures (hadron-server#1864) turned into what the node page renders. */
import { describe, expect, it } from 'vitest';
import { bindSignaturesToRevision, integrityProblemsText, signatureStateLabel, signaturesView, type NodeSignature, type NodeSignatureStatus } from './node-signatures';

const SIG: NodeSignature = {
  id: 'sig-1', signer: { handle: 'holger', urn: 'hrn:user:holger' }, passkeyLabel: 'YubiKey 5C',
  passkeyRevokedAt: null, revision: 5, verifiedAt: '2026-10-14T10:00:00Z', state: 'CURRENT',
};
const status = (over: Partial<NodeSignatureStatus> = {}): NodeSignatureStatus => ({ state: 'CURRENT', signatures: [SIG], integrityProblems: 0, ...over });

describe('bindSignaturesToRevision', () => {
  it('accepts a read of the revision on screen', () => {
    expect(bindSignaturesToRevision({ id: 'n', revision: 5, signatureStatus: status() }, 5)).toEqual({ ok: true, value: status() });
  });
  it('withholds a read of another revision: the states describe content the page does not show', () => {
    expect(bindSignaturesToRevision({ id: 'n', revision: 6, signatureStatus: status() }, 5)).toEqual({ ok: false, changed: true });
    expect(bindSignaturesToRevision({ id: 'n', revision: 5, signatureStatus: status() }, null)).toEqual({ ok: false, changed: true });
  });
  it('a missing node or status is a failed read', () => {
    expect(bindSignaturesToRevision(null, 5)).toEqual({ ok: false });
    expect(bindSignaturesToRevision({ id: 'n', revision: 5, signatureStatus: null }, 5)).toEqual({ ok: false });
  });
});

describe('signaturesView — nothing to report shows nothing (hadron-server#1895)', () => {
  it('a failed, withheld or pending read shows nothing', () => {
    expect(signaturesView(null)).toEqual({ kind: 'none' });
    expect(signaturesView({ ok: false })).toEqual({ kind: 'none' });
    expect(signaturesView({ ok: false, changed: true })).toEqual({ kind: 'none' });
  });
  it('no signatures and no problems shows nothing, never a "Not signed" claim', () => {
    expect(signaturesView({ ok: true, value: status({ state: null, signatures: [] }) })).toEqual({ kind: 'none' });
  });
  it('an encrypted node (NOT_APPLICABLE, none listed) shows nothing either', () => {
    expect(signaturesView({ ok: true, value: status({ state: 'NOT_APPLICABLE', signatures: [] }) })).toEqual({ kind: 'none' });
  });
});

describe('signaturesView — what the server returned', () => {
  it('a current signature is shown with its signer, URN, passkey label and revision', () => {
    const v = signaturesView({ ok: true, value: status() });
    expect(v.kind).toBe('shown');
    if (v.kind !== 'shown') return;
    expect(v).toMatchObject({ label: 'Signed', tone: 'signed', integrityProblems: 0 });
    expect(v.rows).toEqual([expect.objectContaining({ signer: '@holger', signerUrn: SIG.signer!.urn, passkeyLabel: 'YubiKey 5C', revision: 5, tone: 'signed' })]);
  });
  it('the roll-up is the server\'s, not recomputed from the rows', () => {
    const v = signaturesView({ ok: true, value: status({ state: 'EARLIER', signatures: [{ ...SIG, state: 'EARLIER' }, { ...SIG, id: 'sig-2', state: 'CANCELLED' }] }) });
    expect(v).toMatchObject({ kind: 'shown', label: 'Signed an earlier version', tone: 'attention' });
  });
  it('a revoked passkey is carried through; the signature keeps its state', () => {
    const v = signaturesView({ ok: true, value: status({ signatures: [{ ...SIG, passkeyRevokedAt: '2026-10-14T11:00:00Z' }] }) });
    expect(v.kind === 'shown' && v.rows[0]).toMatchObject({ passkeyRevokedAt: '2026-10-14T11:00:00Z', label: 'Signed' });
  });
  it('integrity problems alone are reported, with no signature claimed', () => {
    const v = signaturesView({ ok: true, value: status({ state: null, signatures: [], integrityProblems: 2 }) });
    expect(v).toEqual({ kind: 'shown', label: 'No valid signatures', tone: 'neutral', rows: [], integrityProblems: 2 });
  });
  it('a signer the server no longer resolves (null: a deleted account) is named as unknown, with no URN chip', () => {
    const v = signaturesView({ ok: true, value: status({ signatures: [{ ...SIG, signer: null }] }) });
    expect(v.kind === 'shown' && v.rows[0]).toMatchObject({ signer: 'Unknown signer', signerUrn: null });
  });
  it('a state this build does not know is never worded as signed', () => {
    const v = signaturesView({ ok: true, value: status({ state: 'SOMETHING_NEW' as never, signatures: [{ ...SIG, state: 'SOMETHING_NEW' as never }] }) });
    expect(v).toMatchObject({ kind: 'shown', label: 'Signature state unknown', tone: 'neutral' });
    expect(v.kind === 'shown' && v.rows[0]).toMatchObject({ state: null, label: 'Signature state unknown', tone: 'neutral' });
  });
});

describe('copy', () => {
  it('every server state has its own label', () => {
    const labels = (['CURRENT', 'EARLIER', 'PENDING', 'CANCELLED', 'NOT_APPLICABLE', 'ENDED_ENCRYPTED_MEMORY'] as const).map(signatureStateLabel);
    expect(new Set(labels).size).toBe(6);
    expect(labels).not.toContain('Signature state unknown');
  });
  it('integrity problems are counted in words', () => {
    expect(integrityProblemsText(1)).toBe('1 signature record failed verification and is not shown.');
    expect(integrityProblemsText(3)).toBe('3 signature records failed verification and are not shown.');
  });
});
