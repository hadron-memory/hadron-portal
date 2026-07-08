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
