import { describe, expect, it } from 'vitest';
import { approvalView, approverLabel, bindApprovalToRevision, integrityText, shortHash, type NodeApproval } from './node-approval';

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
