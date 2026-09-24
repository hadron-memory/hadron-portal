import { describe, expect, it } from 'vitest';
import {
  annotateDays,
  authorHrefOf,
  authorInitialOf,
  authorKindOf,
  authorLabelOf,
  authorUrnOf,
  avatarColorOf,
  bodyOverflows,
  dayKeyOf,
  indexBySeq,
  replyPreviewOf,
  unknownWorkerIds,
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

// Local-time construction throughout: the day helpers partition by the
// reader's calendar, so a test that pinned a UTC string would pass or fail by
// the CI runner's zone. Building the instants from local components makes the
// assertions zone-independent.
const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

describe('dayKeyOf', () => {
  it('keys a timestamp by its LOCAL calendar day', () => {
    expect(dayKeyOf(local(2026, 9, 14, 0, 5))).toBe('2026-09-14');
    expect(dayKeyOf(local(2026, 9, 14, 23, 55))).toBe('2026-09-14');
  });

  it('zero-pads so keys compare as strings', () => {
    expect(dayKeyOf(local(2026, 1, 2))).toBe('2026-01-02');
  });

  it('returns null for something that is not a date', () => {
    expect(dayKeyOf('not a date')).toBeNull();
  });
});

describe('annotateDays', () => {
  const now = new Date(2026, 8, 14, 10, 30); // 2026-09-14 local
  const at = (iso: string, nodeId = iso) => msg({ nodeId, at: iso });
  const days = (rows: ReturnType<typeof annotateDays>) => rows.map((r) => r.day);

  it('opens a day on the first message and on every calendar-day change, not otherwise', () => {
    const rows = annotateDays(
      [at(local(2026, 9, 13, 23, 59)), at(local(2026, 9, 14, 0, 1)), at(local(2026, 9, 14, 9))],
      now,
    );
    expect(days(rows)).toEqual([{ kind: 'yesterday' }, { kind: 'today' }, null]);
  });

  it('names today and yesterday as kinds, for the component to localize', () => {
    const rows = annotateDays([at(local(2026, 9, 13, 23)), at(local(2026, 9, 14, 1))], now);
    expect(days(rows)).toEqual([{ kind: 'yesterday' }, { kind: 'today' }]);
  });

  it('dates anything older, without the year while it is the current one', () => {
    const [row] = annotateDays([at(local(2026, 9, 10))], now);
    expect(row.day?.kind).toBe('date');
    expect((row.day as { label: string }).label).not.toContain('2026');
  });

  it('adds the year once it is not the current one', () => {
    const [row] = annotateDays([at(local(2025, 12, 31))], now);
    expect((row.day as { label: string }).label).toContain('2025');
  });

  // Yesterday across a month boundary is the case a naive `day - 1` gets wrong.
  it('finds yesterday across a month boundary', () => {
    const [row] = annotateDays([at(local(2026, 8, 31, 20))], new Date(2026, 8, 1, 8));
    expect(row.day).toEqual({ kind: 'yesterday' });
  });

  // A bad timestamp must not sprout separators on either side of itself; its
  // own time cell shows the raw string, which is the disclosure.
  it('neither opens nor closes a day on an unparseable timestamp, and shows it raw', () => {
    const rows = annotateDays(
      [at(local(2026, 9, 14), 'a'), at('garbage', 'b'), at(local(2026, 9, 14, 15), 'c')],
      now,
    );
    expect(days(rows)).toEqual([{ kind: 'today' }, null, null]);
    expect(rows[1].time).toBe('garbage');
  });

  it('renders the time cell as hours and minutes only', () => {
    const [row] = annotateDays([at(local(2026, 9, 14, 9, 7))], now);
    expect(row.time).toMatch(/9:07/);
    expect(row.time).not.toContain('2026');
  });

  // The partition is a LOCAL calendar fact, unknowable on the server; rows
  // still come back (with their times) so the list renders, just without
  // separators until the browser supplies a clock.
  it('emits no separators without a clock, and keeps the rows', () => {
    const rows = annotateDays([at(local(2026, 9, 13)), at(local(2026, 9, 14))], null);
    expect(days(rows)).toEqual([null, null]);
    expect(rows).toHaveLength(2);
  });

  it('preserves the message objects by reference', () => {
    const m = at(local(2026, 9, 14));
    expect(annotateDays([m], now)[0].msg).toBe(m);
  });
});

describe('bodyOverflows', () => {
  it('reports a body taller than its clamp', () => {
    expect(bodyOverflows(900, 320)).toBe(true);
  });

  it('reports a body that fits', () => {
    expect(bodyOverflows(200, 320)).toBe(false);
  });

  // Sub-pixel rounding can make an exactly-fitting body read a pixel taller
  // than its box; offering "Show more" for that reveals nothing.
  it('absorbs a one-pixel rounding difference', () => {
    expect(bodyOverflows(321, 320)).toBe(false);
    expect(bodyOverflows(322, 320)).toBe(true);
  });
});

/**
 * Where an author's name links to.
 *
 * The rule is derived from the author KIND rather than from the presence of a
 * field, so this is tested against the same four cases `authorKindOf` defines —
 * otherwise the link and the badge beside it could disagree about what a
 * message is.
 */
describe('authorHrefOf', () => {
  it('links a worker to its worker profile, not to the agent behind it', () => {
    // A Worker is the named casting that posted; its page carries the role, the
    // holder and the sessions, and links on to the Agent. The Agent is the
    // template, and several workers can share one.
    expect(
      authorHrefOf({ authorWorkerId: 'w-1', authorUserId: null, authorName: 'Gil' }),
    ).toBe('/app/workers/w-1');
  });

  it('links a human to the user profile', () => {
    expect(
      authorHrefOf({ authorWorkerId: null, authorUserId: 'u-1', authorName: 'holger' }),
    ).toBe('/app/user/u-1');
  });

  it('does NOT link a pre-worker (legacy) author, however good its name looks', () => {
    // The trap this exists to prevent: a legacy message carries a perfectly
    // usable `authorName`, so a name-based link would render and resolve — to
    // whoever holds that name TODAY. The pre-worker author and the current
    // holder are not the same entity, which is the entire reason the `legacy`
    // kind exists rather than being folded into `worker`.
    expect(
      authorHrefOf({ authorWorkerId: null, authorUserId: null, authorName: 'Ada' }),
    ).toBeNull();
  });

  it('does NOT link an unattributed author', () => {
    expect(
      authorHrefOf({ authorWorkerId: null, authorUserId: null, authorName: null }),
    ).toBeNull();
  });

  it('agrees with authorKindOf on every case', () => {
    // One rule, two renderings (the link and the badge). Deriving both from the
    // kind is what stops a message being badged `pre-worker` while its name
    // links somewhere, so pin the correspondence rather than the two outputs
    // separately.
    const cases = [
      { authorWorkerId: 'w-1', authorUserId: null, authorName: 'Gil' },
      { authorWorkerId: null, authorUserId: 'u-1', authorName: 'holger' },
      { authorWorkerId: null, authorUserId: null, authorName: 'Ada' },
      { authorWorkerId: null, authorUserId: null, authorName: null },
    ];
    for (const c of cases) {
      const linked = authorHrefOf(c) !== null;
      const kind = authorKindOf(c);
      expect(linked).toBe(kind === 'worker' || kind === 'human');
    }
  });

  it('percent-encodes an id rather than splicing it into the path', () => {
    // Ids are server-supplied, but this builds a URL and the cost of being
    // wrong is a broken or mis-targeted link, not a compile error.
    expect(
      authorHrefOf({ authorWorkerId: 'a/b?c', authorUserId: null, authorName: 'x' }),
    ).toBe('/app/workers/a%2Fb%3Fc');
  });
});

describe('authorUrnOf — #855', () => {
  const W = 'hrn:worker:acme.com:team:dara';
  const urns = new Map([['w1', W]]);
  const msg = (over: Partial<TeamChatMessage>) =>
    ({ authorWorkerId: null, authorUserId: null, authorName: null, ...over }) as TeamChatMessage;

  it('gives a worker author its roster URN', () => {
    expect(authorUrnOf(msg({ authorWorkerId: 'w1', authorName: 'Dara' }), urns)).toBe(W);
  });

  it('is absent, never empty, when there is nothing to show', () => {
    // Not in the roster (or its URN was null, so it was left out of the map).
    expect(authorUrnOf(msg({ authorWorkerId: 'w9' }), urns)).toBeNull();
    // The roster failed to load.
    expect(authorUrnOf(msg({ authorWorkerId: 'w1' }), null)).toBeNull();
    // A human: no user URN in this payload, even if an id happened to match.
    expect(authorUrnOf(msg({ authorUserId: 'w1' }), urns)).toBeNull();
    // legacy / unknown carry no id at all.
    expect(authorUrnOf(msg({ authorName: 'Old persona' }), urns)).toBeNull();
    expect(authorUrnOf(msg({}), urns)).toBeNull();
  });
});

describe('unknownWorkerIds — @codex on #908', () => {
  const m = (authorWorkerId: string | null) => ({ authorWorkerId });
  it('names only worker ids the roster has never seen, once each, in first-seen order', () => {
    const known = new Set(['w1', 'w2']);
    expect(unknownWorkerIds([m('w1'), m('w3'), m(null), m('w3'), m('w4'), m('w2')], known)).toEqual(['w3', 'w4']);
  });
  it('treats a KNOWN worker with a null URN as known — asking again would not give it one', () => {
    // The page puts every rostered id in the set, URN or not.
    expect(unknownWorkerIds([m('w-null-urn')], new Set(['w-null-urn']))).toEqual([]);
  });
});
