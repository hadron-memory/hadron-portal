/**
 * portal#1022 — the node page reads passkey signatures (hadron-server#1864) as
 * a request of its own, bound to the rendered revision. A refusal there (the
 * server's signing switch, hadron-server#1895) leaves the signatures unshown
 * and never takes the approval read down with it.
 *
 * portal#1022 gate: `Node.signatureStatus` exists only while the deployment
 * offers signing, so selecting it with signing off fails GraphQL validation on
 * every node view. The page asks the deployment first and, when it says off,
 * sends no signature query at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { NODE_APPROVAL_QUERY, NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY, NODE_SIGNATURES_QUERY } from '$lib/server/queries';
import type { NodeApprovalStatus } from '$lib/node-approval';
import type { NodeSignatureStatus } from '$lib/node-signatures';
import type { ProvenanceResult } from '$lib/node-provenance';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
const offersSigning = vi.fn();
vi.mock('$lib/server/signing-capability', () => ({
  deploymentOffersSigning: (token: string) => offersSigning(token),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  offersSigning.mockReset().mockResolvedValue(true);
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
const SIGNED: NodeSignatureStatus = {
  state: 'CURRENT', integrityProblems: 0,
  signatures: [{ id: 's1', signer: { handle: 'holger', urn: null }, passkeyLabel: 'YubiKey', passkeyRevokedAt: null, revision: 4, verifiedAt: '2026-10-14T10:00:00Z', state: 'CURRENT' }],
};

function refused(code: string) {
  return new ClientError(
    { errors: [{ message: 'server prose', extensions: { code } }] as never, status: 200, headers: new Headers() } as never,
    { query: '' },
  );
}

function serve(signatures: () => unknown) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_SIGNATURES_QUERY) return signatures();
    if (doc === NODE_APPROVAL_QUERY) return { node: { id: 'leaf-pk', revision: 4, approvalStatus: APPROVED, mintStatus: null } };
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 } };
  });
}

async function load() {
  const { load } = await import('./+page.server');
  const data = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
    parent: vi.fn().mockResolvedValue({
      graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo' }],
      graph: { urn: 'hrn:mem:acme.com:mem-a' },
      isConsumerMode: false,
      activeOrgId: 'org-1',
    }),
  } as never)) as unknown as {
    signatures: Promise<ProvenanceResult<NodeSignatureStatus>>;
    approval: Promise<ProvenanceResult<NodeApprovalStatus>>;
  };
  return data;
}

describe('node page — signature status (portal#1022)', () => {
  it('reads the signatures for the node on screen, in their own request', async () => {
    serve(() => ({ node: { id: 'leaf-pk', revision: 4, signatureStatus: SIGNED } }));
    const data = await load();
    expect(await data.signatures).toEqual({ ok: true, value: SIGNED });
    const calls = mockRequest.mock.calls.filter(([doc]) => doc === NODE_SIGNATURES_QUERY);
    expect(calls).toEqual([[NODE_SIGNATURES_QUERY, { ref: 'leaf-pk' }]]);
    expect(NODE_APPROVAL_QUERY).not.toContain('signatureStatus');
  });

  it('withholds a read describing another revision', async () => {
    serve(() => ({ node: { id: 'leaf-pk', revision: 5, signatureStatus: SIGNED } }));
    expect(await (await load()).signatures).toEqual({ ok: false, changed: true });
  });

  it('a refused signature read leaves the signatures unshown and the approval intact', async () => {
    serve(() => { throw refused('FORBIDDEN'); });
    const data = await load();
    expect(await data.signatures).toEqual({ ok: false });
    expect(await data.approval).toEqual({ ok: true, value: APPROVED });
  });

  it('signing off: no signature query goes out, and the approval is untouched', async () => {
    offersSigning.mockResolvedValue(false);
    serve(() => ({ node: { id: 'leaf-pk', revision: 4, signatureStatus: SIGNED } }));
    const data = await load();
    expect(await data.signatures).toEqual({ ok: false });
    expect(await data.approval).toEqual({ ok: true, value: APPROVED });
    expect(mockRequest.mock.calls.filter(([doc]) => String(doc).includes('signatureStatus'))).toEqual([]);
    expect(offersSigning).toHaveBeenCalledWith('tok');
  });

  it('signing on: the signatures still render', async () => {
    offersSigning.mockResolvedValue(true);
    serve(() => ({ node: { id: 'leaf-pk', revision: 4, signatureStatus: SIGNED } }));
    expect(await (await load()).signatures).toEqual({ ok: true, value: SIGNED });
  });
});
