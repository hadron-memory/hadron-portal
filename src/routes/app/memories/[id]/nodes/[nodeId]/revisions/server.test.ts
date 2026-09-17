/**
 * #529/#617 — /app/memories/[id]/nodes/[nodeId]/revisions: the History-tab
 * write actions (restore / delete / clear). Mocks the GraphQL client and
 * asserts the forwarded mutation + variables. (#623 rename: revision*.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { POST } from './+server';
import {
  RESTORE_NODE_REVISION_MUTATION,
  DELETE_NODE_REVISION_MUTATION,
  CLEAR_NODE_HISTORY_MUTATION,
} from '$lib/server/queries';

beforeEach(() => {
  mockRequest.mockReset();
});

function ev(body: unknown, token: string | null = 'tok', nodeId = 'node-1') {
  return {
    params: { id: 'mem-1', nodeId },
    request: { json: async () => body },
    locals: { token },
  } as unknown as Parameters<typeof POST>[0];
}

describe('/app/memories/[id]/nodes/[nodeId]/revisions (#529)', () => {
  it('401s without a token', async () => {
    const res = await POST(ev({ action: 'clear' }, null));
    expect(res.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('restore forwards restoreNodeRevision with truncate:true', async () => {
    mockRequest.mockResolvedValue({ restoreNodeRevision: { id: 'node-1' } });
    const res = await POST(ev({ action: 'restore', revisionId: 'r9' }));
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][0]).toBe(RESTORE_NODE_REVISION_MUTATION);
    expect(mockRequest.mock.calls[0][1]).toEqual({ revisionId: 'r9', truncate: true });
  });

  it('delete forwards deleteNodeRevision', async () => {
    mockRequest.mockResolvedValue({ deleteNodeRevision: true });
    const res = await POST(ev({ action: 'delete', revisionId: 'r9' }));
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][0]).toBe(DELETE_NODE_REVISION_MUTATION);
    expect(mockRequest.mock.calls[0][1]).toEqual({ revisionId: 'r9' });
  });

  it('clear forwards clearNodeHistory with the node id as nodeRef', async () => {
    mockRequest.mockResolvedValue({ clearNodeHistory: 3 });
    const res = await POST(ev({ action: 'clear' }));
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][0]).toBe(CLEAR_NODE_HISTORY_MUTATION);
    expect(mockRequest.mock.calls[0][1]).toEqual({ nodeRef: 'node-1' });
    expect((await res.json()).cleared).toBe(3);
  });

  it('restore/delete require a revisionId (no server call)', async () => {
    expect((await POST(ev({ action: 'restore' }))).status).toBe(400);
    expect((await POST(ev({ action: 'delete' }))).status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an unknown action', async () => {
    const res = await POST(ev({ action: 'nope' }));
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('surfaces a server error as a 500 with the message', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { response: { errors: [{ message: 'write forbidden' }] } }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(ev({ action: 'clear' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/write forbidden/);
  });
});
