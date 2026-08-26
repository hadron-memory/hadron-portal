import { describe, expect, it } from 'vitest';
import {
  HIDDEN_NODE_TYPES,
  NODE_TYPES,
  isCanonicalNodeType,
  isHiddenNodeType,
} from './node-types';

describe('isCanonicalNodeType', () => {
  it('accepts every offered type and rejects an unknown one', () => {
    for (const t of NODE_TYPES) expect(isCanonicalNodeType(t)).toBe(true);
    expect(isCanonicalNodeType('chat-message')).toBe(false);
    expect(isCanonicalNodeType('')).toBe(false);
  });
});

// #706. This predicate exists because "what is hidden" was written down three
// times — a Set in MemoryBrowser, a second Set inside a $derived in TreeView,
// and an inline `=== 'record' || === 'system'` in the same file. Three panes
// reading three copies is how they came to disagree, which is the defect #706
// was filed about. These tests are what make the single definition worth
// having: they fail if someone re-splits it.
describe('isHiddenNodeType', () => {
  it('hides exactly record and system today', () => {
    expect(isHiddenNodeType('record')).toBe(true);
    expect(isHiddenNodeType('system')).toBe(true);
    expect([...HIDDEN_NODE_TYPES].sort()).toEqual(['record', 'system']);
  });

  it('does not hide an ordinary authored type', () => {
    expect(isHiddenNodeType('info')).toBe(false);
    expect(isHiddenNodeType('reference')).toBe(false);
    expect(isHiddenNodeType('chat')).toBe(false);
  });

  it('treats a missing nodeType as `info`, i.e. VISIBLE', () => {
    // The half that was duplicated at every call site as `n.nodeType ?? 'info'`.
    // A caller that forgot it would compare `undefined` against the set — false
    // by luck here, but the moment the default changes, "forgot it" and "meant
    // it" become different answers. Centralised so there is one.
    expect(isHiddenNodeType(null)).toBe(false);
    expect(isHiddenNodeType(undefined)).toBe(false);
    expect(isHiddenNodeType('')).toBe(false);
  });

  it('does not hide a type merely because it is absent from NODE_TYPES', () => {
    // The two lists answer different questions: NODE_TYPES is what the Settings
    // dropdown OFFERS, HIDDEN_NODE_TYPES is what the browser HIDES. `chat-message`
    // is in neither today — not offerable, and not hidden — and #706 anticipates
    // it joining the hidden set. If someone conflates the lists, this reds.
    expect(isCanonicalNodeType('chat-message')).toBe(false);
    expect(isHiddenNodeType('chat-message')).toBe(false);
  });

  it('is a set the panes share, not a copy each pane makes', () => {
    // The invariant the three-copy bug violated, stated as a test: every hidden
    // type must be hidden by the predicate, and nothing else may be. A second
    // definition drifting from this one cannot satisfy both halves.
    for (const t of HIDDEN_NODE_TYPES) expect(isHiddenNodeType(t)).toBe(true);
    for (const t of NODE_TYPES) {
      expect(isHiddenNodeType(t)).toBe(HIDDEN_NODE_TYPES.has(t));
    }
  });
});
