import { describe, expect, it } from 'vitest';
import { describeCondition, describeField } from './describe';
import type { UiGroup } from './types';

const clause = (field: string, operator: string, literal?: string) =>
  ({
    kind: 'clause',
    field,
    operator,
    ...(literal !== undefined ? { value: { kind: 'literal', literal } } : {}),
  }) as never;

const group = (combinator: 'and' | 'or', children: unknown[]): UiGroup =>
  ({ kind: 'group', combinator, children }) as UiGroup;

describe('describeField', () => {
  it('strips the envelope prefix', () => {
    expect(describeField('message.data.confidence')).toBe('confidence');
  });
  it('uses catalog labels for curated paths', () => {
    expect(describeField('chat.message_count')).toBe('Number of messages in this chat');
  });
  it('passes unknown paths through', () => {
    expect(describeField('memory.business_type')).toBe('memory.business_type');
  });
});

// #835. Belt-and-braces rather than a live defect: `deserialize()` refuses any
// operator outside `UI_OPERATORS`, which is already a Set and therefore immune,
// so a clause built the normal way cannot carry one of these. Pinned because
// the `?? clause.operator` fallback is what a hand-built tree relies on, and it
// does NOT fire on an inherited key — a function is not nullish, so the phrase
// slot would have been filled with `function Object() { [native code] }`
// interpolated into a user-facing sentence.
describe('describeCondition — inherited operator keys (#835)', () => {
  it.each(['constructor', '__proto__', 'toString', 'valueOf'])(
    'shows the operator %s verbatim rather than an inherited value',
    (operator) => {
      const out = describeCondition(group('and', [clause('score', operator, '3')]));
      // The documented fallback is the operator itself, so assert exactly that.
      expect(out).toBe(`when score ${operator} 3`);
    },
  );
});

describe('describeCondition', () => {
  it('is null for an empty condition (caller phrases "always")', () => {
    expect(describeCondition(null)).toBeNull();
    expect(describeCondition(group('and', []))).toBeNull();
  });

  it('renders the canonical example', () => {
    expect(describeCondition(group('and', [clause('message.data.confidence', '>', '0.8')]))).toBe(
      'when confidence is greater than 0.8',
    );
  });

  it('renders missing, in, and combinators', () => {
    expect(describeCondition(group('and', [clause('memory.business_type', 'missing')]))).toBe(
      'when memory.business_type is not set',
    );
    expect(
      describeCondition(group('or', [clause('message.data.intent', '==', 'question'), clause('message.data.intent', 'in', 'billing, sales')])),
    ).toBe('when intent is question or intent is one of billing or sales');
  });

  it('parenthesizes nested groups', () => {
    expect(
      describeCondition(
        group('and', [
          clause('message.data.confidence', '>=', '0.5'),
          group('or', [clause('message.data.intent', '==', 'a'), clause('message.data.intent', '==', 'b')]),
        ]),
      ),
    ).toBe('when confidence is at least 0.5 and (intent is a or intent is b)');
  });

  it('renders variable right-hand sides with their display name', () => {
    expect(
      describeCondition(
        group('and', [
          {
            kind: 'clause',
            field: 'message.data.score',
            operator: '<',
            value: { kind: 'variable', path: 'message.data.threshold' },
          } as never,
        ]),
      ),
    ).toBe('when score is less than threshold');
  });
});
