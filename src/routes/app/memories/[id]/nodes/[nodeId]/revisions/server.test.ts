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

  it('surfaces an uncoded server error as a generic 500', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { response: { errors: [{ message: 'write forbidden' }] } }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(ev({ action: 'clear' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('Something went wrong on our side.');
  });
});

// portal#1142 S2b (hadron-server#2226; Xylon's gate 6329041498).
describe('restore refused for an include tag', () => {
  const PRIVATE = 'mutation RestoreNodeRevision($revisionId: ID!) PRIVATE-VARS';
  const refusal = (code: string, extensions: Record<string, unknown> = { code, tag: '<img src=x onerror=alert(1)>{{> t}}' }) =>
    Object.assign(new Error(PRIVATE), {
      response: { errors: [{ message: 'Include <b>t</b> names a node you cannot read.', extensions }] },
    });

  it('is a 409 with the server message, the tag and the restore-safe next step', async () => {
    mockRequest.mockRejectedValue(refusal('INCLUDE_TARGET_UNAVAILABLE'));
    const res = await POST(ev({ action: 'restore', revisionId: 'r9' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('INCLUDE_TARGET_UNAVAILABLE');
    expect(body.error).toContain('Include <b>t</b> names a node you cannot read.');
    expect(body.error).toContain('Tag: <img src=x onerror=alert(1)>{{> t}}.');
    expect(body.error).toContain('Nothing was restored, and the node is unchanged.');
    expect(body.error).not.toContain('Your edit is still here');
    expect(body.error).not.toContain('save again');
    expect(JSON.stringify(body)).not.toContain('PRIVATE-VARS');
  });

  it('an S1 code on restore takes the same path', async () => {
    mockRequest.mockRejectedValue(refusal('INCLUDE_CYCLE'));
    expect((await POST(ev({ action: 'restore', revisionId: 'r9' }))).status).toBe(409);
  });

  it('an unknown code or a payloadless error keeps the old 500 fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRequest.mockRejectedValue(refusal('SOMETHING_ELSE'));
    const unknown = await POST(ev({ action: 'restore', revisionId: 'r9' }));
    expect(unknown.status).toBe(500);
    expect((await unknown.json()).error).not.toContain('Nothing was restored');

    mockRequest.mockRejectedValue(Object.assign(new Error(PRIVATE), { response: { errors: [{ message: 'boom' }] } }));
    const payloadless = await POST(ev({ action: 'restore', revisionId: 'r9' }));
    expect(payloadless.status).toBe(500);
    expect(JSON.stringify(await payloadless.json())).not.toContain('PRIVATE-VARS');
  });

  it('delete and clear never take the include path', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRequest.mockRejectedValue(refusal('INCLUDE_TARGET_UNAVAILABLE'));
    expect((await POST(ev({ action: 'delete', revisionId: 'r9' }))).status).toBe(500);
    expect((await POST(ev({ action: 'clear' }))).status).toBe(500);
  });
});
