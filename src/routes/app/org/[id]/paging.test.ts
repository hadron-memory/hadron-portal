import { describe, expect, it } from 'vitest';
import {
  nextOffset,
  pageHref,
  parsePublicOrgLimit,
  parsePublicOrgOffset,
  previousOffset,
} from './paging';

describe('public organization paging parameters', () => {
  it.each([
    [null, 20],
    ['', 20],
    ['0', 20],
    ['-1', 20],
    ['20.5', 20],
    ['nope', 20],
    ['2147483648', 20],
    ['1', 1],
    ['20', 20],
    ['500', 500],
    ['2147483647', 2147483647],
  ])('parses limit %s as %i', (raw, expected) => {
    expect(parsePublicOrgLimit(raw)).toBe(expected);
  });

  it.each([
    [null, 0],
    ['', 0],
    ['-1', 0],
    ['20.5', 0],
    ['nope', 0],
    ['2147483648', 0],
    ['0', 0],
    ['20', 20],
    ['2147483647', 2147483647],
  ])('parses offset %s as %i', (raw, expected) => {
    expect(parsePublicOrgOffset(raw)).toBe(expected);
  });
});

describe('public organization page claims', () => {
  it('uses hasMore and the served item count for Next', () => {
    expect(nextOffset(0, { items: Array.from({ length: 20 }), hasMore: true })).toBe(20);
    expect(nextOffset(20, { items: [1], hasMore: false })).toBeNull();
  });

  it('never offers a non-advancing Next on an empty page', () => {
    expect(nextOffset(0, { items: [], hasMore: true })).toBeNull();
    expect(nextOffset(2000, { items: [], hasMore: false })).toBeNull();
  });

  it('steps back from a short FINAL page by the effective size, not the final item count', () => {
    const first = { items: Array.from({ length: 20 }), hasMore: true };
    const final = { items: [1], hasMore: false };
    const secondOffset = nextOffset(0, first);
    expect(secondOffset).toBe(20);
    expect(nextOffset(secondOffset!, final)).toBeNull();
    expect(previousOffset(secondOffset!, 20)).toBe(0);
  });

  it('uses the effective served size for Previous, including a capped request', () => {
    expect(previousOffset(20, 20)).toBe(0);
    expect(previousOffset(200, 20)).toBe(180);
    expect(previousOffset(200, 500)).toBe(0);
    expect(previousOffset(500, 500)).toBe(300);
    expect(previousOffset(0, 20)).toBeNull();
  });
});

describe('public organization page links', () => {
  it('preserves unrelated and other-kind params and removes default target params', () => {
    const href = pageHref('/app/org/org-1', '?from=memory&memoriesOffset=20&agentsOffset=40&agentsLimit=50', 'memories', {
      limit: 20,
      offset: 0,
    });
    const url = new URL(href, 'https://portal.test');
    expect(url.pathname).toBe('/app/org/org-1');
    expect(url.searchParams.get('from')).toBe('memory');
    expect(url.searchParams.get('agentsOffset')).toBe('40');
    expect(url.searchParams.get('agentsLimit')).toBe('50');
    expect(url.searchParams.has('memoriesOffset')).toBe(false);
    expect(url.searchParams.has('memoriesLimit')).toBe(false);
  });

  it('updates only the target kind and emits no bare question mark', () => {
    const next = new URL(pageHref('/app/org/org-1', '?from=memory', 'agents', { limit: 50, offset: 40 }), 'https://portal.test');
    expect(next.searchParams.get('agentsLimit')).toBe('50');
    expect(next.searchParams.get('agentsOffset')).toBe('40');
    expect(next.searchParams.get('from')).toBe('memory');
    expect(pageHref('/app/org/org-1', '', 'memories', { limit: 20, offset: 0 })).toBe('/app/org/org-1');
  });
});
