/**
 * #942 slice 4 — the effective register shows facts true about the ATTENDEE,
 * never the caller's `canRead` / `canPost` / `disclosure` as theirs.
 */
import { describe, expect, it } from 'vitest';
import { effectiveRows, readUpToLabel, type RegisterViewRow } from './register-view';

type ViewOverrides = Partial<Omit<RegisterViewRow, 'entry' | 'channel'>> & {
  entry?: Partial<RegisterViewRow['entry']>;
  channel?: Partial<RegisterViewRow['channel']>;
};

function view(over: ViewOverrides = {}): RegisterViewRow {
  return {
    namedBy: 'WORKER',
    lastSeenSeq: 10,
    canRead: true,
    canPost: true,
    disclosure: null,
    attendeeUrn: 'hrn:worker:acme.com:team:ada',
    ...over,
    entry: { id: 're-1', ownerType: 'APP', role: 'BOTH', mentionOnly: false, installDefault: false, ...over.entry },
    channel: { id: 'ch', name: 'team', loc: 'chats:team', hostMemoryUrn: 'hrn:mem:acme.com:shared', lastSeq: 12, lastMessageAt: null, deleted: false, ...over.channel },
  };
}

describe('effectiveRows', () => {
  it('carries the Channel’s address, so same-named Channels in different memories are told apart', () => {
    const [a, b] = effectiveRows([
      view({ channel: { name: 'team', loc: 'chats:team', hostMemoryUrn: 'hrn:mem:acme.com:shared' } }),
      view({ channel: { name: 'team', loc: 'chats:team', hostMemoryUrn: 'hrn:mem:acme.com:other' } }),
    ]);
    expect(a.channel).toBe(b.channel);
    expect(a.channelUrn).toBe('hrn:node:acme.com:shared:chats:team');
    expect(b.channelUrn).toBe('hrn:node:acme.com:other:chats:team');
  });

  it('no address when the host memory isn’t visible to the viewer: no chip, not an empty one', () => {
    expect(effectiveRows([view({ channel: { hostMemoryUrn: null } })])[0].channelUrn).toBeNull();
  });

  it('states the winning row, its mode, what counts, and why', () => {
    expect(effectiveRows([view({ entry: { role: 'WATCH', mentionOnly: true } })])[0]).toMatchObject({
      channel: 'team', mode: 'Watch', counts: 'Only when mentioned', because: 'Their own row',
    });
  });

  it.each([
    ['WORKER', 'ORGANIZATION', 'Their own row, set by the organization'],
    ['AGENT', 'APP', 'Their agent’s row'],
    ['AGENT', 'ORGANIZATION', 'Their agent’s row, set by the organization'],
    ['EVERYONE', 'APP', 'Everyone in this App'],
    ['EVERYONE', 'ORGANIZATION', 'Everyone in the organization'],
  ] as const)('why: %s row owned by %s', (namedBy, ownerType, because) => {
    expect(effectiveRows([view({ namedBy, entry: { ownerType } })])[0].because).toBe(because);
  });

  it('NEVER turns the caller’s standing into a claim about the attendee', () => {
    // The caller cannot post and the server discloses why; that is about the
    // VIEWER, so nothing of it reaches the attendee's row.
    const row = effectiveRows([view({ canRead: true, canPost: false, disclosure: 'DRIVER_NOT_PARTICIPANT' })])[0];
    expect(JSON.stringify(row)).not.toMatch(/participant|can’t|cannot|not allowed|access/i);
    expect(Object.keys(row)).not.toContain('canPost');
    expect(row.note).toBe('');
  });

  it('a hidden host memory is worded as the VIEWER’s fact; a deleted channel as the channel’s', () => {
    expect(effectiveRows([view({ channel: { hostMemoryUrn: null } })])[0].note).toBe('Its memory isn’t visible to you');
    expect(effectiveRows([view({ channel: { deleted: true } })])[0].note).toBe('Channel deleted');
  });
});

describe('readUpToLabel', () => {
  it.each([
    [{ lastSeenSeq: 12, channel: { lastSeq: 12 } }, 'Up to date (#12)'],
    [{ lastSeenSeq: 15, channel: { lastSeq: 12 } }, 'Up to date (#12)'],
    [{ lastSeenSeq: 3, channel: { lastSeq: 12 } }, 'Read up to #3 of #12'],
    [{ lastSeenSeq: null, channel: { lastSeq: 12 } }, 'Not tracked'],
    [{ lastSeenSeq: 0, channel: { lastSeq: 0 } }, 'No messages yet'],
  ] as const)('%j → %s', (over, label) => {
    expect(readUpToLabel(view(over as never))).toBe(label);
  });

  it('never claims an unread COUNT: lastSeq is a watermark, and mention-only counts only some', () => {
    expect(readUpToLabel(view({ lastSeenSeq: 3, entry: { mentionOnly: true } }))).not.toMatch(/unread|\d+ new/i);
  });
});
