import { describe, expect, it } from 'vitest';
import { treeReorderAllowed } from './memory-browser-reorder';

// #1929 LOCAL F1: renumbering seq 1…N is safe only over a complete sibling set.
// The server-paged browser must refuse it whenever its pool is incomplete, but
// the unpaged browsers (memory page, agent page) keep main's behaviour exactly.
const complete = { serverPaged: false, truncated: false, continuation: false, serverResults: false, activeFilters: false, hiddenUnshown: false };

describe('treeReorderAllowed', () => {
  it.each([
    ['hidden record/system nodes', { hiddenUnshown: true }],
    ['active facet filters', { activeFilters: true }],
    ['server search results', { serverResults: true }],
    ['a truncated window', { truncated: true }],
    ['a continuation link', { continuation: true }],
  ])('an unpaged browser keeps reorder with %s (unchanged from main)', (_label, over) => {
    expect(treeReorderAllowed({ ...complete, ...over })).toBe(true);
  });

  it('a server-paged browser whose page is the whole, unfiltered set may reorder', () => {
    expect(treeReorderAllowed({ ...complete, serverPaged: true })).toBe(true);
  });

  it.each([
    ['a later or partial page', { truncated: true }],
    ['a page with a continuation even when the count looks complete (#2162 LOCAL F1)', { continuation: true }],
    ['server search results', { serverResults: true }],
    ['active facet filters', { activeFilters: true }],
    ['hidden record/system nodes', { hiddenUnshown: true }],
  ])('a server-paged browser refuses reorder over %s', (_label, over) => {
    expect(treeReorderAllowed({ ...complete, serverPaged: true, ...over })).toBe(false);
  });
});
