import { describe, expect, it } from 'vitest';
import { orderOrdinaryConversations, planStartOrderMove } from './conversation-order';

const conv = (loc: string, seq: number | null, data: Record<string, unknown> = {}) => ({
  id: loc,
  loc,
  seq,
  data,
});

describe('orderOrdinaryConversations (Q13, Q14, Q14a)', () => {
  it('orders by seq ascending, nulls last, ties by loc in code-unit order', () => {
    const ordered = orderOrdinaryConversations([
      conv('conversations:c', null),
      conv('conversations:b', 2),
      conv('conversations:a', 2),
      conv('conversations:z', 1),
      // Code-unit order puts uppercase before lowercase; localeCompare would not.
      conv('conversations:B', null),
    ]);
    expect(ordered.map((c) => c.loc)).toEqual([
      'conversations:z',
      'conversations:a',
      'conversations:b',
      'conversations:B',
      'conversations:c',
    ]);
  });

  it('leaves setup and fallback conversations out of the order', () => {
    const ordered = orderOrdinaryConversations([
      conv('conversations:a', 1),
      conv('conversations:setup', 2, { isSetup: true }),
      conv('conversations:fallback', 3, { isFallback: true }),
    ]);
    expect(ordered.map((c) => c.loc)).toEqual(['conversations:a']);
  });

  it('ignores stage nodes', () => {
    expect(orderOrdinaryConversations([conv('conversations:a:start', 1)])).toEqual([]);
  });
});

describe('planStartOrderMove (B4)', () => {
  it('swaps the two stored values when every seq is set and distinct', () => {
    const plan = planStartOrderMove(
      [conv('conversations:a', 10), conv('conversations:b', 20), conv('conversations:c', 30)],
      'conversations:b',
      'earlier',
    );
    expect(plan).toEqual([
      { loc: 'conversations:a', seq: 20 },
      { loc: 'conversations:b', seq: 10 },
    ]);
  });

  it('renumbers every ordinary conversation 1..n when any has no seq, then applies the move', () => {
    const plan = planStartOrderMove(
      [conv('conversations:a', null), conv('conversations:b', null), conv('conversations:c', null)],
      'conversations:c',
      'earlier',
    );
    // Displayed order a, b, c; after the move a, c, b.
    expect(plan).toEqual([
      { loc: 'conversations:a', seq: 1 },
      { loc: 'conversations:c', seq: 2 },
      { loc: 'conversations:b', seq: 3 },
    ]);
  });

  it('renumbers when two conversations share a seq, since swapping equal values moves nothing', () => {
    const plan = planStartOrderMove(
      [conv('conversations:a', 5), conv('conversations:b', 5)],
      'conversations:b',
      'earlier',
    );
    expect(plan).toEqual([
      { loc: 'conversations:b', seq: 1 },
      { loc: 'conversations:a', seq: 2 },
    ]);
  });

  it('writes nothing for a move off either end, an unknown loc, or a setup conversation', () => {
    const list = [conv('conversations:a', 1), conv('conversations:b', 2), conv('conversations:s', 3, { isSetup: true })];
    expect(planStartOrderMove(list, 'conversations:a', 'earlier')).toEqual([]);
    expect(planStartOrderMove(list, 'conversations:b', 'later')).toEqual([]);
    expect(planStartOrderMove(list, 'conversations:nope', 'later')).toEqual([]);
    expect(planStartOrderMove(list, 'conversations:s', 'earlier')).toEqual([]);
  });
});
