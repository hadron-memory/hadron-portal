import { describe, expect, it } from 'vitest';
import {
  TEAM_CHAT_POLL_MS,
  isAtBottom,
  mergeTranscript,
  scrollTopAfterPrepend,
} from './team-chat-refresh';
import type { TeamChatMessage } from '$lib/types';

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
    // #754 scoped this as "refresh interval, not architecture", and the band is
    // the whole of that scope: the number is a product decision, not a UI tweak.
    //
    // This comment used to justify the band by what a tick COST — "each tick
    // re-runs the App page's six-query load". #785 made that false: the tick
    // reads `team-chat/+server.ts`, which is one `teamChatMessages` request (two
    // once the thread is past the page cap, since `loadTeamChatTail` pages to
    // reach the end). So the cost argument is much weaker than it was, and it is
    // not what holds the band any more — the issue asking for it is.
    expect(TEAM_CHAT_POLL_MS).toBeGreaterThanOrEqual(5000);
    expect(TEAM_CHAT_POLL_MS).toBeLessThanOrEqual(10000);
  });
});

function msg(seq: number, over: Partial<TeamChatMessage> = {}): TeamChatMessage {
  return {
    nodeId: `n${seq}`,
    seq,
    body: `m${seq}`,
    at: '2026-08-31T00:00:00Z',
    authorUserId: 'u1',
    authorWorkerId: null,
    authorName: 'holger',
    sessionId: null,
    replyToSeq: null,
    mentions: [],
    ...over,
  };
}

// #793. Prepending older messages pushes everything the reader is looking at
// downwards by exactly the height added. Without this the view jumps backwards
// the instant a page of history lands — the hesitation #793 exists to remove.
describe('scrollTopAfterPrepend', () => {
  it('shifts by exactly the height that was added', () => {
    // Reader 500px down a 2000px thread; 800px of history lands above them.
    expect(scrollTopAfterPrepend({ scrollTop: 500, scrollHeight: 2000 }, 2800)).toBe(1300);
  });

  it('holds position for a reader at the very top', () => {
    // scrollTop 0 is the case most likely to be special-cased wrongly: leaving
    // it at 0 would park them at the top of the NEW content, which is the jump.
    expect(scrollTopAfterPrepend({ scrollTop: 0, scrollHeight: 1000 }, 1600)).toBe(600);
  });

  it('does not move the reader when nothing was added', () => {
    // A re-render that changed no heights must be a no-op, or every poll nudges
    // the viewport.
    expect(scrollTopAfterPrepend({ scrollTop: 420, scrollHeight: 1000 }, 1000)).toBe(420);
  });

  it('does not move the reader when the content SHRANK', () => {
    // A negative delta would scroll them backwards for no reason.
    expect(scrollTopAfterPrepend({ scrollTop: 420, scrollHeight: 1000 }, 800)).toBe(420);
  });

  it('never returns a negative scrollTop', () => {
    expect(scrollTopAfterPrepend({ scrollTop: -50, scrollHeight: 1000 }, 1000)).toBe(0);
  });
});

// #793. The poll returns a WINDOW, not the whole thread. Assigning it wholesale
// is correct only while the window and the display are the same set — which
// stops being true the moment a reader pages backwards.
describe('mergeTranscript', () => {
  it('KEEPS loaded scrollback when the poll returns only the tail', () => {
    // The case the whole function exists for. Reader has paged back to seq 1;
    // the poll knows about 3–5 only. Replacing would destroy 1–2.
    const loaded = [msg(1), msg(2), msg(3), msg(4)];
    const tail = [msg(3), msg(4), msg(5)];
    expect(mergeTranscript(loaded, tail).map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('adds new messages in seq order regardless of arrival order', () => {
    const merged = mergeTranscript([msg(2)], [msg(5), msg(1), msg(3)]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3, 5]);
  });

  it('deduplicates by nodeId, the same key the thread renders by', () => {
    const merged = mergeTranscript([msg(1), msg(2)], [msg(1), msg(2)]);
    expect(merged).toHaveLength(2);
  });

  it('returns the SAME REFERENCE when the poll found nothing new', () => {
    // Not a micro-optimisation: `shownMessages` is $derived, so an unchanged
    // reference means the stick-to-bottom effect does not re-run. A poll that
    // found nothing must be invisible to the reader, scroll position included.
    const loaded = [msg(1), msg(2)];
    expect(mergeTranscript(loaded, [msg(1), msg(2)])).toBe(loaded);
    expect(mergeTranscript(loaded, [])).toBe(loaded);
  });

  it('takes the incoming copy when a body changed, and returns a NEW reference', () => {
    const loaded = [msg(1)];
    const merged = mergeTranscript(loaded, [msg(1, { body: 'edited' })]);
    expect(merged.map((m) => m.body)).toEqual(['edited']);
    // The counterpart to the same-reference case above: a real change MUST
    // produce a new array, or the $derived would not propagate it and the edit
    // would never render.
    expect(merged).not.toBe(loaded);
  });

  it('never drops a message the poll no longer covers', () => {
    // A union never removes, which is right for an append-only chat whose
    // messages cannot be deleted through the UI (#732).
    const loaded = [msg(1), msg(2), msg(3)];
    expect(mergeTranscript(loaded, [msg(3)]).map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('sorts an unsorted first page', () => {
    expect(mergeTranscript([], [msg(3), msg(1), msg(2)]).map((m) => m.seq)).toEqual([1, 2, 3]);
  });
});
