/**
 * portal#1524: the edge editor's per-node target read. Three answers that the
 * page must tell apart: found, the server says there is no such node, and the
 * read FAILED (which is not "no such node").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => mockRequest.mockReset());

async function get(qs: string, token: string | null = 'tok') {
  const { GET } = await import('./+server');
  return GET({ url: new URL(`http://localhost/api/nodes/resolve${qs}`), locals: { token } } as never);
}

describe('GET /api/nodes/resolve', () => {
  it('found: returns the node, scoped to the memory', async () => {
    mockRequest.mockResolvedValue({ node: { id: 'n1', loc: 'a:b', name: 'B' } });
    const res = await get('?memoryId=m1&ref=a%3Ab');
    expect(await res.json()).toEqual({ found: true, node: { id: 'n1', loc: 'a:b', name: 'B' } });
    expect(mockRequest.mock.calls[0][1]).toEqual({ ref: 'a:b', memoryRef: 'm1' });
  });

  it('not found: the server says null, and only then is it "found: false"', async () => {
    mockRequest.mockResolvedValue({ node: null });
    const res = await get('?memoryId=m1&ref=nope');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
  });

  it('a failed read is a 502, never "found: false"', async () => {
    mockRequest.mockRejectedValue(new Error('boom'));
    const res = await get('?memoryId=m1&ref=a');
    expect(res.status).toBe(502);
    expect(await res.json()).not.toHaveProperty('found');
  });

  it('refuses without a session and without both params, before any read', async () => {
    expect((await get('?memoryId=m1&ref=a', null)).status).toBe(401);
    expect((await get('?memoryId=m1')).status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
