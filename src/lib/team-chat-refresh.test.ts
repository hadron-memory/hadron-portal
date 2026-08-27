import { describe, expect, it } from 'vitest';
import { TEAM_CHAT_POLL_MS, isAtBottom } from './team-chat-refresh';

// #754. `isAtBottom` decides whether a refreshed transcript scrolls to the
// newest message. It is the whole difference between a chat that keeps up and
// one that yanks a reader out of the history they are reading every few
// seconds — the transcript used to scroll unconditionally, which was harmless
// only because `messages` changed just once, when the viewer posted.
describe('isAtBottom', () => {
  const el = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({
    scrollTop,
    scrollHeight,
    clientHeight,
  });

  it('is true at the exact bottom', () => {
    expect(isAtBottom(el(600))).toBe(true); // 1000 - 600 - 400 === 0
  });

  it('is true within the slack, and false past it', () => {
    // Slack exists so a fractional offset or a late-loading avatar does not
    // silently strand a reader who is, to the eye, at the bottom.
    expect(isAtBottom(el(521))).toBe(true); // 79px away
    expect(isAtBottom(el(520))).toBe(true); // exactly 80px — inclusive
    expect(isAtBottom(el(519))).toBe(false); // 81px away
  });

  it('is false when the reader has scrolled up to read history', () => {
    expect(isAtBottom(el(0))).toBe(false);
    expect(isAtBottom(el(100))).toBe(false);
  });

  it('honours a caller-supplied slack', () => {
    expect(isAtBottom(el(0), 600)).toBe(true);
    expect(isAtBottom(el(0), 599)).toBe(false);
  });

  it('defaults to STICKING when there is no element yet', () => {
    // First render and SSR. The default has to be "stick": a chat that opens
    // part-way up its own history reads as broken, and there is no reader
    // scroll position to preserve yet.
    expect(isAtBottom(null)).toBe(true);
  });

  it('is true when the transcript is shorter than its viewport', () => {
    // Nothing to scroll: scrollHeight <= clientHeight. A short thread must not
    // be treated as "scrolled up", or it would never stick.
    expect(isAtBottom(el(0, 200, 400))).toBe(true);
  });
});

describe('the refresh contract', () => {

  it('polls in the 5–10s band the issue asked for', () => {
    // #754 scoped this as "refresh interval, not architecture". Faster is a
    // load decision, not a UI tweak: each tick re-runs the App page's
    // six-query load.
    expect(TEAM_CHAT_POLL_MS).toBeGreaterThanOrEqual(5000);
    expect(TEAM_CHAT_POLL_MS).toBeLessThanOrEqual(10000);
  });
});
