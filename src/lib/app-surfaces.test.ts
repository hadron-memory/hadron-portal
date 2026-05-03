import { describe, expect, it } from 'vitest';
import { hasChatSurface } from './app-surfaces';

describe('hasChatSurface — 008-agent-installation T072 (chat-tab gate)', () => {
  it('returns true when surfaces contains "chat"', () => {
    expect(hasChatSurface(['chat'])).toBe(true);
  });

  it('returns true when surfaces contains "chat" alongside others', () => {
    expect(hasChatSurface(['chat', 'slack'])).toBe(true);
    expect(hasChatSurface(['mcp', 'chat'])).toBe(true);
  });

  it('returns false when surfaces is empty', () => {
    expect(hasChatSurface([])).toBe(false);
  });

  it('returns false when surfaces does not contain "chat"', () => {
    expect(hasChatSurface(['mcp'])).toBe(false);
    expect(hasChatSurface(['mcp', 'slack'])).toBe(false);
  });

  it('returns false on null / undefined (defensive default)', () => {
    expect(hasChatSurface(null)).toBe(false);
    expect(hasChatSurface(undefined)).toBe(false);
  });

  it('does not match substrings of "chat" (deterministic, not includes-by-substring)', () => {
    expect(hasChatSurface(['chatter'])).toBe(false);
    expect(hasChatSurface(['chats'])).toBe(false);
  });
});
