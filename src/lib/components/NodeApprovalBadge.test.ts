import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeApprovalBadge from './NodeApprovalBadge.svelte';
import { approvalView } from '$lib/node-approval';

const approval = { revision: 3, approvedAt: '2026-10-01T10:00:00Z', approvedBy: { handle: 'ada', urn: 'hrn:user:hadronmemory.com:ada' }, approvedByInfo: null, hash: '0123456789abcdef0123' };

describe('NodeApprovalBadge (#992)', () => {
  it('says who approved which revision, with the approver URN and a short hash', () => {
    const { body } = render(NodeApprovalBadge, { props: { view: approvalView({ ok: true, value: { state: 'APPROVED', approval } }) } });
    expect(body).toContain('data-state="APPROVED"');
    expect(body).toContain('Content approved at revision 3 by @ada');
    expect(body).toContain('hrn:user:hadronmemory.com:ada');
    expect(body).toContain('0123456789ab…');
  });

  it('marks an edited node as changed since approval, keeping the old approval visible', () => {
    const { body } = render(NodeApprovalBadge, { props: { view: approvalView({ ok: true, value: { state: 'SUPERSEDED', approval } }) } });
    expect(body).toContain('Content changed since approval');
    expect(body).toContain('Content approved at revision 3');
  });

  it('labels an encrypted memory\'s node not applicable, with no detail even from a retained record (portal#1088)', () => {
    const { body } = render(NodeApprovalBadge, { props: { view: approvalView({ ok: true, value: { state: 'NOT_APPLICABLE', approval } }) } });
    expect(body).toContain('data-state="NOT_APPLICABLE"');
    expect(body).toContain('Not applicable (encrypted memory)');
    expect(body).not.toContain('approval-detail');
    expect(body).not.toContain('Content approved at revision 3');
  });

  it('shows no approval detail for a never-approved node', () => {
    const { body } = render(NodeApprovalBadge, { props: { view: approvalView({ ok: true, value: { state: 'NOT_APPROVED', approval: null } }) } });
    expect(body).toContain('Not approved');
    expect(body).not.toContain('approval-detail');
  });
});


it('shows the current revision separately when metadata kept older approved content current', () => {
  const view = approvalView({ ok: true, value: { state: 'APPROVED', approval } });
  const { body } = render(NodeApprovalBadge, { props: { view, currentRevision: 5 } as never });
  expect(body).toContain('Content approved at revision 3');
  expect(body).toContain('Current revision 5');
  expect(body).toContain('title, abstract and content are unchanged');
  expect(body).not.toContain('Content changed');
  expect(view.canApprove).toBe(false);
});
