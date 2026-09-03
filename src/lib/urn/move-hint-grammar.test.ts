import { describe, expect, it } from 'vitest';
import { composeNodeUrn } from './compose-node-urn';
import {
  MOVE_HINT_GRAMMAR_CHAIN,
  MOVE_HINT_GRAMMAR_V2,
  isOwnershipChainUrn,
  moveHintGrammar,
} from './move-hint-grammar';

describe('moveHintGrammar (@codex P1 on PR #803)', () => {
  it('shows the v2 grammar for an ordinary node', () => {
    expect(moveHintGrammar('hrn:node:hadronmemory.com:hadron-portal:review')).toBe(
      MOVE_HINT_GRAMMAR_V2,
    );
  });

  it('shows the chain grammar for a node under a v1 ownership chain', () => {
    expect(
      moveHintGrammar('hrn:node:micromentor.org::coding-app::coding-agent::system::review:sort-imports'),
    ).toBe(MOVE_HINT_GRAMMAR_CHAIN);
  });

  it('falls back to v2 for an absent URN rather than throwing', () => {
    // The hint renders before/around data being ready; a crash here would take
    // the whole node page down for a cosmetic string.
    expect(moveHintGrammar(null)).toBe(MOVE_HINT_GRAMMAR_V2);
    expect(moveHintGrammar(undefined)).toBe(MOVE_HINT_GRAMMAR_V2);
    expect(moveHintGrammar('')).toBe(MOVE_HINT_GRAMMAR_V2);
  });

  /**
   * The property that actually matters: the hint agrees with what the field is
   * PREFILLED with. Both come from `composeNodeUrn`, so this pins them together
   * rather than asserting a literal I copied from it — if the composer's
   * chain rule ever changes, this fails instead of the hint silently drifting
   * into recommending a flatten.
   */
  describe('agrees with what composeNodeUrn actually emits', () => {
    it.each([
      ['hrn:mem:hadronmemory.com:dev', 'auth:tokens'],
      ['hrn:mem:hadronmemory.com:hadron-portal', 'review'],
    ])('v2 memory %s composes to a URN the v2 hint describes', (memUrn, loc) => {
      const composed = composeNodeUrn(memUrn, loc);
      expect(composed).not.toContain('::');
      expect(moveHintGrammar(composed)).toBe(MOVE_HINT_GRAMMAR_V2);
    });

    it('a chain memory composes to a URN the chain hint describes', () => {
      const composed = composeNodeUrn(
        'hrn:memory:micromentor.org::coding-app::coding-agent::system',
        'review:sort-imports',
      );
      // composeNodeUrn deliberately leaves this in v1 — the hint must follow it.
      expect(composed).toContain('::');
      expect(moveHintGrammar(composed)).toBe(MOVE_HINT_GRAMMAR_CHAIN);
    });

    it('and the v2 hint would be WRONG there — the defect being prevented', () => {
      const composed = composeNodeUrn(
        'hrn:memory:micromentor.org::coding-app::coding-agent::system',
        'review:sort-imports',
      );
      // A user following the v2 grammar flattens the chain. That does not fail
      // loudly — it names a different node, and the move reports success.
      expect(moveHintGrammar(composed)).not.toBe(MOVE_HINT_GRAMMAR_V2);
    });
  });

  it('isOwnershipChainUrn is the single predicate both callers share', () => {
    expect(isOwnershipChainUrn('a::b')).toBe(true);
    expect(isOwnershipChainUrn('hrn:node:a:b:c')).toBe(false);
  });
});
