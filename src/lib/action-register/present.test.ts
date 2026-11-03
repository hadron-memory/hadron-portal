/**
 * portal#1649 — the pure half of the action-register views: how URL paging is
 * read, what a row says it resolves to, and what a page may claim about the
 * whole list. The server owns every count and state; this only labels them.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMIT, MAX_LIMIT, parseLimit, parseOffset, pageClaims, rowKind } from './present';

describe('paging from the URL (cor:api:120:04)', () => {
  it('defaults to 20 and offset 0', () => {
    expect(parseLimit(null)).toBe(DEFAULT_LIMIT);
    expect(DEFAULT_LIMIT).toBe(20);
    expect(parseOffset(null)).toBe(0);
  });
  it('sends a limit above the server maximum unchanged (the gate: the server clamps), and steps by the effective 200', () => {
    expect(MAX_LIMIT).toBe(200);
    expect(parseLimit('500')).toBe(500);
    expect(parseLimit('201')).toBe(201);
    expect(parseLimit('199')).toBe(199);
    // GraphQL Int is 32-bit: a larger number must not turn the page into a failure.
    expect(parseLimit('3000000000')).toBe(2147483647);
    // The server serves 200 rows for limit 500; the step must be 200 or codes 200..499 are skipped.
    const asked = parseLimit('500');
    expect(pageClaims({ offset: 0, limit: asked, total: 900, hasMore: true }).nextOffset).toBe(200);
    expect(pageClaims({ offset: 400, limit: asked, total: 900, hasMore: true }).prevOffset).toBe(200);
    expect(pageClaims({ offset: 200, limit: asked, total: 900, hasMore: false }).prevOffset).toBe(0);
    expect(pageClaims({ offset: 0, limit: 20, total: 900, hasMore: true }).nextOffset).toBe(20);
  });
  it('falls back on junk, zero, negative and fractional values', () => {
    for (const bad of ['', 'x', '0', '-3', '2.5', '1e3']) expect(parseLimit(bad)).toBe(20);
    for (const bad of ['', 'x', '-1', '1.5']) expect(parseOffset(bad)).toBe(0);
  });
  it('keeps a large offset: past-the-end is an empty page, not an error', () => {
    expect(parseOffset('4000')).toBe(4000);
  });
});

describe('what a page may claim about the whole list', () => {
  it('only the first page with no more rows is the whole list', () => {
    expect(pageClaims({ offset: 0, limit: 20, total: 3, hasMore: false }).wholeList).toBe(true);
    expect(pageClaims({ offset: 20, limit: 20, total: 25, hasMore: false }).wholeList).toBe(false);
    expect(pageClaims({ offset: 0, limit: 20, total: 45, hasMore: true }).wholeList).toBe(false);
  });
  it('Next comes from hasMore, Previous from offset, and previous never goes below 0', () => {
    expect(pageClaims({ offset: 0, limit: 20, total: 45, hasMore: true })).toMatchObject({ nextOffset: 20, prevOffset: null });
    expect(pageClaims({ offset: 20, limit: 20, total: 45, hasMore: true })).toMatchObject({ nextOffset: 40, prevOffset: 0 });
    expect(pageClaims({ offset: 10, limit: 20, total: 45, hasMore: false })).toMatchObject({ nextOffset: null, prevOffset: 0 });
  });
  it('an offset past the end still offers Previous', () => {
    expect(pageClaims({ offset: 200, limit: 20, total: 45, hasMore: false })).toMatchObject({ nextOffset: null, prevOffset: 180 });
  });
});

describe('what a row resolves to', () => {
  const here = 'hrn:node:acme.com:team:tasks:build';
  it('MAPPED to exactly this definition is the only "sends work here"', () => {
    expect(rowKind({ code: 'a', state: 'MAPPED', taskLoc: 'tasks:build', taskUrn: here }, here)).toBe('sends-here');
  });
  it('MAPPED to another taskUrn is an override, even with the same loc', () => {
    expect(rowKind({ code: 'a', state: 'MAPPED', taskLoc: 'tasks:build', taskUrn: 'hrn:node:acme.com:child:tasks:build' }, here)).toBe('resolves-elsewhere');
  });
  it('without a definition URN a MAPPED row is just mapped (the App view)', () => {
    expect(rowKind({ code: 'a', state: 'MAPPED', taskLoc: 'x', taskUrn: here }, null)).toBe('mapped');
  });
  it('UNRESOLVED and UNMAPPED keep their own kinds, whatever else they carry', () => {
    expect(rowKind({ code: 'a', state: 'UNRESOLVED', taskLoc: 'x', taskUrn: null }, here)).toBe('unresolved');
    expect(rowKind({ code: 'a', state: 'UNMAPPED', taskLoc: null, taskUrn: null }, here)).toBe('unmapped');
  });
  it('an unknown state is never read as mapped', () => {
    expect(rowKind({ code: 'a', state: 'SOMETHING_NEW' as never, taskLoc: 'x', taskUrn: here }, here)).toBe('unknown');
  });
});
