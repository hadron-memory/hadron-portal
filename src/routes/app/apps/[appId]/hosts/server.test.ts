/**
 * portal#2311 — the App's host registrations, read when the Grant-scope
 * dialog opens (not on the Keys tab's first screen: ruling 0273).
 *
 * The gate pin: the read is the server's (`hostRegistrations` is gated to the
 * readers of the App's tasks and events, hrn:node:hadronmemory.com:specs:cor:agt:050:21), run with the CALLER'S
 * token. A refusal answers `{ kind: 'refused' }`, a failure `{ kind: 'failed' }`,
 * and neither is ever an empty host list, so "No hosts are registered" is only
 * ever said about a viewer the server answered for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const requests: { document: string; variables: Record<string, unknown>; token: string }[] = [];
  const read: { mode: 'ok' | 'forbidden' | 'notfound' | 'throw' } = { mode: 'ok' };
  return { requests, read };
});

vi.mock('$lib/server/api', () => ({
  gqlClient: (token: string) => ({
    request: (document: string, variables: Record<string, unknown> = {}) => {
      h.requests.push({ document, variables, token });
      if (h.read.mode === 'forbidden') {
        return Promise.reject({ response: { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] } });
      }
      if (h.read.mode === 'notfound') {
        return Promise.reject({ response: { errors: [{ message: 'no', extensions: { code: 'NOT_FOUND' } }] } });
      }
      if (h.read.mode === 'throw') return Promise.reject(new Error('INTERNAL_SERVER_ERROR: production text'));
      return Promise.resolve({
        hostRegistrations: [
          { hostId: 'h-b', label: 'Beta', live: false },
          { hostId: 'h-a', label: 'Alpha', live: true },
        ],
      });
    },
  }),
}));

beforeEach(() => {
  h.requests.length = 0;
  h.read.mode = 'ok';
});

async function get(locals: Record<string, unknown>, appId = 'a1') {
  const { GET } = await import('./+server');
  const res = (await GET({ params: { appId }, locals } as unknown as Parameters<typeof GET>[0])) as Response;
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe('GET /app/apps/[appId]/hosts (portal#2311)', () => {
  it('refuses with 401 and no read when there is no session', async () => {
    const { status } = await get({ token: null, user: null });
    expect(status).toBe(401);
    expect(h.requests).toHaveLength(0);
  });

  it('reads this App with the caller token and lists hosts by label, never cached', async () => {
    const { status, body, headers } = await get({ token: 'tok', user: { id: 'u1' } }, 'app-7');
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].token).toBe('tok');
    expect(h.requests[0].variables).toEqual({ appRef: 'app-7' });
    expect(body).toEqual({
      kind: 'ok',
      hosts: [
        { hostId: 'h-a', label: 'Alpha', live: true },
        { hostId: 'h-b', label: 'Beta', live: false },
      ],
    });
  });

  it('answers refused (not an empty list) when the server refuses the read', async () => {
    h.read.mode = 'forbidden';
    const { status, body } = await get({ token: 'tok', user: { id: 'u1' } });
    expect(status).toBe(200);
    expect(body).toEqual({ kind: 'refused' });
  });

  it('answers refused for NOT_FOUND too: denied and missing read the same to an outsider, and Retry would never help', async () => {
    h.read.mode = 'notfound';
    const { body } = await get({ token: 'tok', user: { id: 'u1' } });
    expect(body).toEqual({ kind: 'refused' });
  });

  it('answers failed, with no server text, when the read throws', async () => {
    h.read.mode = 'throw';
    const { body } = await get({ token: 'tok', user: { id: 'u1' } });
    expect(body).toEqual({ kind: 'failed' });
    expect(JSON.stringify(body)).not.toContain('production text');
  });
});
