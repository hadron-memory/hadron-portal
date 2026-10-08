import { describe, it, expect } from 'vitest';
import { graphNodeHref, scopeTreeEntriesToSearch, withoutHiddenTreeEntries } from './graph-utils';
import { isHiddenNodeType } from './node-types';
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

  it('#531: scopes to server-matched node PKs even when the node NAME does not match the query', () => {
    // "payment" matched design:ai-credit-billing server-side (tag/body), though
    // its name contains no "payment". The server publishes the PK (n.id).
    const ids = new Set(['pk-design:ai-credit-billing']);
    const result = scopeTreeEntriesToSearch(POOL, ids, 'payment').map((e) => e.id);
    // The matched node AND its `design` ancestor (so it stays reachable)...
    expect(result).toContain('design:ai-credit-billing');
    expect(result).toContain('design');
    // ...but nothing unrelated.
    expect(result).not.toContain('design:export-node-pdf');
    expect(result).not.toContain('conventions');
    expect(result).not.toContain('conventions:llm-usage-metering');
  });

  it('#531: matches on the PK, so a memory-URN-prefixed loc still resolves (normalization-proof)', () => {
    // TreeEntry.id is the URN-prefix-normalized loc; the server hit set carries
    // PKs, so scoping is immune to whether the raw server loc was prefixed.
    const ids = new Set(['pk-design:ai-credit-billing']);
    const result = scopeTreeEntriesToSearch(POOL, ids, 'payment').map((e) => e.id);
    expect(result).toContain('design:ai-credit-billing');
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

describe('withoutHiddenTreeEntries', () => {
  const typed = (id: string, nodeType: string): TreeEntry => ({ ...entry(id, id), nodeType });

  it('portal#1014: a folder holding only comments is dropped, not shown empty', () => {
    const entries = [entry('comments', 'comments', true), typed('comments:c1', 'comment'), typed('comments:c2', 'comment'), typed('spec', 'info')];
    expect(withoutHiddenTreeEntries(entries, isHiddenNodeType).map((e) => e.id)).toEqual(['spec']);
  });

  it('keeps a virtual folder while something visible sits under it, at any depth', () => {
    const entries = [entry('a', 'a', true), entry('a:b', 'b', true), typed('a:b:c', 'info'), typed('a:b:r', 'record')];
    expect(withoutHiddenTreeEntries(entries, isHiddenNodeType).map((e) => e.id)).toEqual(['a', 'a:b', 'a:b:c']);
  });

  it('a REAL node of a visible type stays even when everything under it is hidden', () => {
    const entries = [typed('spec', 'info'), typed('spec:x', 'comment')];
    expect(withoutHiddenTreeEntries(entries, isHiddenNodeType).map((e) => e.id)).toEqual(['spec']);
  });
});

describe('graphNodeHref (#1017)', () => {
  const topic = { id: '01node', urn: 'hrn:node:acme.com:docs:guides:setup' };

  it('opens the node page directly on a single-memory graph', () => {
    expect(graphNodeHref('/app/memories/01mem', topic)).toBe('/app/memories/01mem/nodes/01node');
  });

  it('falls back to the URN resolver on a multi-memory graph, which passes no basePath', () => {
    expect(graphNodeHref('', topic)).toBe('/app/u/hrn:node:acme.com:docs:guides:setup');
    expect(graphNodeHref(undefined, topic)).toBe('/app/u/hrn:node:acme.com:docs:guides:setup');
  });
});
