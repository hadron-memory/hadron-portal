import { describe, expect, it } from 'vitest';
import {
  buildRoutingName,
  isRoutingName,
  nextFreeRoutingIndex,
  parseRoutingName,
  routingIndexOf,
  routingNameOf,
  routingOrder,
  slugifyLabel,
} from './routing';

describe('isRoutingName', () => {
  it('accepts next and next.-prefixed names only', () => {
    expect(isRoutingName('next')).toBe(true);
    expect(isRoutingName('next.1')).toBe(true);
    expect(isRoutingName('next.1.high-confidence')).toBe(true);
    expect(isRoutingName('documents')).toBe(false);
    expect(isRoutingName('nexted')).toBe(false);
    expect(isRoutingName('depends-on')).toBe(false);
    expect(isRoutingName('')).toBe(false);
  });
});

describe('routingNameOf', () => {
  it('prefers the explicit name', () => {
    expect(routingNameOf({ name: 'next.2', loc: 'a:documents:b' }, 'a')).toBe('next.2');
  });

  it('derives from the loc segment when unnamed (walker parity)', () => {
    expect(routingNameOf({ name: null, loc: 'classify:next:act' }, 'classify')).toBe('next');
    expect(routingNameOf({ name: null, loc: 'flows:classify:next:act' }, 'flows:classify')).toBe('next');
    expect(routingNameOf({ name: null, loc: 'classify:documents:spec' }, 'classify')).toBe('documents');
  });
});

describe('parse/build routing names', () => {
  it('round-trips index + label forms', () => {
    expect(parseRoutingName('next')).toEqual({ index: null, label: null });
    expect(parseRoutingName('next.2')).toEqual({ index: 2, label: null });
    expect(parseRoutingName('next.2.high-confidence')).toEqual({ index: 2, label: 'high-confidence' });
    expect(parseRoutingName('next.foo')).toEqual({ index: null, label: 'foo' });

    expect(buildRoutingName(null, '')).toBe('next');
    expect(buildRoutingName(2, '')).toBe('next.2');
    expect(buildRoutingName(2, 'High Confidence')).toBe('next.2.high-confidence');
    expect(buildRoutingName(null, 'fallback')).toBe('next.fallback');
  });

  it('slugifies labels so dots and colons never reach the name', () => {
    expect(slugifyLabel('High Confidence!')).toBe('high-confidence');
    expect(slugifyLabel('a.b:c')).toBe('abc');
    expect(slugifyLabel('  spaced   out  ')).toBe('spaced-out');
    expect(slugifyLabel('___')).toBe('');
  });
});

describe('routingIndexOf', () => {
  it('is numeric, with missing/non-numeric sorting last', () => {
    expect(routingIndexOf('next.2')).toBe(2);
    expect(routingIndexOf('next.10')).toBe(10);
    expect(routingIndexOf('next')).toBe(Number.POSITIVE_INFINITY);
    expect(routingIndexOf('next.fallback')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('routingOrder', () => {
  const cond = { '>': [{ var: 'message.data.confidence' }, 0.8] };

  it('filters non-routing edges and orders priority asc → numeric index → loc', () => {
    const edges = [
      { name: 'documents', loc: 's:documents:spec', priority: 0, condition: null },
      { name: 'next.10', loc: 's:next-10:j', priority: 0, condition: cond },
      { name: 'next.2', loc: 's:next-2:b', priority: 0, condition: cond },
      { name: 'next.1', loc: 's:next-1:a', priority: 5, condition: cond },
    ];
    const order = routingOrder(edges, 's');
    expect(order.map((e) => e.routingName)).toEqual(['next.2', 'next.10', 'next.1']);
    expect(order.map((e) => e.position)).toEqual([1, 2, 3]);
  });

  it('sorts numerically, not lexically (next.2 before next.10)', () => {
    const edges = [
      { name: 'next.10', loc: 's:a:x', condition: cond },
      { name: 'next.2', loc: 's:b:y', condition: cond },
    ];
    expect(routingOrder(edges, 's').map((e) => e.routingName)).toEqual(['next.2', 'next.10']);
  });

  it('marks the first condition-less edge as fall-through and later edges unreachable', () => {
    const edges = [
      { name: 'next.1', loc: 's:a:x', condition: cond },
      { name: 'next.2', loc: 's:b:y', condition: null },
      { name: 'next.3', loc: 's:c:z', condition: cond },
    ];
    const order = routingOrder(edges, 's');
    expect(order[0]).toMatchObject({ isFallThrough: false, isUnreachable: false });
    expect(order[1]).toMatchObject({ isFallThrough: true, isUnreachable: false });
    expect(order[2]).toMatchObject({ isFallThrough: false, isUnreachable: true });
  });

  it('breaks priority ties by loc when indexes match', () => {
    const edges = [
      { name: 'next', loc: 's:next:b', condition: null },
      { name: 'next', loc: 's:next:a', condition: cond },
    ];
    expect(routingOrder(edges, 's').map((e) => e.edge.loc)).toEqual(['s:next:a', 's:next:b']);
  });
});

describe('nextFreeRoutingIndex', () => {
  it('is max existing index + 1, starting at 1', () => {
    expect(nextFreeRoutingIndex([], 's')).toBe(1);
    expect(
      nextFreeRoutingIndex(
        [
          { name: 'next.2', loc: 's:a:x' },
          { name: 'documents', loc: 's:d:y' },
          { name: 'next', loc: 's:n:z' },
        ],
        's',
      ),
    ).toBe(3);
  });
});
