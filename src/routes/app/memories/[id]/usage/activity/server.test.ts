/**
 * Usage tab chart data: this memory's usageActivity, client-fetched so the
 * browser's time zone reaches the server's day bucketing. Window is clamped to
 * the known presets; failures degrade to an explicit loadFailed payload (the
 * tab's table stays available).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { USAGE_ACTIVITY_QUERY } from '$lib/server/queries';

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => errorSpy.mockRestore());

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
});

async function runGet(search = '') {
  const { GET } = await import('./+server');
  const res = await GET({
    params: { id: 'mem-1' },
    url: new URL(`http://localhost/app/memories/mem-1/usage/activity${search}`),
    locals: { token: 't' },
  } as unknown as Parameters<typeof GET>[0]);
  return { status: res.status, body: await res.json() };
}

describe('GET /app/memories/[id]/usage/activity', () => {
  it('queries usageActivity scoped to this memory with the requested window and zone', async () => {
    mockRequest.mockResolvedValueOnce({
      usageActivity: [{ date: '2026-07-27', reads: 5, writes: 1 }],
    });
    const { status, body } = await runGet('?window=7&tz=Europe%2FBerlin');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      windowDays: 7,
      timeZone: 'Europe/Berlin',
      buckets: [{ date: '2026-07-27', reads: 5, writes: 1 }],
      loadFailed: false,
    });
    const [query, vars] = mockRequest.mock.calls[0];
    expect(query).toBe(USAGE_ACTIVITY_QUERY);
    expect(vars.memoryRefs).toEqual(['mem-1']);
    expect(vars.timeZone).toBe('Europe/Berlin');
    // A 7-day [from, to) window.
    expect(new Date(vars.to).getTime() - new Date(vars.from).getTime()).toBe(7 * 86_400_000);
  });

  it('clamps an unknown window to the 30-day default and defaults the zone to UTC', async () => {
    mockRequest.mockResolvedValueOnce({ usageActivity: [] });
    const { body } = await runGet('?window=12345');
    expect(body).toMatchObject({ windowDays: 30, timeZone: 'UTC' });
  });

  it('degrades to an explicit loadFailed payload on a GraphQL error', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const { status, body } = await runGet('?window=7');
    expect(status).toBe(200);
    expect(body).toMatchObject({ buckets: [], loadFailed: true });
  });
});
