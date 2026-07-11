/**
 * #520 — /app/memories/[id]/clone: thin pass-through that forwards a full
 * `<org>::<slug>` targetUrn to the server's cloneMemory. Mocks the GraphQL
 * client and asserts the forwarded vars + response shaping.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { POST } from './+server';

beforeEach(() => mockRequest.mockReset());

function ev(body: unknown, token: string | null = 'tok', id = 'mem-1') {
  return {
    params: { id },
    request: { json: async () => body },
    locals: { token },
  } as unknown as Parameters<typeof POST>[0];
}

describe('/app/memories/[id]/clone (#520)', () => {
  it('401s without a token', async () => {
    const res = await POST(ev({ targetUrn: 'org::x' }, null));
    expect(res.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('400s when targetUrn is missing/blank (no server call)', async () => {
    const res = await POST(ev({ targetUrn: '   ' }));
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('forwards { ref, targetUrn } and returns the new memory', async () => {
    mockRequest.mockResolvedValue({ cloneMemory: { id: 'mem-2', urn: 'org::x-copy', name: 'X copy' } });
    const res = await POST(ev({ targetUrn: 'org::x-copy' }));
    expect(res.status).toBe(200);
    expect(mockRequest.mock.calls[0][1]).toEqual({ ref: 'mem-1', targetUrn: 'org::x-copy' });
    expect((await res.json()).memory).toMatchObject({ id: 'mem-2' });
  });

  it('surfaces a BAD_USER_INPUT (occupied/invalid target) as a friendly 400', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('taken'), {
        response: {
          errors: [{ message: 'A memory already lives at org::x-copy.', extensions: { code: 'BAD_USER_INPUT' } }],
        },
      }),
    );
    const res = await POST(ev({ targetUrn: 'org::x-copy' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already lives/);
  });
});
