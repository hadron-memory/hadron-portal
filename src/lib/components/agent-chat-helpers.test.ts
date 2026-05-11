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
