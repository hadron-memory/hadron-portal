import { describe, expect, it } from 'vitest';
import { composeNodeUrn } from './compose-node-urn';
import { MOVE_HINT_GRAMMAR_V2, isOwnershipChainUrn, moveHintGrammar } from './move-hint-grammar';

describe('moveHintGrammar (PR #803 review)', () => {
  it('shows the v2 grammar for an ordinary URN', () => {
    expect(moveHintGrammar('hrn:node:hadronmemory.com:hadron-portal:review')).toBe(
      MOVE_HINT_GRAMMAR_V2,
    );
  });

  it('falls back to v2 for an absent or empty value rather than throwing', () => {
    // The field starts empty and the hint renders beside it; a crash here would
    // take the node page down for a cosmetic string.
    expect(moveHintGrammar(null)).toBe(MOVE_HINT_GRAMMAR_V2);
    expect(moveHintGrammar(undefined)).toBe(MOVE_HINT_GRAMMAR_V2);
    expect(moveHintGrammar('')).toBe(MOVE_HINT_GRAMMAR_V2);
  });

  /**
   * @codex P2: a chain is any memory path with MORE than two atoms, so its
   * arity is not fixed. A hard-coded `<org>::<app>::<agent>::<memory>` template
   * disagrees with a three-atom chain and invites the user to invent an
   * ownership level. Echoing the value's own prefix is arity-proof.
   */
  describe('a chain echoes its own prefix, at any arity', () => {
    it.each([
      ['four atoms', 'hrn:node:acme::billing::agent::system::review:sort', 'hrn:node:acme::billing::agent::system::<loc>'],
      ['three atoms', 'hrn:node:acme::billing::system::review:sort', 'hrn:node:acme::billing::system::<loc>'],
    ])('%s', (_label, value, expected) => {
      expect(moveHintGrammar(value)).toBe(expected);
    });

    it('splits on the LAST :: — a loc may contain single colons', () => {
      // `review:sort:imports` is one loc, not three chain atoms.
      expect(moveHintGrammar('hrn:node:acme::sys::review:sort:imports')).toBe(
        'hrn:node:acme::sys::<loc>',
      );
    });

    it('never emits the hard-coded four-atom template', () => {
      expect(moveHintGrammar('hrn:node:acme::billing::system::x')).not.toContain('<agent>');
      expect(moveHintGrammar('hrn:node:acme::billing::system::x')).not.toContain('<app>');
    });
  });

  /**
   * The property that matters: the hint agrees with what is in the FIELD. Both
   * the prefill and the memory picker route through `composeNodeUrn`, so this
   * pins the hint to the composer's actual output rather than to a literal I
   * copied from it — if its chain rule changes, this fails instead of the hint
   * drifting into recommending a flatten.
   */
  describe('agrees with what composeNodeUrn actually emits', () => {
    it('v2 memory → v2 hint', () => {
      const composed = composeNodeUrn('hrn:mem:hadronmemory.com:dev', 'auth:tokens');
      expect(composed).not.toContain('::');
      expect(moveHintGrammar(composed)).toBe(MOVE_HINT_GRAMMAR_V2);
    });

    it('chain memory → a hint carrying that chain, not the v2 form', () => {
      const composed = composeNodeUrn(
        'hrn:memory:micromentor.org::coding-app::coding-agent::system',
        'review:sort-imports',
      );
      expect(composed).toContain('::');
      // The defect being prevented: a user following a v2 hint flattens the
      // chain, which does not fail — it names a different node.
      expect(moveHintGrammar(composed)).not.toBe(MOVE_HINT_GRAMMAR_V2);
      expect(moveHintGrammar(composed)).toBe(
        'hrn:node:micromentor.org::coding-app::coding-agent::system::<loc>',
      );
    });
  });

  /**
   * @codex P1: the hint reads the live field, so picking a destination memory
   * flips it. Deriving from the source node's URN left the hint describing
   * where the node came FROM while the input held where it is going.
   */
  describe('follows the destination the memory picker wrote', () => {
    const sourceIsV2 = composeNodeUrn('hrn:mem:hadronmemory.com:dev', 'auth:tokens');
    const sourceIsChain = composeNodeUrn('hrn:memory:acme::billing::system', 'auth:tokens');

    it('v2 node moved INTO a chain memory gets the chain hint', () => {
      const picked = composeNodeUrn('hrn:memory:acme::billing::system', 'auth:tokens');
      expect(moveHintGrammar(sourceIsV2)).toBe(MOVE_HINT_GRAMMAR_V2); // before the pick
      expect(moveHintGrammar(picked)).toBe('hrn:node:acme::billing::system::<loc>');
      expect(isOwnershipChainUrn(picked)).toBe(true);
    });

    it('chain node moved OUT to a v2 memory gets the v2 hint', () => {
      const picked = composeNodeUrn('hrn:mem:hadronmemory.com:dev', 'auth:tokens');
      expect(isOwnershipChainUrn(sourceIsChain)).toBe(true); // before the pick
      expect(moveHintGrammar(picked)).toBe(MOVE_HINT_GRAMMAR_V2);
      expect(isOwnershipChainUrn(picked)).toBe(false);
    });
  });

  it('isOwnershipChainUrn is the single predicate both callers share', () => {
    expect(isOwnershipChainUrn('a::b')).toBe(true);
    expect(isOwnershipChainUrn('hrn:node:a:b:c')).toBe(false);
    expect(isOwnershipChainUrn(null)).toBe(false);
  });
});
