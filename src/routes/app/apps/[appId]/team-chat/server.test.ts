import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEAM_CHAT_MESSAGES_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
});

function msg(seq: number) {
  return { nodeId: `n-${seq}`, seq, body: `m${seq}`, at: '2026-08-27T00:00:00Z', authorName: 'Ada' };
}

async function get(appId = 'app-1') {
  const { GET } = await import('./+server');
  const res = (await GET({
    params: { appId },
    locals: { token: 'tok' },
  } as unknown as Parameters<typeof GET>[0])) as Response;
  return { status: res.status, body: await res.json() };
}

// #785. This endpoint exists so a background tick reads ONE query instead of
// re-running the App page's six-query load, whose failure paths are fatal.
// Everything below is about that: what it returns, and — more importantly —
// what it does when the read fails.
describe('GET /app/apps/[appId]/team-chat', () => {
  it('returns the transcript the page load would have produced', async () => {
    mockRequest.mockResolvedValue({ teamChatMessages: { items: [msg(1), msg(2)], total: 2 } });
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toEqual({ items: [msg(1), msg(2)], total: 2, loadFailed: false });
  });

  it('pages to the TAIL of a thread past the server cap', async () => {
    // Not a re-implementation — this is `loadTeamChatTail`, shared with the
    // page load. `teamChatMessages` is seq-ASCENDING with an offset cursor, so
    // a single `limit: 200` returns the OLDEST 200 and pins a long thread to
    // the start of history, with every new post landing off-page (Codex on
    // #738). Asserted here because the endpoint is now a second caller, and a
    // future "simplification" to one round trip would look harmless.
    mockRequest
      .mockResolvedValueOnce({ teamChatMessages: { items: [msg(1)], total: 500 } })
      .mockResolvedValueOnce({ teamChatMessages: { items: [msg(499), msg(500)], total: 500 } });

    const { body } = await get();
    expect(body.items).toEqual([msg(499), msg(500)]);
    expect(mockRequest).toHaveBeenCalledTimes(2);
    const [, secondVars] = mockRequest.mock.calls[1];
    expect(secondVars).toMatchObject({ offset: 300, limit: 200 });
    expect(mockRequest.mock.calls[0][0]).toBe(TEAM_CHAT_MESSAGES_QUERY);
  });

  it('reports a failed read as loadFailed, with a 200 and NO messages claim', async () => {
    // The whole point of the endpoint. A background poll must not receive
    // something it could mistake for "the page is broken" — that is the
    // behaviour #785 removed. And `items: []` is flagged rather than served as
    // fact, because an empty array on a failed read is the
    // `a-fallback-asserts-what-it-was-written-for` shape: it would render as
    // "there are no messages" when the truth is "we could not tell".
    mockRequest.mockRejectedValue(new Error('boom'));
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.loadFailed).toBe(true);
    expect(body.items).toEqual([]);
  });

  it('passes the caller token through and does not re-implement the gate', async () => {
    // Access control is `teamChatMessages(appRef:)`'s, server-side. A second
    // copy of an authorization rule in the portal is the drift this repo keeps
    // filing issues about, and the weaker copy always wins — so the only thing
    // to assert here is that the App ref reaches the query unmodified.
    mockRequest.mockResolvedValue({ teamChatMessages: { items: [], total: 0 } });
    await get('some-other-app');
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ appRef: 'some-other-app' });
  });
});
