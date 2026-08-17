import { describe, expect, it } from 'vitest';
import {
  authorInitialOf,
  authorKindOf,
  authorLabelOf,
  avatarColorOf,
  indexBySeq,
  replyPreviewOf,
} from './team-chat-thread';
import type { TeamChatMessage } from '$lib/types';

function msg(over: Partial<TeamChatMessage> = {}): TeamChatMessage {
  return {
    nodeId: 'n1',
    seq: 1,
    body: 'hello',
    at: '2026-08-17T09:00:00Z',
    authorUserId: null,
    authorWorkerId: null,
    authorName: null,
    sessionId: null,
    replyToSeq: null,
    mentions: [],
    ...over,
  };
}

describe('authorKindOf', () => {
  it('reads a worker post from authorWorkerId', () => {
    expect(authorKindOf(msg({ authorWorkerId: 'w1' }))).toBe('worker');
  });

  it('reads a human post from authorUserId', () => {
    expect(authorKindOf(msg({ authorUserId: 'u1' }))).toBe('human');
  });

  // The distinction this tab exists to make. If these two ever collapse, the
  // surface is back to the bug in hadron-server#1030 where a teammate's post
  // and a human's rendered identically.
  it('distinguishes a worker post from a human post', () => {
    expect(authorKindOf(msg({ authorWorkerId: 'w1' }))).not.toBe(
      authorKindOf(msg({ authorUserId: 'u1' })),
    );
  });

  // An envelope with neither id and no name identifies nobody. It must not be
  // silently presented as a human — that is inventing attribution the record
  // does not carry.
  it('reports unknown rather than defaulting to human when nothing identifies the author', () => {
    expect(authorKindOf(msg())).toBe('unknown');
  });

  // Pre-#974 (persona era) a non-human author was stored as `authorAgentId`,
  // which the current envelope does not surface — so both ids are null while
  // `authorName` is populated. Real instance: this team's own seq 2, stored as
  // {authorName: "Ada", authorAgentId: …, sessionId: …}.
  //
  // Rendering that as "unknown" beside the name "Ada" is its own small lie: the
  // record does know who posted, it just predates worker ids.
  it('reports a pre-worker author as legacy, not unknown', () => {
    expect(authorKindOf(msg({ authorName: 'Ada', sessionId: 'sess-1' }))).toBe('legacy');
  });

  it('does not treat a legacy author as a worker — there is no worker row to point at', () => {
    expect(authorKindOf(msg({ authorName: 'Ada' }))).not.toBe('worker');
  });

  // A blank name is the same as no name; it must not promote unknown to legacy.
  it('stays unknown when the name is blank', () => {
    expect(authorKindOf(msg({ authorName: '   ' }))).toBe('unknown');
  });
});

describe('authorLabelOf', () => {
  it('prefers the denormalized authorName', () => {
    expect(authorLabelOf(msg({ authorWorkerId: 'w1', authorName: 'Ada' }))).toBe('Ada');
  });

  it('trims surrounding whitespace', () => {
    expect(authorLabelOf(msg({ authorUserId: 'u1', authorName: '  holger  ' }))).toBe('holger');
  });

  // authorName is nullable in the schema, and a whitespace-only value is the
  // same thing as absent for display purposes.
  it('falls back per kind when authorName is missing or blank', () => {
    expect(authorLabelOf(msg({ authorWorkerId: 'w1' }))).toBe('Unnamed worker');
    expect(authorLabelOf(msg({ authorUserId: 'u1', authorName: '   ' }))).toBe('Unnamed user');
    expect(authorLabelOf(msg())).toBe('Unknown author');
  });
});

describe('authorInitialOf', () => {
  it('uppercases the first character', () => {
    expect(authorInitialOf('ada')).toBe('A');
  });

  it('falls back to ? on an empty label', () => {
    expect(authorInitialOf('   ')).toBe('?');
  });
});

describe('replyPreviewOf', () => {
  const parent = msg({ seq: 14, authorWorkerId: 'w1', authorName: 'Gil', body: 'the surface question' });
  const bySeq = indexBySeq([parent]);

  it('returns null for a message that is not a reply', () => {
    expect(replyPreviewOf(msg({ replyToSeq: null }), bySeq)).toBeNull();
  });

  it('quotes the cited message when it is on the page', () => {
    expect(replyPreviewOf(msg({ replyToSeq: 14 }), bySeq)).toEqual({
      seq: 14,
      author: 'Gil',
      excerpt: 'the surface question',
    });
  });

  it('collapses whitespace in the excerpt so a multi-line quote stays one line', () => {
    const multiline = indexBySeq([msg({ seq: 2, authorName: 'Ada', body: 'first\n\n  second' })]);
    expect(replyPreviewOf(msg({ replyToSeq: 2 }), multiline)?.excerpt).toBe('first second');
  });

  it('truncates a long excerpt with an ellipsis', () => {
    const long = indexBySeq([msg({ seq: 3, authorName: 'Ada', body: 'x'.repeat(200) })]);
    const preview = replyPreviewOf(msg({ replyToSeq: 3 }), long, 10);
    expect(preview?.excerpt).toBe('xxxxxxxxx…');
    expect(preview?.excerpt.length).toBe(10);
  });

  // The transcript is paged, so a reply can legitimately cite a message older
  // than the current window. That is "not on screen", not "does not exist" —
  // still surface the seq, because the number is how teammates cite each other.
  it('still reports the seq when the cited message is off-page', () => {
    expect(replyPreviewOf(msg({ replyToSeq: 999 }), bySeq)).toEqual({
      seq: 999,
      author: '',
      excerpt: '',
    });
  });
});

describe('indexBySeq', () => {
  it('keys messages by seq', () => {
    const a = msg({ seq: 1 });
    const b = msg({ seq: 2, nodeId: 'n2' });
    const idx = indexBySeq([a, b]);
    expect(idx.get(1)).toBe(a);
    expect(idx.get(2)).toBe(b);
    expect(idx.get(3)).toBeUndefined();
  });
});

describe('avatarColorOf', () => {
  it('is stable for the same label', () => {
    expect(avatarColorOf('Ada')).toBe(avatarColorOf('Ada'));
  });

  // Keyed on the label, not on position — so paging (which changes which
  // messages are on screen) cannot reshuffle everyone's colour.
  it('does not depend on what else is on the page', () => {
    const first = avatarColorOf('Gil');
    void avatarColorOf('Dara');
    void avatarColorOf('Jonas');
    expect(avatarColorOf('Gil')).toBe(first);
  });

  it('returns a class from the palette', () => {
    expect(avatarColorOf('Tove')).toMatch(/^bg-[a-z]+-\d00$/);
  });
});
