/**
 * #1226 / hadron-server#2211 — the user picker names its page size (20) and
 * reports the server's total, so a broad query is never shown as the full answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { POST } from './+server';

beforeEach(() => {
  mockRequest.mockReset();
});

function ev(body: unknown, token: string | null = 'tok') {
  return { request: { json: async () => body }, locals: { token } } as unknown as Parameters<typeof POST>[0];
}

const row = (i: number) => ({ id: `u${i}`, handle: `h${i}`, urn: null, githubUsername: null, avatarUrl: null, name: 'N', email: `a${i}@x.org` });

describe('/api/users/search (#1226)', () => {
  it('asks for an explicit page of 20 and returns the total', async () => {
    mockRequest.mockResolvedValueOnce({ users: { items: [row(1), row(2)], total: 63 } });
    const res = await POST(ev({ query: 'smith' }));
    expect(mockRequest.mock.calls[0][1]).toEqual({ query: 'smith', limit: 20 });
    const body = await res.json();
    expect(body.total).toBe(63);
    expect(body.users).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('a1@x.org');
  });

  it('falls back to the row count when the server omits total', async () => {
    mockRequest.mockResolvedValueOnce({ users: { items: [row(1)] } });
    expect((await (await POST(ev({ query: 'smith' }))).json()).total).toBe(1);
  });
});
