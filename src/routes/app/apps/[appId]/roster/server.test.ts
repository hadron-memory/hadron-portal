/**
 * portal#2238 — the roster endpoint the AI Team grid fetches on first show.
 *
 * The gated acceptance, line by line:
 *  - without a token it refuses with the repo's 401 pattern (grants/list) —
 *    a signed-out caller gets a refusal, not a roster read attempt;
 *  - a failing or hung roster call answers `{ kind: 'failed' }` with status
 *    200 — never a throw, never server text — because this response feeds a
 *    background fetch whose failure must cost the Task/Paused cells, not the
 *    page (the team-chat endpoint's degrade-with-200 contract);
 *  - a good read returns the loader's TeamRosterRead shape, so the page feeds
 *    it to the same reads the loader value goes to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_TEAM_ROSTER_QUERY } from '$lib/server/queries';
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';

const h = vi.hoisted(() => {
  const requests: { document: string; variables: Record<string, unknown> }[] = [];
  const roster: { mode: 'ok' | 'hang' | 'throw' } = { mode: 'ok' };
  return { requests, roster };
});

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({
    request: (document: string, variables: Record<string, unknown> = {}) => {
      h.requests.push({ document, variables });
      if (h.roster.mode === 'hang') return new Promise<never>(() => {});
      if (h.roster.mode === 'throw') return Promise.reject(new Error('INTERNAL_SERVER_ERROR: production text'));
      return Promise.resolve({
        teamRoster: {
          workers: [
            {
              worker: { id: 'w1' }, checkStatus: { status: 'PAUSED', pendingReason: 'TEAM_PAUSED' },
              pausedUntil: null, currentTask: null, heldBy: null, heldAt: null, terminal: null,
            },
          ],
        },
      });
    },
  }),
}));

beforeEach(() => {
  h.requests.length = 0;
  h.roster.mode = 'ok';
});
afterEach(() => vi.useRealTimers());

async function get(locals: Record<string, unknown>) {
  const { GET } = await import('./+server');
  const res = (await GET({
    params: { appId: 'a1' },
    locals,
  } as unknown as Parameters<typeof GET>[0])) as Response;
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe('GET /app/apps/[appId]/roster (portal#2238)', () => {
  it('refuses with 401 and no roster request when there is no session', async () => {
    const { status, body } = await get({ token: null, user: null });
    expect(status).toBe(401);
    expect(body).toEqual({ kind: 'failed' });
    expect(h.requests).toHaveLength(0);
  });

  it('returns the loader TeamRosterRead shape for a signed-in member', async () => {
    const { status, body, headers } = await get({ token: 'tok', user: { id: 'u1' } });
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]?.document).toBe(APP_TEAM_ROSTER_QUERY);
    expect(h.requests[0]?.variables).toMatchObject({ appRef: 'a1' });
    expect(body).toEqual({
      kind: 'ok',
      byWorker: { w1: expect.objectContaining({ worker: { id: 'w1' } }) },
    });
  });

  it('maps a failing roster call to { kind: "failed" }, 200, no server text', async () => {
    h.roster.mode = 'throw';
    const { status, body } = await get({ token: 'tok', user: { id: 'u1' } });
    expect(status).toBe(200);
    expect(body).toEqual({ kind: 'failed' });
  });

  it('bounds a hung roster call at the 8 s optional-list bound, then failed', async () => {
    vi.useFakeTimers();
    h.roster.mode = 'hang';
    const pending = get({ token: 'tok', user: { id: 'u1' } });
    await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS - 1);
    expect(await Promise.race([pending.then(() => true), Promise.resolve(false)])).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const { status, body } = await pending;
    expect(status).toBe(200);
    expect(body).toEqual({ kind: 'failed' });
  });
});
