import { describe, it, expect } from 'vitest';
import { scopeTreeEntriesToSearch } from './graph-utils';
import type { TreeEntry } from './types';

function entry(id: string, name: string, isVirtual = false): TreeEntry {
  return { id, nodeId: isVirtual ? null : `pk-${id}`, name, seq: null, nodeType: 'info', hasActions: false, isVirtual };
}

// Tree mirroring the #531 repro: a `design` folder with a node whose NAME has no
// "payment", but which the server content search matched (via a `payments` tag).
const POOL: TreeEntry[] = [
  entry('design', 'design', true),
  entry('design:ai-credit-billing', 'AI-credit billing — metering audit'),
  entry('design:export-node-pdf', 'exportNodeToPDF'),
  entry('conventions', 'conventions', true),
  entry('conventions:llm-usage-metering', 'recordLlmUsage chokepoint'),
];

describe('scopeTreeEntriesToSearch', () => {
  it('returns the whole pool when there is no search', () => {
    expect(scopeTreeEntriesToSearch(POOL, null, '')).toEqual(POOL);
    expect(scopeTreeEntriesToSearch(POOL, null, '   ')).toEqual(POOL);
  });

  it('#531: scopes to server-matched locs even when the node NAME does not match the query', () => {
    // "payment" matched design:ai-credit-billing server-side (tag/body), though
    // its name contains no "payment".
    const locs = new Set(['design:ai-credit-billing']);
    const result = scopeTreeEntriesToSearch(POOL, locs, 'payment').map((e) => e.id);
    // The matched node AND its `design` ancestor (so it stays reachable)...
    expect(result).toContain('design:ai-credit-billing');
    expect(result).toContain('design');
    // ...but nothing unrelated.
    expect(result).not.toContain('design:export-node-pdf');
    expect(result).not.toContain('conventions');
    expect(result).not.toContain('conventions:llm-usage-metering');
  });

  it('#531: an empty server-match set hides everything (a real "no matches")', () => {
    expect(scopeTreeEntriesToSearch(POOL, new Set(), 'zzzznope')).toEqual([]);
  });

  it('falls back to the local name/id substring match when no server search is active', () => {
    const result = scopeTreeEntriesToSearch(POOL, null, 'billing').map((e) => e.id);
    expect(result).toContain('design:ai-credit-billing'); // name match
    expect(result).toContain('design'); // ancestor
    expect(result).not.toContain('design:export-node-pdf');
  });

  it('name/id fallback does NOT find a tag/body-only term — the exact bug #531 fixes for the server path', () => {
    // Proves the old behaviour: without the server-match set, "payment" finds
    // nothing (the node name/id lack it) — which is why the server locs are needed.
    expect(scopeTreeEntriesToSearch(POOL, null, 'payment')).toEqual([]);
  });
});
