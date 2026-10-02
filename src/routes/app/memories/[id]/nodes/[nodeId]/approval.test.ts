/**
 * #992 — node approvals (hadron-server#1591 PR 1) on the node page: the
 * approval status is its own streamed read, bound to the revision the page
 * rendered, and Approve / Verify answer with fixed copy keyed by code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import {
  APPROVE_NODE_MUTATION,
  NODE_APPROVAL_QUERY,
  NODE_BY_ID_QUERY,
  NODE_QUERY,
  NODE_REVISIONS_QUERY,
  VERIFY_NODE_QUERY,
} from '$lib/server/queries';
import type { NodeApprovalStatus } from '$lib/node-approval';
import type { ProvenanceResult } from '$lib/node-provenance';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: null,
  tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
  isRunnable: null, createdAt: '', updatedAt: '',
  outgoingEdges: [], incomingEdges: [],
};
const APPROVED: NodeApprovalStatus = {
  state: 'APPROVED',
  approval: { revision: 4, approvedAt: '2026-10-01T10:00:00Z', approvedBy: { handle: 'holger', urn: null }, approvedByInfo: null, hash: 'abc' },
};

function gqlError(code: string, message = 'server prose with secrets') {
  return new ClientError(
    { errors: [{ message, extensions: { code } }] as never, status: 200, headers: new Headers() } as never,
    { query: '' },
  );
}

function serve(overrides: Map<string, (vars: Record<string, unknown>) => unknown>) {
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, unknown>) => {
    const o = overrides.get(doc);
    if (o) return o(vars);
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 } };
  });
}

function loadEvent() {
  return {
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
    parent: vi.fn().mockResolvedValue({
      graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo' }],
      graph: { urn: 'hrn:mem:acme.com:mem-a' },
      isConsumerMode: false,
      activeOrgId: 'org-1',
    }),
  } as never;
}

async function loadApproval(): Promise<ProvenanceResult<NodeApprovalStatus>> {
  const { load } = await import('./+page.server');
  const data = (await load(loadEvent())) as unknown as { approval: Promise<ProvenanceResult<NodeApprovalStatus>>; approveForm: { data: { revision: number } } };
  expect(data.approveForm.data.revision).toBe(4);
  return data.approval;
}

describe('node page — approval forms have ids of their own', () => {
  // Chip's QA on #993: Verify's result never showed, because Superforms ids
  // come from the schema's shape and the verify form hashed the same as
  // Duplicate and Convert to task. A form sharing an id gets its result
  // routed to another form.
  // #995: no two forms the page loads may share an id. Duplicate and Convert
  // to task did (both `_kind`-only schemas), hiding Convert to task's errors.
  it('every form the page loads has its own id', async () => {
    serve(new Map([[NODE_APPROVAL_QUERY, () => ({ node: { id: 'leaf-pk', revision: 4, approvalStatus: APPROVED } })]]));
    const { load } = await import('./+page.server');
    const data = (await load(loadEvent())) as unknown as Record<string, { id?: string } | undefined>;
    const ids = Object.keys(data).filter((k) => k.endsWith('Form')).map((k) => data[k]?.id);
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('approve and verify ids are unique among every form on the page', async () => {
    serve(new Map([[NODE_APPROVAL_QUERY, () => ({ node: { id: 'leaf-pk', revision: 4, approvalStatus: APPROVED } })]]));
    const { load } = await import('./+page.server');
    const data = (await load(loadEvent())) as unknown as Record<string, { id?: string } | undefined>;
    const ids = Object.keys(data).filter((k) => k.endsWith('Form')).map((k) => [k, data[k]?.id] as const);
    for (const own of ['approveForm', 'verifyForm']) {
      const id = data[own]?.id;
      expect(id).toBeTruthy();
      expect(ids.filter(([, other]) => other === id).map(([k]) => k)).toEqual([own]);
    }
  });

  it('the actions answer under the same ids', async () => {
    mockRequest.mockResolvedValue({ verifyNode: { state: 'INTACT', revision: 4, approvedRevision: 4, expectedHash: 'a', actualHash: 'a' } });
    const v = await runAction('verifyNode', { _kind: 'verifyNode' });
    expect((v.data?.form ?? v.form as { id?: string } | undefined) as { id?: string }).toMatchObject({ id: 'verifyNode' });
    mockRequest.mockResolvedValue({ approveNode: { nodeId: 'leaf-pk', approval: { revision: 4, approvedAt: '' } } });
    const a = await runAction('approveNode', { _kind: 'approveNode', revision: '4' });
    expect((a.data?.form ?? a.form) as { id?: string }).toMatchObject({ id: 'approveNode' });
  });
});

describe('node page — approval status is a streamed read bound to the rendered revision', () => {
  it('shows the status when it describes the rendered revision', async () => {
    serve(new Map([[NODE_APPROVAL_QUERY, () => ({ node: { id: 'leaf-pk', revision: 4, approvalStatus: APPROVED } })]]));
    expect(await loadApproval()).toEqual({ ok: true, value: APPROVED });
    expect(mockRequest.mock.calls.find(([q]) => q === NODE_APPROVAL_QUERY)![1]).toEqual({ ref: 'leaf-pk' });
  });

  it('withholds a status read for a newer revision than the page shows', async () => {
    serve(new Map([[NODE_APPROVAL_QUERY, () => ({ node: { id: 'leaf-pk', revision: 5, approvalStatus: APPROVED } })]]));
    expect(await loadApproval()).toEqual({ ok: false, changed: true });
  });

  it('a failed read costs only the badge, not the page', async () => {
    serve(new Map([[NODE_APPROVAL_QUERY, () => { throw new Error('boom'); }]]));
    expect(await loadApproval()).toEqual({ ok: false });
  });
});

async function runAction(name: 'approveNode' | 'verifyNode', fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return (await actions[name]({
    request: { formData: async () => fd },
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
  } as never)) as { status?: number; form?: { message?: unknown }; data?: { form?: { message?: unknown } } };
}
const messageOf = (r: Awaited<ReturnType<typeof runAction>>) => (r.data?.form ?? r.form)?.message;

describe('approveNode action', () => {
  it('approves the revision the reader saw', async () => {
    mockRequest.mockResolvedValue({ approveNode: { nodeId: 'leaf-pk', approval: { revision: 4, approvedAt: '' } } });
    const r = await runAction('approveNode', { _kind: 'approveNode', revision: '4' });
    expect(mockRequest).toHaveBeenCalledWith(APPROVE_NODE_MUTATION, { nodeRef: 'leaf-pk', revision: 4 });
    expect(messageOf(r)).toEqual({ type: 'success', text: 'Revision 4 approved.' });
  });

  it('refuses a submit with no revision before calling the server', async () => {
    const r = await runAction('approveNode', { _kind: 'approveNode' });
    expect(r.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['REVISION_MISMATCH', 409, 'This node changed after you opened it'],
    ['FORBIDDEN', 403, "You don't have permission to approve"],
    ['NODE_IS_PLACEHOLDER', 409, 'reserved placeholder'],
    ['NODE_NOT_FOUND', 404, 'no longer exists'],
    ['SESSION_EXPIRED', 423, 'encrypted and its key'],
  ])('%s maps to fixed copy, never the server text', async (code, status, copy) => {
    mockRequest.mockRejectedValue(gqlError(code));
    const r = await runAction('approveNode', { _kind: 'approveNode', revision: '4' });
    expect(r.status).toBe(status);
    const m = messageOf(r) as { type: string; text: string };
    expect(m.type).toBe('error');
    expect(m.text).toContain(copy);
    expect(m.text).not.toContain('server prose');
  });

  it('an unrecognised code is a failure (500), not a refusal (Gene on #993)', async () => {
    mockRequest.mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR'));
    const r = await runAction('approveNode', { _kind: 'approveNode', revision: '4' });
    expect(r.status).toBe(500);
    expect(messageOf(r)).toEqual({ type: 'error', text: "The approval didn't go through. Try again." });
  });
});

describe('verifyNode action', () => {
  const check = (state: string) => ({ verifyNode: { state, revision: 4, approvedRevision: 3, expectedHash: 'a', actualHash: 'b' } });

  it('INTACT is a success message', async () => {
    mockRequest.mockResolvedValue(check('INTACT'));
    const r = await runAction('verifyNode', { _kind: 'verifyNode' });
    expect(mockRequest).toHaveBeenCalledWith(VERIFY_NODE_QUERY, { nodeRef: 'leaf-pk' });
    expect(messageOf(r)).toEqual({ type: 'success', text: 'Verified: revision 4 matches what was approved.' });
    expect((r as { verifyIntegrity?: unknown }).verifyIntegrity).toEqual({ state: 'INTACT', expectedHash: 'a', actualHash: 'b' });
  });

  it('TAMPERED is an error, naming the approved revision', async () => {
    mockRequest.mockResolvedValue(check('TAMPERED'));
    const m = messageOf(await runAction('verifyNode', { _kind: 'verifyNode' })) as { type: string; text: string };
    expect(m.type).toBe('error');
    expect(m.text).toContain('approved text of revision 3 has changed');
  });

  it('a locked encrypted memory says so, not "sign in again"', async () => {
    mockRequest.mockRejectedValue(gqlError('SESSION_EXPIRED'));
    const r = await runAction('verifyNode', { _kind: 'verifyNode' });
    expect(r.status).toBe(423);
    expect((messageOf(r) as { text: string }).text).toContain('encrypted and its key');
  });

  it('a failed check says it did not run, without the server text', async () => {
    mockRequest.mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR'));
    const r = await runAction('verifyNode', { _kind: 'verifyNode' });
    expect(r.status).toBe(500);
    expect(messageOf(r)).toEqual({ type: 'error', text: "Verification didn't run. Try again." });
  });
});
