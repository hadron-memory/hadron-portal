/**
 * #992 — POST /app/memories/[id]/approve-all → approveMemoryNodes. Counts and
 * skipped placeholders pass through; failures get fixed copy by code, never
 * the server's text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { APPROVE_MEMORY_NODES_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { POST } from './+server';

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const ev = (token: string | null = 'tok') =>
  ({ params: { id: 'mem-1' }, locals: { token } }) as unknown as Parameters<typeof POST>[0];

function gqlError(code: string) {
  return new ClientError(
    { errors: [{ message: 'server prose with secrets', extensions: { code } }] as never, status: 200, headers: new Headers() } as never,
    { query: '' },
  );
}

describe('approve-all endpoint (#992)', () => {
  it('401s without a token, without calling the server', async () => {
    expect((await POST(ev(null))).status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('approves the memory and returns only the counts and placeholders', async () => {
    mockRequest.mockResolvedValue({
      approveMemoryNodes: { approvedCount: 3, alreadyApprovedCount: 2, skippedPlaceholders: ['p:1'], approved: [{ big: true }], unresolvedFeedback: [{ nodeId: 'n1', urn: 'hrn:node:acme.com:specs:a', loc: 'a', openThreads: 1 }] },
    });
    const res = await POST(ev());
    expect(mockRequest).toHaveBeenCalledWith(APPROVE_MEMORY_NODES_MUTATION, { memoryRef: 'mem-1' });
    expect(await res.json()).toEqual({
      result: { approvedCount: 3, alreadyApprovedCount: 2, skippedPlaceholders: ['p:1'], openFeedback: [{ urn: 'hrn:node:acme.com:specs:a', openThreads: 1 }] },
    });
  });

  it.each([
    ['FORBIDDEN', 403, "don't have permission"],
    ['MEMORY_NOT_FOUND', 404, 'no longer exists'],
    ['SESSION_EXPIRED', 423, 'encrypted and its key'],
    ['INTERNAL_SERVER_ERROR', 500, 'may or may not have gone through'],
  ])('%s → %i with fixed copy', async (code, status, copy) => {
    mockRequest.mockRejectedValue(gqlError(code));
    const res = await POST(ev());
    expect(res.status).toBe(status);
    const { error } = await res.json();
    expect(error).toContain(copy);
    expect(error).not.toContain('server prose');
  });
});
