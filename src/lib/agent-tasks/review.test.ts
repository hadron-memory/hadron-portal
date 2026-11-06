/** portal#1697 — the facts the Review section starts from. */
import { describe, expect, it } from 'vitest';
import { atOlderHead, reviewFacts, seatStateLabel, shortHead, slotsNotCounting, verdictLabel, type ReviewSlot } from './review';

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

describe('reviewFacts', () => {
  it('takes the newest of each event, the last in the oldest-first read', () => {
    expect(reviewFacts([
      { type: 'pr.frozen', payload: { head: H1, pullRequest: 'x' } },
      { type: 'pr.frozen', payload: { head: H2, pullRequest: 'x' } },
    ])).toEqual({ kind: 'facts', head: H2, seat: null });
    expect(reviewFacts([
      { type: 'review.seat.assigned', payload: { slot: 'local', head: H1, supersedes: null } },
      { type: 'review.seat.assigned', payload: { slot: 'blind', head: H2, supersedes: null } },
    ])).toEqual({ kind: 'facts', head: null, seat: { slot: 'blind', head: H2 } });
  });

  it('no events is no head and no seat', () => {
    expect(reviewFacts([])).toEqual({ kind: 'facts', head: null, seat: null });
  });

  // portal#1713: synthetic stored rows. The freeze writer refuses these today
  // (hrn:node:hadronmemory.com:specs:cor:agt:130:04 covers the writer); they stand for a legacy row or a later
  // payload shape, not for something the writer can produce.
  describe('a newest event that is not the producer’s shape', () => {
    const frozen = (head: unknown) => ({ type: 'pr.frozen', payload: { head, pullRequest: 'x' } });
    const seat = (payload: unknown) => ({ type: 'review.seat.assigned', payload });
    const MALFORMED_FROZEN = { kind: 'malformed', eventType: 'pr.frozen' };
    const MALFORMED_SEAT = { kind: 'malformed', eventType: 'review.seat.assigned' };

    it('a malformed freeze is reported, never an absent one', () => {
      expect(reviewFacts([frozen('nope')])).toEqual(MALFORMED_FROZEN);
      expect(reviewFacts([{ type: 'pr.frozen', payload: null }])).toEqual(MALFORMED_FROZEN);
      expect(reviewFacts([frozen(H1.slice(1))])).toEqual(MALFORMED_FROZEN);
    });

    it('a malformed freeze after a valid one hides the older head', () => {
      expect(reviewFacts([frozen(H1), frozen('nope')])).toEqual(MALFORMED_FROZEN);
    });

    it('a malformed seat after a valid one hides the older seat, including a valid head with no slot', () => {
      const valid = seat({ slot: 'local', head: H1 });
      expect(reviewFacts([valid, seat({ head: H2 })])).toEqual(MALFORMED_SEAT);
      expect(reviewFacts([valid, seat({ slot: '', head: H2 })])).toEqual(MALFORMED_SEAT);
      expect(reviewFacts([valid, seat({ slot: 'blind', head: 'nope' })])).toEqual(MALFORMED_SEAT);
      expect(reviewFacts([valid, seat(null)])).toEqual(MALFORMED_SEAT);
    });

    it('a valid newest freeze does not rescue a malformed newest seat, in either order', () => {
      expect(reviewFacts([frozen(H1), seat({ head: H2 })])).toEqual(MALFORMED_SEAT);
      expect(reviewFacts([seat({ head: H2 }), frozen(H1)])).toEqual(MALFORMED_SEAT);
    });

    it('a valid event after a malformed one is used', () => {
      expect(reviewFacts([frozen('nope'), frozen(H2)])).toEqual({ kind: 'facts', head: H2, seat: null });
      expect(reviewFacts([seat({ head: H1 }), seat({ slot: 'blind', head: H2 })])).toEqual({ kind: 'facts', head: null, seat: { slot: 'blind', head: H2 } });
    });

    it('an event of another type decides nothing', () => {
      expect(reviewFacts([frozen(H1), { type: 'review.verdict', payload: null }])).toEqual({ kind: 'facts', head: H1, seat: null });
    });
  });
});

describe('slot helpers', () => {
  const slot = (over: Partial<ReviewSlot>): ReviewSlot => ({ slot: 'local', currentTaskId: 't', state: 'FINISHED', verdict: 'APPROVE', head: H2, counts: true, ...over });

  it('names exactly the slots the server says don’t count', () => {
    expect(slotsNotCounting({ ready: false, head: H2, slots: [slot({}), slot({ slot: 'blind', counts: false })] })).toEqual(['blind']);
  });

  it('an older head is a head other than the frozen one; no head is not older', () => {
    expect(atOlderHead(slot({ head: H1 }), H2)).toBe(true);
    expect(atOlderHead(slot({ head: H2 }), H2)).toBe(false);
    expect(atOlderHead(slot({ head: null }), H2)).toBe(false);
  });

  it('the short head is eight characters', () => {
    expect(shortHead(H1)).toBe('aaaaaaaa');
  });

  it('every verdict reads in plain words, and a verdict this build doesn’t know reads as sent', () => {
    expect(verdictLabel('APPROVE')).toBe('Approved');
    expect(verdictLabel('CHANGES_REQUESTED')).toBe('Changes requested');
    expect(verdictLabel(null)).toBe('None yet');
    expect(verdictLabel('NEW' as never)).toBe('NEW');
  });

  it('a seat’s state reads as a task state, and no seat says so', () => {
    expect(seatStateLabel('FINISHED')).toBe('Finished');
    expect(seatStateLabel('CANCELLED')).toBe('Cancelled');
    expect(seatStateLabel('MISSING')).toBe('No seat');
    expect(seatStateLabel('ODD')).toBe('Unknown: ODD');
  });
});
