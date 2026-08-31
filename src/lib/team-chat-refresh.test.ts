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

// #793 (@codex on PR #796). The merge is only correct if the ACCUMULATED
// transcript is the left input on every tick. Merging each window against the
// static page payload instead leaves a hole the moment the tail advances past
// the window — and an append-only chat must never lose a message.
describe('mergeTranscript — accumulation across successive polls', () => {
  const page = [msg(1), msg(2), msg(3)]; // the page payload: seqs 1–3
  const tick1 = [msg(3), msg(4)]; // window advances
  const tick2 = [msg(6), msg(7)]; // advances PAST 5 — the gap case

  it('keeps every message when each tick merges into the accumulated result', () => {
    const afterTick1 = mergeTranscript(page, tick1);
    const afterTick2 = mergeTranscript(afterTick1, tick2);
    expect(afterTick2.map((m) => m.seq)).toEqual([1, 2, 3, 4, 6, 7]);
  });

  it('LOSES a message if each tick merges against the static page payload', () => {
    // The bug, pinned as a negative so the correct wiring above has something
    // to be correct against. Merging the page with tick2 alone drops seq 4 —
    // it is in neither input, and no amount of re-merging recovers it.
    const wrong = mergeTranscript(page, tick2);
    expect(wrong.map((m) => m.seq)).toEqual([1, 2, 3, 6, 7]);
    expect(wrong.map((m) => m.seq)).not.toContain(4);
  });
});

// #793 (@copilot on PR #796). The change-detector originally compared `body`
// and `seq` only, so a server-side change to any other rendered field returned
// the existing array by reference and the UI never updated. These cover every
// remaining field ON PURPOSE — one case per field, so a regression names which.
describe('mergeTranscript — change detection covers every rendered field', () => {
  const base = [msg(1)];

  const cases: Array<[string, Partial<TeamChatMessage>]> = [
    ['body', { body: 'edited' }],
    ['at', { at: '2026-09-01T12:00:00Z' }],
    ['authorName', { authorName: 'someone-else' }],
    ['authorUserId', { authorUserId: 'u2' }],
    ['authorWorkerId', { authorWorkerId: 'w1' }],
    ['sessionId', { sessionId: 's1' }],
    ['replyToSeq', { replyToSeq: 7 }],
    ['mentions', { mentions: ['gil'] }],
  ];

  for (const [field, patch] of cases) {
    it(`treats a changed \`${field}\` as a real update`, () => {
      const merged = mergeTranscript(base, [msg(1, patch)]);
      expect(merged, `a changed ${field} must produce a NEW array`).not.toBe(base);
      expect(merged[0]).toMatchObject(patch);
    });
  }

  it('still short-circuits when a deep-equal row arrives', () => {
    // The counterpart: broadening the comparison must not make every tick look
    // like a change, or the scroll effect re-runs on every poll — the thing the
    // same-reference return exists to prevent.
    const merged = mergeTranscript(base, [msg(1, { mentions: [] })]);
    expect(merged).toBe(base);
  });

  it('compares mentions by CONTENT, not by array identity', () => {
    // Two distinct arrays with equal contents are the same message; a naive
    // `!==` on the array would report every poll as changed.
    const withMentions = [msg(1, { mentions: ['ada', 'dara'] })];
    expect(mergeTranscript(withMentions, [msg(1, { mentions: ['ada', 'dara'] })])).toBe(withMentions);
    expect(mergeTranscript(withMentions, [msg(1, { mentions: ['ada'] })])).not.toBe(withMentions);
  });
});
