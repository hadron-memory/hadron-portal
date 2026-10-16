import { describe, expect, it } from 'vitest';
import { approvalRefusalStatus, approvalText, approvalView, approverLabel, bindApprovalToRevision, integrityText, shortHash, type NodeApproval } from './node-approval';

const approval: NodeApproval = { revision: 3, approvedAt: '2026-10-01T10:00:00Z', approvedBy: null, approvedByInfo: 'app-key', hash: '0123456789abcdef' };

describe('bindApprovalToRevision', () => {
  it('accepts only the rendered revision', () => {
    const read = { id: 'n', revision: 3, approvalStatus: { state: 'APPROVED' as const, approval } };
    expect(bindApprovalToRevision(read, 3)).toEqual({ ok: true, value: read.approvalStatus });
    expect(bindApprovalToRevision(read, 2)).toEqual({ ok: false, changed: true });
    expect(bindApprovalToRevision(read, null)).toEqual({ ok: false, changed: true });
    expect(bindApprovalToRevision(null, 3)).toEqual({ ok: false });
  });
});

describe('approvalView', () => {
  it('offers Approve unless the shown revision is approved', () => {
    expect(approvalView({ ok: true, value: { state: 'APPROVED', approval } })).toMatchObject({ tone: 'approved', canApprove: false, approval });
    expect(approvalView({ ok: true, value: { state: 'SUPERSEDED', approval } })).toMatchObject({ tone: 'attention', canApprove: true, approval });
    expect(approvalView({ ok: true, value: { state: 'NOT_APPROVED', approval } })).toMatchObject({ tone: 'neutral', canApprove: true, approval: null });
  });

  // portal#1088 (hadron-server#1637): an encrypted memory's node is never
  // approved; a retained approval record must not surface as one.
  it('NOT_APPLICABLE is neither approved nor approvable, even with a retained record', () => {
    const view = approvalView({ ok: true, value: { state: 'NOT_APPLICABLE', approval } });
    expect(view).toEqual({ state: 'NOT_APPLICABLE', tone: 'neutral', approval: null, canApprove: false });
    expect(approvalText(view)).toBe('Not applicable (encrypted memory)');
  });

  it('an unknown state is never worded as approved', () => {
    const view = approvalView({ ok: true, value: { state: 'ENDED' as never, approval } });
    expect(view).toEqual({ state: 'UNAVAILABLE', tone: 'neutral', approval: null, canApprove: false });
    expect(approvalText(view)).not.toMatch(/approved/i);
  });

  it('a failed, changed or unknown read offers nothing', () => {
    expect(approvalView({ ok: false })).toMatchObject({ state: 'UNAVAILABLE', canApprove: false });
    expect(approvalView({ ok: false, changed: true })).toMatchObject({ state: 'CHANGED', canApprove: false });
    expect(approvalView({ ok: true, value: { state: 'MINTED' as never, approval } })).toMatchObject({ state: 'UNAVAILABLE', canApprove: false });
  });
});

describe('display helpers', () => {
  it('names the approver by handle, else by the server info', () => {
    expect(approverLabel({ ...approval, approvedBy: { handle: ' ada ', urn: null } })).toBe('@ada');
    expect(approverLabel(approval)).toBe('app-key');
    expect(approverLabel({ ...approval, approvedByInfo: null })).toBeNull();
  });

  it('maps ENCRYPTED_MEMORY_NOT_APPLICABLE to a 409 refusal (portal#1088)', () => {
    expect(approvalRefusalStatus('ENCRYPTED_MEMORY_NOT_APPLICABLE')).toBe(409);
  });

  it('shortens a hash', () => {
    expect(shortHash('0123456789abcdef')).toBe('0123456789ab…');
    expect(shortHash('abc')).toBe('abc');
    expect(shortHash(null)).toBe('');
  });

  it('flags only TAMPERED (and an unknown state) as a problem', () => {
    for (const state of ['INTACT', 'SUPERSEDED', 'NOT_APPROVED'] as const) {
      expect(integrityText({ state, revision: 4, approvedRevision: 3 }).problem).toBe(false);
    }
    expect(integrityText({ state: 'TAMPERED', revision: 4, approvedRevision: 3 }).problem).toBe(true);
    expect(integrityText({ state: 'X' as never, revision: 4, approvedRevision: 3 }).problem).toBe(true);
  });
});


describe('content-based approval (#1129)', () => {
  it('accepts an older approval record when the server status describes the shown revision', () => {
    const read = { id: 'n', revision: 5, approvalStatus: { state: 'APPROVED' as const, approval } };
    const bound = bindApprovalToRevision(read, 5);
    expect(approvalView(bound)).toMatchObject({ state: 'APPROVED', canApprove: false, approval });
    expect(bindApprovalToRevision(read, 4)).toEqual({ ok: false, changed: true });
  });
  it('intact verification names the recorded approval and the current revision', () => {
    const verdict = integrityText({ state: 'INTACT', revision: 5, approvedRevision: 3 });
    expect(verdict.problem).toBe(false);
    expect(verdict.text).toContain('approval recorded at revision 3');
    expect(verdict.text).toContain('current revision 5');
    expect(verdict.text).toContain('title, abstract and content');
  });
  it('ordinary content changes and tampering remain different verdicts after metadata revisions', () => {
    const changed = integrityText({ state: 'SUPERSEDED', revision: 5, approvedRevision: 3 });
    expect(changed.text).toContain('content has changed');
    expect(changed.problem).toBe(false);
    const tampered = integrityText({ state: 'TAMPERED', revision: 5, approvedRevision: 3 });
    expect(tampered.problem).toBe(true);
    expect(tampered.text).toContain('approved text of revision 3 has changed');
    expect(tampered.text).not.toBe(changed.text);
  });
});
