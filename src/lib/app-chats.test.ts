import { describe, expect, it } from 'vitest';
import {
  AGENT_CHAT_KEY,
  TEAM_CHAT_LOC,
  buildAppChatList,
  withRegisteredChannels,
  chatFullViewFromParams,
  resolveSelectedChat,
  sortChatMessages,
  withChatView,
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
    expect(list).toEqual([
      { key: TEAM_CHAT_LOC, labelKey: 'app.chats.team', label: 'Team chat', kind: 'team' },
    ]);
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

  it('gives the well-known entries an i18n key and a discovered chat none', () => {
    // The helper runs in the LOADER, so a label localized here would be baked
    // into the payload before the renderer sees it. Well-known entries carry a
    // key for the component to translate; a discovered chat's label is its own
    // name — content, not UI copy, with nothing to translate.
    const list = buildAppChatList([root('chats:a-b', 'A & B')], { hasAgentChat: true });
    expect(list.map((c) => c.labelKey)).toEqual(['app.chats.agent', 'app.chats.team', null]);
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

describe('chatFullViewFromParams', () => {
  it('reads ?view=full as the full view', () => {
    expect(chatFullViewFromParams(new URLSearchParams('view=full'))).toBe(true);
  });

  // The default view is the tab; a malformed value must land there rather
  // than anywhere surprising — the worst case of a bad value is the ordinary
  // page.
  it('treats anything else as the default view', () => {
    expect(chatFullViewFromParams(new URLSearchParams(''))).toBe(false);
    expect(chatFullViewFromParams(new URLSearchParams('view='))).toBe(false);
    expect(chatFullViewFromParams(new URLSearchParams('view=FULL'))).toBe(false);
    expect(chatFullViewFromParams(new URLSearchParams('view=maximised'))).toBe(false);
  });
});

describe('withChatView', () => {
  const base = new URL('https://portal.test/app/apps/a1?tab=chats&chat=chats%3Ateam');

  it('adds ?view=full and keeps the chat selection', () => {
    const full = withChatView(base, true);
    expect(full.searchParams.get('view')).toBe('full');
    expect(full.searchParams.get('tab')).toBe('chats');
    expect(full.searchParams.get('chat')).toBe('chats:team');
  });

  it('removes the param on the way back, rather than writing view=', () => {
    const back = withChatView(withChatView(base, true), false);
    expect(back.searchParams.has('view')).toBe(false);
    expect(back.href).toBe(base.href);
  });

  // The tab buttons change UI state without rewriting `?tab=`, so the URL
  // the reader maximises from can name another tab. The full view is only
  // ever the team chat's; a link to it must reload as the team chat.
  it('canonicalizes the tab and chat when entering the full view', () => {
    const fromWorklog = new URL('https://portal.test/app/apps/a1?tab=worklog&worklogKind=pr');
    const full = withChatView(fromWorklog, true);
    expect(full.searchParams.get('tab')).toBe('chats');
    expect(full.searchParams.get('chat')).toBe('chats:team');
    expect(full.searchParams.get('view')).toBe('full');
    // Unrelated state is kept.
    expect(full.searchParams.get('worklogKind')).toBe('pr');
  });

  it('leaves the selection alone when exiting', () => {
    const back = withChatView(new URL('https://portal.test/app/apps/a1?tab=chats&chat=chats%3Ateam&view=full'), false);
    expect(back.searchParams.get('tab')).toBe('chats');
    expect(back.searchParams.get('chat')).toBe('chats:team');
  });

  it('round-trips through chatFullViewFromParams', () => {
    expect(chatFullViewFromParams(withChatView(base, true).searchParams)).toBe(true);
    expect(chatFullViewFromParams(withChatView(base, false).searchParams)).toBe(false);
  });

  it('does not mutate its input', () => {
    withChatView(base, true);
    expect(base.searchParams.has('view')).toBe(false);
  });
});


describe('registered Channels (#1033)', () => {
  it('uses server identities, retains unambiguous loc links, and does not duplicate the default team', () => {
    const channels = [
      { id: 'team', name: 'Team', loc: 'chats:team', chatRootUrn: null, memory: { id: 'm1' } },
      { id: 'pair', name: 'Ada & Fiona', loc: 'chats:ada-fiona', chatRootUrn: 'hrn:node:acme.com:shared:chats:ada-fiona', memory: { id: 'm1' } },
    ];
    const list = withRegisteredChannels(buildAppChatList([root('chats:ada-fiona', 'Ada & Fiona', 'm1')], { hasAgentChat: false }), channels, 'team');
    expect(list).toHaveLength(2);
    expect(resolveSelectedChat(list, 'chats:ada-fiona').selected?.channelId).toBe('pair');
    expect(resolveSelectedChat(list, channels[1].chatRootUrn).selected?.channelId).toBe('pair');
  });
  it('does not alias two memories channels with the same loc to one arbitrary target', () => {
    const list = withRegisteredChannels(buildAppChatList([], { hasAgentChat: false }), ['one', 'two'].map(id => ({ id, name: 'Same', loc: 'chats:pair', chatRootUrn: null, memory: { id } })));
    expect(resolveSelectedChat(list, 'chats:pair').requestedMissing).toBe(true);
    expect(resolveSelectedChat(list, 'one').selected?.channelId).toBe('one');
  });
});


it('keeps registered Channels usable in the selector when their host memory record is concealed', () => {
  const channels = [{ id: 'private-channel', name: 'Room', loc: 'chats:room', chatRootUrn: null, memoryId: 'm1', memory: null }];
  const list = withRegisteredChannels(buildAppChatList([root('chats:room', 'Room', 'm1')], { hasAgentChat: false }), channels);
  expect(list.filter(c => c.key === 'chats:room')).toHaveLength(0);
  expect(resolveSelectedChat(list, 'private-channel').selected?.channelId).toBe('private-channel');
  expect(resolveSelectedChat(list, 'private-channel').selected?.memoryId).toBe('m1');
});
