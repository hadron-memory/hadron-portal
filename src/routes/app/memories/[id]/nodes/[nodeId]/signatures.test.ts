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
 *
 * portal#1022 links half: the Sign affordance creates the signing request and
 * hands over the ceremony page's link verbatim
 * (hrn:node:hadronmemory.com:specs:cor:dmo:130:08) — the portal never runs
 * the ceremony. The same capability answer gates the affordance and the query,
 * and a typed refusal renders portal copy instead of the server's prose.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { NODE_APPROVAL_QUERY, NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_QUERY, NODE_SIGNATURES_QUERY, REQUEST_SIGNATURE_MUTATION } from '$lib/server/queries';
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

function serve(signatures: () => unknown, requestSignature: () => unknown = () => ({})) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_SIGNATURES_QUERY) return signatures();
    if (doc === REQUEST_SIGNATURE_MUTATION) return requestSignature();
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
    signingOffered: Promise<boolean>;
  };
  return data;
}

/** Fires the links-half action exactly as the Sign form does. */
async function requestSignature(fields: Record<string, string> = { revision: '4' }, token: string | null = 'tok') {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return actions.requestSignature({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token },
    request: { formData: async () => fd },
  } as never);
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

  it('exposes the same answer as signingOffered, whatever it is', async () => {
    serve(() => ({ node: { id: 'leaf-pk', revision: 4, signatureStatus: SIGNED } }));
    offersSigning.mockResolvedValue(false);
    expect(await (await load()).signingOffered).toBe(false);
    offersSigning.mockResolvedValue(true);
    expect(await (await load()).signingOffered).toBe(true);
  });
});

describe('node page — Sign affordance (portal#1022 links half)', () => {
  it('hands over the ceremony page link verbatim, pinning the revision on screen', async () => {
    serve(() => ({}), () => ({ requestNodeSignature: { id: 'req-1', ceremonyUrl: 'https://server.example/signing/req-1' } }));
    await expect(requestSignature()).rejects.toMatchObject({
      status: 303,
      location: 'https://server.example/signing/req-1',
    });
    const calls = mockRequest.mock.calls.filter(([doc]) => doc === REQUEST_SIGNATURE_MUTATION);
    expect(calls).toEqual([[REQUEST_SIGNATURE_MUTATION, { nodeRef: 'leaf-pk', expectedRevision: 4 }]]);
  });

  it('asks the deployment first: with signing off, no mutation goes out', async () => {
    offersSigning.mockResolvedValue(false);
    serve(() => ({}), () => {
      throw new Error('the mutation must not be reached');
    });
    const result = await requestSignature();
    expect(result).toMatchObject({ status: 400, data: { requestSignatureError: expect.stringContaining('does not offer node signing') } });
    expect(mockRequest.mock.calls.filter(([doc]) => doc === REQUEST_SIGNATURE_MUTATION)).toEqual([]);
  });

  it('a typed refusal renders portal copy, not the server prose', async () => {
    serve(() => ({}), () => {
      throw refused('REVISION_MISMATCH');
    });
    const result = await requestSignature();
    expect(result).toMatchObject({ status: 400, data: { requestSignatureError: expect.stringContaining('changed since you loaded it') } });
  });

  // Each case pins its own copy by a substring unique to it, so dropping a
  // case from signatureRequestRefusalText fails its row (the generic
  // internal-error line satisfies none of them) instead of passing vacuously
  // the way a bare "no server prose" assertion did.
  it.each([
    ['NODE_NOT_FOUND', 'no longer available'],
    ['ENCRYPTED_MEMORY_NOT_APPLICABLE', 'encrypted'],
    ['COMMENT_NOT_SIGNABLE', 'Comments cannot be signed'],
    ['NODE_IS_PLACEHOLDER', 'placeholder'],
    ['SIGNER_NOT_FOUND', 'could not be found'],
    ['SIGNER_NOT_A_WRITER', 'may not write'],
    ['FORBIDDEN', 'support session'],
  ])('every typed refusal gets its own reader copy (%s)', async (code, expected) => {
    serve(() => ({}), () => {
      throw refused(code);
    });
    const result = await requestSignature();
    expect(result).toMatchObject({
      status: 400,
      data: { requestSignatureError: expect.stringContaining(expected) },
    });
  });

  it('a dead session gets sign-in copy, not the not-offered line (hrn:node:hadronmemory.com:specs:cor:dmo:130:03 lets any reader ask)', async () => {
    // A stale tab after sign-out: the token is null, and the capability gate
    // answers off for that — which must not be reported as the deployment's
    // switch. Both halves pinned: the no-token reason, and that the gate was
    // never asked.
    serve(() => ({}), () => {
      throw new Error('the mutation must not be reached');
    });
    const result = await requestSignature({ revision: '4' }, null);
    expect(result).toMatchObject({ status: 400, data: { requestSignatureError: expect.stringContaining('session has ended') } });
    expect(offersSigning).not.toHaveBeenCalled();
    expect(mockRequest.mock.calls.filter(([doc]) => doc === REQUEST_SIGNATURE_MUTATION)).toEqual([]);
  });

  it('an unknown code keeps the generic line — never a borrowed reason', async () => {
    serve(() => ({}), () => {
      throw refused('SOME_FUTURE_CODE');
    });
    const result = await requestSignature();
    expect(result).toMatchObject({ status: 400, data: { requestSignatureError: expect.stringContaining('Something went wrong') } });
  });

  // Dorian's BLIND P2 (#1860): a missing or malformed revision must never
  // degrade to `undefined` — the server would then pin its CURRENT revision,
  // and the request could be for text the reader never saw. The page's other
  // revision-pinned writes agree: saveNodeText answers no-baseline, the
  // approve forms fail validation. The portal always renders a revision, so
  // the only way here is a tampered or broken form — refuse it, send nothing.
  it.each(['not-a-number', '0', '-3', '2147483648', ''])(
    'a malformed revision (%s) is refused and no mutation goes out',
    async (bad) => {
      serve(() => ({}), () => ({ requestNodeSignature: { id: 'req-2', ceremonyUrl: 'https://server.example/signing/req-2' } }));
      const result = await requestSignature({ revision: bad });
      expect(result).toMatchObject({
        status: 400,
        data: { requestSignatureError: expect.stringContaining('Reload the page') },
      });
      expect(mockRequest.mock.calls.filter(([doc]) => doc === REQUEST_SIGNATURE_MUTATION)).toEqual([]);
    },
  );

  it('a missing revision is refused the same way — the form always sends one', async () => {
    serve(() => ({}), () => ({ requestNodeSignature: { id: 'req-3', ceremonyUrl: 'https://server.example/signing/req-3' } }));
    const result = await requestSignature({});
    expect(result).toMatchObject({
      status: 400,
      data: { requestSignatureError: expect.stringContaining('Reload the page') },
    });
    expect(mockRequest.mock.calls.filter(([doc]) => doc === REQUEST_SIGNATURE_MUTATION)).toEqual([]);
  });
});
