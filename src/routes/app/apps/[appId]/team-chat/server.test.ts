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

async function get(appId = 'app-1', search = '') {
  const { GET } = await import('./+server');
  const res = (await GET({
    params: { appId },
    // #793: the handler now reads `?beforeSeq=` to serve a scroll-up page, so
    // the event needs a url. Supplied for every call, not just the paging ones,
    // so a test that forgets it fails as a missing FIXTURE rather than as a
    // missing feature.
    url: new URL(`http://localhost/app/apps/${appId}/team-chat${search}`),
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

// #793. The same endpoint serves two reads: the tail (poll, first paint) and
// the page BEFORE a cursor (scroll-up). One route because both answer "give me
// a window of this thread", and a second would be a second place to keep the
// degrade-with-200 contract in step.
describe('GET /app/apps/[appId]/team-chat — scroll-up via beforeSeq', () => {
  it('asks the server for the page preceding the cursor, in ONE request', async () => {
    mockRequest.mockResolvedValue({ teamChatMessages: { items: [msg(8), msg(9)], total: 500 } });
    const { status, body } = await get('app-1', '?beforeSeq=10');

    expect(status).toBe(200);
    expect(body).toEqual({ items: [msg(8), msg(9)], total: 500, loadFailed: false });
    // The tail read pages twice because it has no cursor to start from. This
    // one has a cursor, so the arithmetic — and the second round trip —
    // disappear. A regression to the tail path would show up here as 2.
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(TEAM_CHAT_MESSAGES_QUERY, {
      appRef: 'app-1',
      beforeSeq: 10,
      limit: 200,
    });
  });

  it('passes NO offset alongside the cursor', async () => {
    // The server ignores offset when beforeSeq is given, so sending both would
    // be harmless today and misleading forever — it would read as if the
    // position were positional, which is the thing beforeSeq exists to stop.
    mockRequest.mockResolvedValue({ teamChatMessages: { items: [], total: 500 } });
    await get('app-1', '?beforeSeq=10');
    expect(mockRequest.mock.calls[0][1]).not.toHaveProperty('offset');
  });

  it('refuses a malformed cursor rather than silently serving the tail', async () => {
    // Falling back would re-serve the page the reader already has, which the
    // component reads as "no more history" and stops on — a scroll-up that
    // ends early on a thread with plenty left.
    for (const bad of ['?beforeSeq=0', '?beforeSeq=-3', '?beforeSeq=abc']) {
      const { status, body } = await get('app-1', bad);
      expect(status, bad).toBe(400);
      expect(body.loadFailed, bad).toBe(true);
      expect(body.reason, bad).toBe('bad-cursor');
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('still serves the TAIL when no cursor is given', async () => {
    mockRequest.mockResolvedValue({ teamChatMessages: { items: [msg(1)], total: 1 } });
    const { body } = await get();
    expect(body.items).toEqual([msg(1)]);
    expect(mockRequest.mock.calls[0][1]).not.toHaveProperty('beforeSeq');
  });
});

// #793 (@codex P1 on PR #799). `total` is CURSOR-SCOPED when beforeSeq is
// given — measured against the live server on a 3-message thread:
//
//   tail            items 3, total 3
//   beforeSeq: 3    items 2, total 2
//   beforeSeq: 2    items 1, total 1
//
// So the endpoint faithfully returns a bounded count, and the COMPONENT must
// not adopt it as the full-thread total: doing so shrinks `shownTotal` below
// what is displayed, `canLoadOlder` goes false, and the oldest messages become
// unreachable — on a 500-message thread, seq 1–100 after two pages.
//
// Pinned here because the endpoint is where the shape is observable; the
// component-side rule (keep the tail's total) has no test surface in this repo
// until #795 lands.
describe('GET /app/apps/[appId]/team-chat — total is bounded by the cursor', () => {
  it('passes the server count through unchanged, bounded or not', async () => {
    mockRequest.mockResolvedValue({ teamChatMessages: { items: [msg(1)], total: 1 } });
    const { body } = await get('app-1', '?beforeSeq=2');
    // NOT rewritten to look like a full-thread count: the endpoint reports what
    // the server said, and the caller is responsible for knowing which it is.
    expect(body.total).toBe(1);
  });

  it('refuses a non-integer cursor rather than passing it to an Int variable', async () => {
    // `Number()` accepts 10.5 and 10e2; the GraphQL variable is an Int, so
    // these become a runtime GraphQL error or an unintended cursor instead of
    // the clean 400 the guard exists to produce (@copilot on #799).
    for (const bad of ['?beforeSeq=10.5', '?beforeSeq=1e999', '?beforeSeq=Infinity']) {
      const { status, body } = await get('app-1', bad);
      expect(status, bad).toBe(400);
      expect(body.reason, bad).toBe('bad-cursor');
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('still accepts a plain positive integer', async () => {
    mockRequest.mockResolvedValue({ teamChatMessages: { items: [], total: 0 } });
    const { status } = await get('app-1', '?beforeSeq=10e2');
    // 10e2 IS 1000 numerically but is not a decimal integer literal; the guard
    // uses Number.isSafeInteger on the parsed value, so this one passes — the
    // check is about the VALUE being a safe integer, not the spelling.
    expect(status).toBe(200);
  });
});
