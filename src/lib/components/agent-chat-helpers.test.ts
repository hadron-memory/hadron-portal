import { describe, it, expect } from 'vitest';
import type { Chat } from '$lib/types';
import { resolveActiveChatFromUrl } from './agent-chat-helpers.js';

function chat(loc: string): Chat {
  return {
    id: loc,
    loc,
    title: '',
    conversationName: null,
    stageName: null,
    messageCount: 0,
    createdAt: '',
    lastMessageAt: null,
    scope: 'private',
    createdBy: null,
  };
}

describe('resolveActiveChatFromUrl', () => {
  it('returns the chat id when ?chat=<id> matches a persisted chat', () => {
    const url = new URL('http://localhost/x?chat=chat-1');
    expect(resolveActiveChatFromUrl(url, [chat('chat-1'), chat('chat-2')])).toBe('chat-1');
  });

  it('returns null when the URL has no ?chat param', () => {
    const url = new URL('http://localhost/x');
    expect(resolveActiveChatFromUrl(url, [chat('chat-1')])).toBeNull();
  });

  it('returns null when ?chat=<id> refers to a chat not in the list (e.g. deleted)', () => {
    const url = new URL('http://localhost/x?chat=gone');
    expect(resolveActiveChatFromUrl(url, [chat('chat-1')])).toBeNull();
  });

  it('returns null on empty list even when ?chat is set', () => {
    const url = new URL('http://localhost/x?chat=chat-1');
    expect(resolveActiveChatFromUrl(url, [])).toBeNull();
  });
});

describe('constrained App legacy resolution', () => {
  const legacy = new URL('https://example.test/app/apps/app?chat=chat-1');
  it('recovers only when the App proves its selector is unresolved', () => {
    expect(resolveActiveChatFromUrl(legacy, [chat('chat-1')], { appChat: true, allowLegacyAppChat: true })).toBe('chat-1');
    expect(resolveActiveChatFromUrl(legacy, [chat('chat-1')], { appChat: true })).toBeNull();
  });
  it('never looks beyond the filtered personal list', () => {
    expect(resolveActiveChatFromUrl(legacy, [chat('other')], { appChat: true, allowLegacyAppChat: true })).toBeNull();
  });
  it('does not reinterpret an explicit personal parameter, including an empty one', () => {
    for (const value of ['other', '']) {
      const url = new URL(legacy); url.searchParams.set('agentChat', value);
      expect(resolveActiveChatFromUrl(url, [chat('chat-1')], { appChat: true, allowLegacyAppChat: true })).toBeNull();
    }
  });
});
