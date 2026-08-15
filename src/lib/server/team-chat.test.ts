import { describe, expect, it, vi } from 'vitest';
import { CREATE_NODE_MUTATION, NODES_BY_LOC_PREFIX_QUERY } from '$lib/server/queries';
import { chatAuthorName, isTeamChatNode, loadChatMessages, locSafeAuthor, postChatMessage } from '$lib/server/team-chat';
import type { MemoryNode } from '$lib/types';

function msg(loc: string, over: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: loc, loc, name: 'holger', createdAt: '2026-08-14T10:00:00Z',
    content: null, data: null, ...over,
  } as unknown as MemoryNode;
}

function clientReturning(hits: MemoryNode[]) {
  return { request: vi.fn().mockResolvedValue({ findNodes: { hits: hits.map((node) => ({ node })) } }) } as any;
}

describe('isTeamChatNode', () => {
  it('is true only for the `team-chat` tag', () => {
    expect(isTeamChatNode({ tags: ['team-chat'] } as MemoryNode)).toBe(true);
    expect(isTeamChatNode({ tags: ['chat'] } as MemoryNode)).toBe(false);
    expect(isTeamChatNode({ tags: [] } as unknown as MemoryNode)).toBe(false);
    expect(isTeamChatNode(null)).toBe(false);
  });
});

describe('loadChatMessages', () => {
  it('queries the `<loc>:messages:` prefix within the memory', async () => {
    const client = clientReturning([]);
    await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(client.request).toHaveBeenCalledWith(NODES_BY_LOC_PREFIX_QUERY, {
      memoryId: 'mem-1', locPrefix: 'chats:team:messages:', limit: 2000,
    });
  });

  it('keeps only direct message children, oldest first', async () => {
    const client = clientReturning([
      msg('chats:team:messages:b', { createdAt: '2026-08-14T12:00:00Z' }),
      msg('chats:team:messages:a', { createdAt: '2026-08-14T09:00:00Z' }),
      // Nested under a message (e.g. an attachment) — not a message itself.
      msg('chats:team:messages:a:attachment'),
      // A sibling whose loc merely starts with the same characters.
      msg('chats:team-notes:messages:x'),
    ]);

    const messages = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(messages.map((m) => m.nodeData.loc)).toEqual([
      'chats:team:messages:a',
      'chats:team:messages:b',
    ]);
  });

  it('reads the body from content, falling back to data.body, and the author from data', async () => {
    const client = clientReturning([
      msg('chats:team:messages:a', { content: 'from content' }),
      msg('chats:team:messages:b', { data: { body: 'from data', author: 'iris' } as never }),
    ]);

    const messages = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(messages[0]).toMatchObject({ content: 'from content', author: 'holger' });
    expect(messages[1]).toMatchObject({ content: 'from data', author: 'iris' });
  });
});

describe('chatAuthorName', () => {
  it('prefers handle, then githubUsername, then name, then the email local part', () => {
    expect(chatAuthorName({ handle: 'h', githubUsername: 'gh', name: 'N', email: 'e@x.com' })).toBe('h');
    expect(chatAuthorName({ githubUsername: 'gh', email: 'e@x.com' })).toBe('gh');
    expect(chatAuthorName({ name: 'N', email: 'e@x.com' })).toBe('N');
    expect(chatAuthorName({ email: 'e@x.com' })).toBe('e');
    expect(chatAuthorName({})).toBe('anon');
  });
});

describe('locSafeAuthor', () => {
  it('squashes loc separators so a message cannot land a level deeper', () => {
    // A `:` would make loadChatMessages read the message as nested and drop it.
    expect(locSafeAuthor('Jane: Ops')).toBe('Jane-Ops');
    expect(locSafeAuthor('hrn:node:acme.com:m:x')).toBe('hrn-node-acme.com-m-x');
    expect(locSafeAuthor('a/b c')).toBe('a-b-c');
  });

  it('leaves an already-safe handle alone and never yields an empty segment', () => {
    expect(locSafeAuthor('holger')).toBe('holger');
    expect(locSafeAuthor('holger.s_1-x')).toBe('holger.s_1-x');
    expect(locSafeAuthor(':::')).toBe('anon');
  });
});

describe('postChatMessage', () => {
  it('creates a message node at a fresh timestamped loc under the chat', async () => {
    const client = { request: vi.fn().mockResolvedValue({ createNode: { id: 'm-1' } }) } as any;

    const created = await postChatMessage(client, {
      memoryId: 'mem-1',
      chatLoc: 'chats:team',
      author: 'holger',
      content: 'hello team',
      now: new Date('2026-08-14T12:34:56.789Z'),
    });

    expect(created).toEqual({ id: 'm-1' });
    expect(client.request).toHaveBeenCalledWith(CREATE_NODE_MUTATION, {
      input: {
        memoryId: 'mem-1',
        loc: 'chats:team:messages:2026-08-14T123456789-holger',
        name: 'holger',
        nodeType: 'message',
        data: { body: 'hello team', author: 'holger' },
      },
    });
  });

  it('keeps a `:`-carrying author out of the loc but verbatim in the payload', async () => {
    const client = { request: vi.fn().mockResolvedValue({ createNode: { id: 'm-1' } }) } as any;

    await postChatMessage(client, {
      memoryId: 'mem-1',
      chatLoc: 'chats:team',
      author: 'Jane: Ops',
      content: 'hi',
      now: new Date('2026-08-14T12:34:56.789Z'),
    });

    expect(client.request).toHaveBeenCalledWith(CREATE_NODE_MUTATION, {
      input: expect.objectContaining({
        loc: 'chats:team:messages:2026-08-14T123456789-Jane-Ops',
        name: 'Jane: Ops',
        data: { body: 'hi', author: 'Jane: Ops' },
      }),
    });
  });
});
