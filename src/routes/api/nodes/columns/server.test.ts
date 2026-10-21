/**
 * portal#1174 — /api/nodes/columns: the Nodes tab's extra columns for a set of
 * node ids, read through the server's batched `nodeBatch` (cap 200 refs) and
 * trimmed to the six fields the table shows, never content.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

const offersSigning = vi.fn();
vi.mock('$lib/server/signing-capability', () => ({ deploymentOffersSigning: (t: string | null) => offersSigning(t) }));

import { NODE_COLUMNS_QUERY, NODE_COLUMNS_NO_SIGNING_QUERY } from '$lib/server/queries';
import { POST } from './+server';

beforeEach(() => {
  mockRequest.mockReset();
  offersSigning.mockReset();
  offersSigning.mockResolvedValue(true);
});

function ev(body: unknown, token: string | null = 'tok') {
  return { request: { json: async () => body }, locals: { token } } as unknown as Parameters<typeof POST>[0];
}

const node = (id: string) => ({
  id, role: 'spec', updatedAt: '2026-10-20T10:00:00Z', revision: 7,
  approvalStatus: { state: 'APPROVED' }, signatureStatus: { state: 'CURRENT' },
  updatedByAgent: { id: 'a1', name: 'Portal Engineer', urn: 'hrn:agent:x:y' },
  updatedByWorker: { id: 'w1', name: 'Gil', urn: 'hrn:worker:x:y:gil' },
});

describe('/api/nodes/columns (#1174)', () => {
  it('401s without a token', async () => {
    expect((await POST(ev({ refs: ['a'] }, null))).status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('400s on a missing, non-string or oversized refs list without calling the server', async () => {
    for (const body of [{}, { refs: 'a' }, { refs: [1] }, { refs: [] }, { refs: Array.from({ length: 201 }, (_, i) => `n${i}`) }]) {
      expect((await POST(ev(body))).status).toBe(400);
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('asks nodeBatch for the refs and flattens each node to a column row', async () => {
    mockRequest.mockResolvedValue({ nodeBatch: { nodes: [node('a')], unavailable: ['b'], omitted: [], truncated: false } });
    const res = await POST(ev({ refs: ['a', 'b'] }));
    expect(mockRequest).toHaveBeenCalledWith(NODE_COLUMNS_QUERY, { refs: ['a', 'b'] });
    expect(await res.json()).toEqual({
      rows: [{
        id: 'a', role: 'spec', updatedAt: '2026-10-20T10:00:00Z', revision: 7, approval: 'APPROVED', signature: 'CURRENT',
        agent: { id: 'a1', name: 'Portal Engineer', urn: 'hrn:agent:x:y' },
        worker: { id: 'w1', name: 'Gil', urn: 'hrn:worker:x:y:gil' },
      }],
      unavailable: ['b'],
      omitted: [],
      signing: true,
    });
  });

  it('with signing off the query does not select signatureStatus, so the other columns still load (Celine on #1181)', async () => {
    offersSigning.mockResolvedValue(false);
    const { signatureStatus: _drop, ...noSig } = node('a');
    mockRequest.mockResolvedValue({ nodeBatch: { nodes: [noSig], unavailable: [], omitted: [], truncated: false } });
    const body = await (await POST(ev({ refs: ['a'] }))).json();
    expect(mockRequest).toHaveBeenCalledWith(NODE_COLUMNS_NO_SIGNING_QUERY, { refs: ['a'] });
    expect(NODE_COLUMNS_NO_SIGNING_QUERY).not.toContain('signatureStatus');
    expect(NODE_COLUMNS_QUERY).toContain('signatureStatus');
    expect(body.signing).toBe(false);
    expect(body.rows[0]).toMatchObject({ id: 'a', role: 'spec', approval: 'APPROVED', signature: null });
  });

  it('with signing on it asks for the signature too and says so', async () => {
    mockRequest.mockResolvedValue({ nodeBatch: { nodes: [node('a')], unavailable: [], omitted: [], truncated: false } });
    const body = await (await POST(ev({ refs: ['a'] }))).json();
    expect(mockRequest).toHaveBeenCalledWith(NODE_COLUMNS_QUERY, { refs: ['a'] });
    expect(body.signing).toBe(true);
  });

  it('reports omitted refs when the server truncates, never a silent short read', async () => {
    mockRequest.mockResolvedValue({ nodeBatch: { nodes: [node('a')], unavailable: [], omitted: ['b'], truncated: true } });
    const body = await (await POST(ev({ refs: ['a', 'b'] }))).json();
    expect(body.omitted).toEqual(['b']);
  });

  it('a server failure is a 500 with a generic message, not the query or the upstream text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Once, not the persistent form: vitest's spy would leave a floating tracked rejection.
    mockRequest.mockRejectedValueOnce(new Error('SELECT secret FROM nodes'));
    const res = await POST(ev({ refs: ['a'] }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});
