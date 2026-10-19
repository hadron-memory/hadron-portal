import { describe, expect, it } from 'vitest';
import { nodeHref, discussionHref } from './comment-hit-links';
type LinkNode = Parameters<typeof nodeHref>[0];

// A malformed target isn't a supported whole-component input: the formatter
// requires it. Only the unchanged defensive URL seam is exercised here (#1058).
const noTarget: LinkNode = { id: 'comment', memory: { id: 'memory', urn: 'hrn:mem:example.com:notes', name: 'Notes' } };
const withTarget: LinkNode = { ...noTarget, comment: {
  id: 'comment', isTopLevel: true, state: 'OPEN', deleted: false, anchorRevision: 1,
  author: { kind: 'USER', user: null, worker: null, agent: null, app: null },
  target: { id: 'target', name: 'Target', urn: 'hrn:node:example.com:notes:target', nodeType: 'info', revSeq: 1 },
} };

describe('comment hit URL fallback seam (#1058)', () => {
  it('prefers an explicit base for the target discussion', () => {
    expect(discussionHref(withTarget, '/explicit')).toBe('/explicit/nodes/target?tab=discussion');
  });
  it('uses the row memory when no base is supplied', () => {
    expect(discussionHref(withTarget)).toBe('/app/memories/memory/nodes/target?tab=discussion');
  });
  it('a missing target yields the existing node link fallback', () => {
    expect(discussionHref(noTarget, '/explicit')).toBe('');
    expect(discussionHref(noTarget, '/explicit') || nodeHref(noTarget, '/explicit')).toBe('/explicit/nodes/comment');
    expect(nodeHref(noTarget)).toBe('/app/memories/memory/nodes/comment');
  });
  it('without a base or row memory neither link is fabricated', () => {
    const unaddressable: LinkNode = { ...withTarget, memory: null };
    expect(discussionHref(unaddressable)).toBe('');
    expect(nodeHref(unaddressable)).toBe('');
  });
});
