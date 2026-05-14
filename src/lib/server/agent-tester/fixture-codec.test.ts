/**
 * Spec 019 T023 — fixture-codec unit tests.
 */
import { describe, expect, it } from 'vitest';
import {
  newFixtureRecord,
  applyRunResult,
  encodeFixture,
  decodeFixture,
  summarize,
  FixtureValidationError,
  type FixtureRecord,
} from './fixture-codec';

describe('newFixtureRecord', () => {
  it('builds a v1 record with a length-1 turns list (forward-compat for multi-turn v2)', () => {
    const r = newFixtureRecord({
      label: 'welcome-greeting',
      turn: { user: 'hello', persona: null, assertion: null },
    });
    expect(r.version).toBe(1);
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].user).toBe('hello');
    expect(r.turns[0].capturedReply).toBeNull();
  });

  it('captures a baseline immediately when `capture` is provided', () => {
    const r = newFixtureRecord({
      label: 'l',
      turn: { user: 'hello', persona: null, assertion: null },
      capture: {
        reply: 'Hi!',
        route: { conversationLoc: 'c', stageLoc: 's', personaName: null },
        verdict: 'pass',
      },
    });
    expect(r.turns[0].capturedReply).toBe('Hi!');
    expect(r.turns[0].capturedVerdict).toBe('pass');
    expect(r.turns[0].capturedAt).toBeTruthy();
  });

  it('rejects an empty label', () => {
    expect(() => newFixtureRecord({
      label: '   ',
      turn: { user: 'x', persona: null, assertion: null },
    })).toThrow(FixtureValidationError);
  });

  it('rejects a label > 80 chars', () => {
    expect(() => newFixtureRecord({
      label: 'x'.repeat(81),
      turn: { user: 'x', persona: null, assertion: null },
    })).toThrow(FixtureValidationError);
  });

  it('rejects an empty user message', () => {
    expect(() => newFixtureRecord({
      label: 'l',
      turn: { user: '  ', persona: null, assertion: null },
    })).toThrow(FixtureValidationError);
  });

  it('rejects an invalid regex pattern', () => {
    expect(() => newFixtureRecord({
      label: 'l',
      turn: {
        user: 'x', persona: null,
        assertion: { mode: 'regex', pattern: '(unclosed', flags: '' },
      },
    })).toThrow(FixtureValidationError);
  });

  it('rejects an llm-judge threshold outside [0,1]', () => {
    expect(() => newFixtureRecord({
      label: 'l',
      turn: {
        user: 'x', persona: null,
        assertion: { mode: 'llm-judge', criterion: 'c', threshold: 1.5 },
      },
    })).toThrow(FixtureValidationError);
  });
});

describe('applyRunResult', () => {
  it('updates the first turn with the new baseline', () => {
    const r = newFixtureRecord({
      label: 'l',
      turn: { user: 'hi', persona: null, assertion: null },
    });
    const updated = applyRunResult(r, {
      reply: 'Hello!',
      route: { conversationLoc: 'c', stageLoc: 's', personaName: null },
      verdict: 'pass',
    });
    expect(updated.turns[0].capturedReply).toBe('Hello!');
    expect(updated.turns[0].capturedVerdict).toBe('pass');
    expect(updated.turns[0].capturedAt).toBeTruthy();
    // updatedAt is bumped — same-ms collisions are tolerated (≥, not >).
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(r.updatedAt));
    expect(r.turns[0].capturedReply).toBeNull(); // input unchanged
  });
});

describe('encodeFixture / decodeFixture round-trip', () => {
  it('preserves all fields', () => {
    const r = newFixtureRecord({
      label: 'preserved',
      turn: {
        user: 'hello',
        persona: 'rude-user',
        assertion: { mode: 'literal-contains', value: 'welcome' },
      },
      capture: {
        reply: 'Welcome!',
        route: {
          conversationLoc: 'conversations:setup',
          stageLoc: 'conversations:setup:onboard',
          personaName: 'rude-user',
        },
        verdict: 'pass',
      },
    });
    const encoded = encodeFixture(r);
    const decoded = decodeFixture(encoded);
    expect(decoded).toEqual(r);
  });

  it('decodeFixture returns null for malformed input (does not throw)', () => {
    expect(decodeFixture(null)).toBeNull();
    expect(decodeFixture('not an object')).toBeNull();
    expect(decodeFixture({})).toBeNull();
    expect(decodeFixture({ version: 1 })).toBeNull(); // missing label / turns
    expect(decodeFixture({ version: 1, label: 'l', turns: [] })).toBeNull(); // empty turns
    expect(decodeFixture({ version: 1, label: 'l', turns: [{}] })).toBeNull(); // no user
    expect(decodeFixture({ version: 2, label: 'l', turns: [{ user: 'x' }] })).toBeNull(); // future version
  });
});

describe('summarize', () => {
  it('extracts a list-view summary from a captured fixture', () => {
    const r = newFixtureRecord({
      label: 'lbl',
      turn: {
        user: 'hi',
        persona: null,
        assertion: { mode: 'regex', pattern: '^Hi', flags: '' },
      },
      capture: {
        reply: 'Hi!',
        route: { conversationLoc: 'c', stageLoc: 's', personaName: null },
        verdict: 'fail',
      },
    });
    const s = summarize('fixtures:abc', 'node-abc', r);
    expect(s.id).toBe('node-abc');
    expect(s.loc).toBe('fixtures:abc');
    expect(s.label).toBe('lbl');
    expect(s.hasBaseline).toBe(true);
    expect(s.capturedVerdict).toBe('fail');
    expect(s.assertionMode).toBe('regex');
  });

  it('hasBaseline=false for an unrun fixture', () => {
    const r = newFixtureRecord({
      label: 'lbl',
      turn: { user: 'hi', persona: null, assertion: null },
    });
    const s = summarize('fixtures:abc', 'node-abc', r);
    expect(s.hasBaseline).toBe(false);
    expect(s.capturedVerdict).toBeNull();
  });
});
