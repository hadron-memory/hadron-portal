import { describe, expect, it, vi } from 'vitest';
import {
  CREATE_NODE_MUTATION,
  CREATE_TEAM_CHAT_MESSAGE_MUTATION,
  NODES_BY_LOC_PREFIX_QUERY,
} from '$lib/server/queries';
import { chatAuthorName, isChatNode, loadChatMessages, locSafeAuthor, postChatMessage } from '$lib/server/team-chat';
import type { MemoryNode } from '$lib/types';

function msg(loc: string, over: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: loc, loc, name: 'holger', nodeType: 'chat-message',
    createdAt: '2026-08-14T10:00:00Z', seq: null, content: null, data: null, ...over,
  } as unknown as MemoryNode;
}

function clientReturning(hits: MemoryNode[]) {
  return { request: vi.fn().mockResolvedValue({ findNodes: { hits: hits.map((node) => ({ node })) } }) } as any;
}

describe('isChatNode', () => {
  it('accepts the platform `chat` nodeType and the legacy `team-chat` tag', () => {
    expect(isChatNode({ nodeType: 'chat', tags: [] } as unknown as MemoryNode)).toBe(true);
    expect(isChatNode({ nodeType: 'info', tags: ['team-chat'] } as unknown as MemoryNode)).toBe(true);
    expect(isChatNode({ nodeType: 'info', tags: ['chat'] } as unknown as MemoryNode)).toBe(false);
    expect(isChatNode({ nodeType: 'chat-message', tags: [] } as unknown as MemoryNode)).toBe(false);
    expect(isChatNode(null)).toBe(false);
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

  it('keeps only direct message children, and orders a platform thread by seq', async () => {
    const client = clientReturning([
      msg('chats:team:messages:002-x-iris', { seq: 2 }),
      msg('chats:team:messages:001-y-holger', { seq: 1 }),
      // Off-road content under the prefix (D-2026-08-10-003) — not a message.
      msg('chats:team:messages:notes', { nodeType: 'record', seq: 3 }),
      // Nested under a message (e.g. an attachment).
      msg('chats:team:messages:001-y-holger:attachment', { seq: 4 }),
      // A sibling chat whose loc merely starts with the same characters.
      msg('chats:team-notes:messages:x', { seq: 5 }),
    ]);

    const messages = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(messages.map((m) => m.nodeData.loc)).toEqual([
      'chats:team:messages:001-y-holger',
      'chats:team:messages:002-x-iris',
    ]);
  });

  it('falls back to creation time for a legacy thread with no seq', async () => {
    const client = clientReturning([
      msg('chats:team:messages:b', { nodeType: 'message', createdAt: '2026-08-14T12:00:00Z' }),
      msg('chats:team:messages:a', { nodeType: 'message', createdAt: '2026-08-14T09:00:00Z' }),
    ]);

    const messages = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(messages.map((m) => m.nodeData.loc)).toEqual([
      'chats:team:messages:a',
      'chats:team:messages:b',
    ]);
  });

  it('reads the platform envelope (content + data.authorName) and the legacy one', async () => {
    const client = clientReturning([
      msg('chats:team:messages:001-x-iris', {
        seq: 1, name: '001-Iris', content: 'from content', data: { authorName: 'Iris' } as never,
      }),
      msg('chats:team:messages:002-x-h', {
        seq: 2, nodeType: 'message', data: { body: 'from data', author: 'holger' } as never,
      }),
    ]);

    const messages = await loadChatMessages(client, 'mem-1', 'chats:team');

    // The seq-prefixed node name ("001-Iris") is the last-resort author label;
    // the envelope's authorName wins.
    expect(messages[0]).toMatchObject({ content: 'from content', author: 'Iris', seq: 1 });
    expect(messages[1]).toMatchObject({ content: 'from data', author: 'holger', seq: 2 });
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
  it('posts a platform chat through createTeamChatMessage, never a node write', async () => {
    const client = { request: vi.fn().mockResolvedValue({ createTeamChatMessage: { nodeId: 'm-1', seq: 4 } }) } as any;

    const posted = await postChatMessage(client, {
      memoryId: 'mem-1', chatLoc: 'chats:team', appId: 'app-1',
      author: 'holger', content: 'hello team',
    });

    expect(posted).toEqual({ nodeId: 'm-1' });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(CREATE_TEAM_CHAT_MESSAGE_MUTATION, {
      appRef: 'app-1', body: 'hello team',
    });
  });

  it('falls back to a node create for a legacy chat with no App behind it', async () => {
    const client = { request: vi.fn().mockResolvedValue({ createNode: { id: 'm-1' } }) } as any;

    const posted = await postChatMessage(client, {
      memoryId: 'mem-1',
      chatLoc: 'chats:team',
      author: 'holger',
      content: 'hello team',
      now: new Date('2026-08-14T12:34:56.789Z'),
    });

    expect(posted).toEqual({ nodeId: 'm-1' });
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

  it('keeps a `:`-carrying author out of the legacy loc but verbatim in the payload', async () => {
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
