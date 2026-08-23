import { describe, expect, it } from 'vitest';
import {
  AGENT_CHAT_KEY,
  TEAM_CHAT_LOC,
  buildAppChatList,
  resolveSelectedChat,
  sortChatMessages,
} from './app-chats';

const root = (loc: string, name?: string | null, memoryId = 'mem-1') => ({
  loc,
  name,
  memoryId,
  nodeType: 'chat',
});

describe('buildAppChatList', () => {
  it('leads with the agent chat and the team chat, then the rest alphabetically', () => {
    const list = buildAppChatList([root('chats:zoe-amy', 'Zoe & Amy'), root('chats:bob-amy', 'Amy & Bob')], {
      hasAgentChat: true,
    });
    expect(list.map((c) => c.label)).toEqual(['Agent chat', 'Team chat', 'Amy & Bob', 'Zoe & Amy']);
    expect(list.map((c) => c.kind)).toEqual(['agent', 'team', 'other', 'other']);
  });

  it('omits the agent chat when the App has none, but never the team chat', () => {
    // An App whose team chat is not bootstrapped still offers it — that is how
    // the first message gets posted, the same reasoning as the Staff tab.
    const list = buildAppChatList([], { hasAgentChat: false });
    expect(list).toEqual([{ key: TEAM_CHAT_LOC, label: 'Team chat', kind: 'team' }]);
  });

  it('does not list the team chat twice when it comes back from discovery', () => {
    // appNodes returns chats:team like any other chat root; it already has a
    // typed entry with a real read behind it, so the discovered copy is dropped.
    const list = buildAppChatList([root(TEAM_CHAT_LOC, 'Team chat'), root('chats:a-b', 'A & B')], {
      hasAgentChat: false,
    });
    expect(list.filter((c) => c.key === TEAM_CHAT_LOC)).toHaveLength(1);
    expect(list.find((c) => c.key === TEAM_CHAT_LOC)!.kind).toBe('team');
  });

  it('falls back to the last loc segment for an unnamed chat', () => {
    const list = buildAppChatList([root('chats:holger-fred', null)], { hasAgentChat: false });
    expect(list.find((c) => c.kind === 'other')!.label).toBe('holger-fred');
  });

  it('falls back for a whitespace-only name too', () => {
    // A blank label is worse than an ugly one: it makes the row unclickable in
    // practice. `||` on a trimmed string, not `??`, which would keep the spaces.
    const list = buildAppChatList([root('chats:holger-fred', '   ')], { hasAgentChat: false });
    expect(list.find((c) => c.kind === 'other')!.label).toBe('holger-fred');
  });

  it('carries the memory id, which the message read needs', () => {
    const list = buildAppChatList([root('chats:a-b', 'A & B', 'mem-9')], { hasAgentChat: false });
    expect(list.find((c) => c.kind === 'other')!.memoryId).toBe('mem-9');
  });
});

describe('resolveSelectedChat', () => {
  const list = buildAppChatList([root('chats:a-b', 'A & B')], { hasAgentChat: true });

  it('defaults to the first entry when nothing is requested', () => {
    expect(resolveSelectedChat(list, null).selected!.key).toBe(AGENT_CHAT_KEY);
    expect(resolveSelectedChat(list, null).requestedMissing).toBe(false);
  });

  it('honours an explicit request', () => {
    const { selected, requestedMissing } = resolveSelectedChat(list, 'chats:a-b');
    expect(selected!.key).toBe('chats:a-b');
    expect(requestedMissing).toBe(false);
  });

  it('REPORTS a request it could not honour rather than silently substituting', () => {
    // A deleted chat, or one this viewer cannot read, must not quietly render
    // as the default — the reader followed a link to something specific.
    const { selected, requestedMissing } = resolveSelectedChat(list, 'chats:gone');
    expect(selected!.key).toBe(AGENT_CHAT_KEY);
    expect(requestedMissing).toBe(true);
  });

  it('handles an App with no chats at all', () => {
    expect(resolveSelectedChat([], null)).toEqual({ selected: null, requestedMissing: false });
    expect(resolveSelectedChat([], 'chats:x')).toEqual({ selected: null, requestedMissing: true });
  });
});

describe('sortChatMessages', () => {
  it('orders by loc, which is the allocated sequence', () => {
    const nodes = [
      { loc: 'chats:t:messages:003-c-gil' },
      { loc: 'chats:t:messages:001-a-ada' },
      { loc: 'chats:t:messages:002-b-dara' },
    ];
    expect(sortChatMessages(nodes).map((n) => n.loc.split(':').pop())).toEqual([
      '001-a-ada',
      '002-b-dara',
      '003-c-gil',
    ]);
  });

  it('does not mutate its input', () => {
    const nodes = [{ loc: 'b' }, { loc: 'a' }];
    sortChatMessages(nodes);
    expect(nodes.map((n) => n.loc)).toEqual(['b', 'a']);
  });
});
