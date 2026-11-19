/**
 * Start order of a conversation (S7, portal#2064).
 *
 * The order is `Node.seq`, ascending, nulls last, ties by `loc` in code-unit
 * order (Q14, Q14a). Setup and fallback conversations stay outside it and carry
 * no number (Q13). Pure data -> data, shared by the canvas and the move action.
 */

export interface OrderableConversation {
  loc: string;
  seq?: number | null;
  data?: unknown;
}

export type MoveDirection = 'earlier' | 'later';

/** One `seq`-only write. Never carries `data`. */
export interface SeqWrite {
  loc: string;
  seq: number;
}

// Same shape as isConversationLoc in conversation-canvas, which imports this
// module: restated here so the two files do not import each other.
const isConversationNodeLoc = (loc: string) => loc.startsWith('conversations:') && loc.split(':').length === 2;

function flagOf(data: unknown, key: 'isSetup' | 'isFallback'): boolean {
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>)[key] === true;
}

/** True for a conversation that takes part in the start order. */
export function isOrdinaryConversation(c: OrderableConversation): boolean {
  return isConversationNodeLoc(c.loc) && !flagOf(c.data, 'isSetup') && !flagOf(c.data, 'isFallback');
}

// Code-unit comparison on purpose: localeCompare is locale-dependent and would
// not agree with the runtime's order.
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function seqOf(c: OrderableConversation): number | null {
  return typeof c.seq === 'number' && Number.isFinite(c.seq) ? c.seq : null;
}

/** Ordinary conversations in start order. */
export function orderOrdinaryConversations<T extends OrderableConversation>(conversations: readonly T[]): T[] {
  return conversations
    .filter(isOrdinaryConversation)
    .sort((a, b) => {
      const sa = seqOf(a);
      const sb = seqOf(b);
      if (sa !== sb) {
        if (sa === null) return 1;
        if (sb === null) return -1;
        return sa - sb;
      }
      return byCodeUnit(a.loc, b.loc);
    });
}

/**
 * The `seq` writes that move one conversation a step earlier or later, in the
 * order they must be made.
 *
 * - When every ordinary conversation has its own `seq`, the move swaps the two
 *   stored values, so two writes.
 * - Otherwise (a `seq` is missing, or two share one, so a swap would move
 *   nothing) every ordinary conversation is renumbered 1..n in its new order,
 *   and only the ones whose stored value changes are written.
 *
 * A move off either end, of an unknown loc, or of a setup/fallback conversation
 * plans nothing.
 */
export function planStartOrderMove<T extends OrderableConversation>(
  conversations: readonly T[],
  loc: string,
  direction: MoveDirection,
): SeqWrite[] {
  const ordered = orderOrdinaryConversations(conversations);
  const from = ordered.findIndex((c) => c.loc === loc);
  const to = direction === 'earlier' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ordered.length) return [];

  const seqs = ordered.map(seqOf);
  const distinct = seqs.every((s) => s !== null) && new Set(seqs).size === seqs.length;

  if (distinct) {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return [
      { loc: ordered[lo].loc, seq: seqs[hi] as number },
      { loc: ordered[hi].loc, seq: seqs[lo] as number },
    ];
  }

  const next = [...ordered];
  [next[from], next[to]] = [next[to], next[from]];
  const writes: SeqWrite[] = [];
  next.forEach((c, i) => {
    if (seqOf(c) !== i + 1) writes.push({ loc: c.loc, seq: i + 1 });
  });
  return writes;
}
