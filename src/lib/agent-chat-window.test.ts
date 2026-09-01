import { describe, expect, it } from 'vitest';
import { AGENT_CHAT_PAGE_SIZE, hasOlderBefore, olderCursorFrom } from './agent-chat-window';
import type { ChatMessage } from './types';

function msg(seq: number | null, content = `m${seq}`): ChatMessage {
  return { role: 'user', content, seq, createdAt: '2026-01-01T00:00:00.000Z' };
}

/** `n` messages numbered from `from`, oldest-first — the shape a page arrives in. */
function page(n: number, from = 1): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => msg(from + i));
}

describe('hasOlderBefore (#793)', () => {
  it('is true for a full page — a last page that is full looks like a middle one', () => {
    expect(hasOlderBefore(page(10), 10)).toBe(true);
  });

  it('is false for a short page', () => {
    expect(hasOlderBefore(page(7), 10)).toBe(false);
  });

  // The boundary, both sides. One off-by-one here costs every thread a doomed
  // extra round trip (or, the other way, hides its last page).
  it('flips exactly at the page size', () => {
    expect(hasOlderBefore(page(9), 10)).toBe(false);
    expect(hasOlderBefore(page(10), 10)).toBe(true);
  });

  it('is false for an empty page', () => {
    expect(hasOlderBefore([], 10)).toBe(false);
  });

  /**
   * The honest limit. Paging needs a cursor, the cursor is the oldest `seq` on
   * the page, and `seq` is nullable for messages written before the counter.
   * The server DOES reach those rows (every cursor includes them — they sort as
   * the oldest of the transcript), but a page made only of them yields no `seq`
   * to ask again with. Reporting `hasOlder: true` there would leave the client
   * re-requesting the same page forever, or — worse, if it fell back to a null
   * cursor — silently re-reading the tail and prepending a duplicate of the
   * messages already on screen.
   */
  it('is false when a full page has no cursor on its oldest row (legacy null seq)', () => {
    const legacy = [msg(null), msg(null), msg(null)];
    expect(hasOlderBefore(legacy, 3)).toBe(false);
  });

  it('is true when a full page has a cursor, even with nulls later in it', () => {
    // Only `messages[0]` is the cursor — nulls further in do not block paging,
    // and treating them as blocking would end scrollback one page early.
    expect(hasOlderBefore([msg(5), msg(null), msg(7)], 3)).toBe(true);
  });

  // seq 0 is a legitimate cursor. A truthiness check here would call the first
  // page of a zero-based chat "exhausted".
  it('treats a seq of 0 as a cursor, not as absent', () => {
    expect(hasOlderBefore([msg(0), msg(1)], 2)).toBe(true);
  });
});

describe('olderCursorFrom (#793)', () => {
  it('takes the OLDEST message, which is index 0 in an oldest-first page', () => {
    expect(olderCursorFrom(page(10, 21))).toBe(21);
  });

  it('is null for an empty page', () => {
    expect(olderCursorFrom([])).toBe(null);
  });

  it('is null when the oldest row has no seq', () => {
    expect(olderCursorFrom([msg(null), msg(4)])).toBe(null);
  });

  /**
   * The trap this function exists to avoid. `AgentChat` fabricates
   * `seq: messages.length` on its optimistic bubbles, so a resumed chat holding
   * seqs 401–500 gets a locally-appended message numbered ~100. A cursor taken
   * as the MINIMUM over the rendered transcript would return that 100 and page
   * from a position that never existed — skipping messages 101–400 with no
   * error anywhere.
   */
  it('ignores a fabricated low seq appended after a resumed window', () => {
    const resumed = page(3, 401); // real: 401, 402, 403
    const optimistic = msg(3, 'just typed'); // fabricated: messages.length
    const rendered = [...resumed, optimistic];
    expect(olderCursorFrom(rendered)).toBe(401);
    expect(Math.min(...rendered.map((m) => m.seq as number))).toBe(3); // the wrong answer
  });
});

describe('AGENT_CHAT_PAGE_SIZE', () => {
  // Matches the server's own default `take` for `chatHistory`, so an omitted
  // limit and an explicit one agree.
  it('is the shared 100-message window', () => {
    expect(AGENT_CHAT_PAGE_SIZE).toBe(100);
  });
});
