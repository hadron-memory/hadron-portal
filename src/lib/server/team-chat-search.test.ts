import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_HIT_MESSAGE_QUERY, TEAM_CHAT_SEARCH_QUERY } from './queries';
import { searchRefusalOf, searchTeamChat } from './team-chat-search';

const request = vi.fn();
const client = { request } as unknown as Parameters<typeof searchTeamChat>[0];

const match = (seq: number, over: Record<string, unknown> = {}) => ({
  nodeId: `n-${seq}`, urn: `hrn:node:x:y:m${seq}`, seq, channelId: 'ch-1', channelIncarnation: 3, ...over,
});
const page = (items: unknown[], over: Record<string, unknown> = {}) => ({
  teamChatSearch: { items, complete: true, cursor: null, channelId: 'ch-1', channelIncarnation: 3, ...over },
});
const read = (seq: number) => ({
  channelMessages: { items: [{ seq, body: `body ${seq}`, at: '2026-10-30T00:00:00Z', authorName: 'Ada' }] },
});
const gqlError = (code: string) => Object.assign(new Error(code), { response: { errors: [{ extensions: { code } }] } });

beforeEach(() => {
  request.mockReset();
});

describe('searchTeamChat', () => {
  it('reads each hit back pinned to its incarnation, without advancing read state', async () => {
    request.mockResolvedValueOnce(page([match(7)])).mockResolvedValueOnce(read(7));
    const r = await searchTeamChat(client, 'app-1', 'needle', null);
    expect(request).toHaveBeenNthCalledWith(1, TEAM_CHAT_SEARCH_QUERY, { appRef: 'app-1', query: 'needle' });
    // sinceSeq is exclusive: seq - 1 lands on the hit.
    expect(request).toHaveBeenNthCalledWith(2, CHANNEL_HIT_MESSAGE_QUERY, { channelRef: 'ch-1', sinceSeq: 6, expectedIncarnation: 3 });
    expect(CHANNEL_HIT_MESSAGE_QUERY).toMatch(/advanceReadState:\s*false/);
    expect(CHANNEL_HIT_MESSAGE_QUERY).toMatch(/limit:\s*1\b/);
    expect(r).toMatchObject({ ok: true, complete: true, items: [{ seq: 7, body: 'body 7', authorName: 'Ada' }] });
  });

  it('forwards the continuation cursor and the untrimmed query', async () => {
    request.mockResolvedValueOnce(page([], { complete: false, cursor: 'c2' }));
    await searchTeamChat(client, 'app-1', ' a ', 'c1');
    expect(request).toHaveBeenCalledWith(TEAM_CHAT_SEARCH_QUERY, { appRef: 'app-1', query: ' a ', cursor: 'c1' });
  });

  it('keeps an empty incomplete page distinct from an empty complete one', async () => {
    request.mockResolvedValueOnce(page([], { complete: false, cursor: 'c2' }));
    expect(await searchTeamChat(client, 'a', 'zz', null)).toMatchObject({ ok: true, items: [], complete: false, cursor: 'c2' });
  });

  it('leaves a hit whose message cannot be read without text, never as another message', async () => {
    request.mockResolvedValueOnce(page([match(7), match(5)])).mockResolvedValueOnce(read(99)).mockRejectedValueOnce(new Error('boom'));
    const r = await searchTeamChat(client, 'a', 'zz', null);
    expect(r).toMatchObject({ ok: true, items: [{ seq: 7, body: null }, { seq: 5, body: null }] });
  });

  it('refuses the whole page when the channel incarnation changed under the read', async () => {
    request.mockResolvedValueOnce(page([match(7)])).mockRejectedValueOnce(gqlError('CHANNEL_INCARNATION_CHANGED'));
    expect(await searchTeamChat(client, 'a', 'zz', null)).toEqual({ ok: false, code: 'CHANNEL_INCARNATION_CHANGED' });
  });

  it.each([
    'TEAM_CHAT_SEARCH_QUERY_LENGTH', 'TEAM_CHAT_SEARCH_CURSOR_INVALID', 'TEAM_CHAT_SEARCH_ENCRYPTED', 'CHANNEL_NOT_FOUND',
  ])('surfaces %s as a typed refusal, never an empty page', async (code) => {
    request.mockRejectedValueOnce(gqlError(code));
    expect(await searchTeamChat(client, 'a', 'zz', null)).toEqual({ ok: false, code });
  });

  it('reports an unknown or transport failure as FAILED', async () => {
    request.mockRejectedValueOnce(new Error('network'));
    expect(await searchTeamChat(client, 'a', 'zz', null)).toEqual({ ok: false, code: 'FAILED' });
    expect(searchRefusalOf(gqlError('SOMETHING_ELSE'))).toBe('FAILED');
  });
});
