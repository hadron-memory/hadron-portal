import { describe, expect, it } from 'vitest';
import { isSearchResponse, isSearchableQuery, outcomeOf } from './team-chat-search';

describe('isSearchableQuery', () => {
  it('counts code points, untrimmed, 2 to 200', () => {
    expect(isSearchableQuery('a')).toBe(false);
    expect(isSearchableQuery('ab')).toBe(true);
    expect(isSearchableQuery(' a')).toBe(true);
    expect(isSearchableQuery('😀')).toBe(false);
    expect(isSearchableQuery('😀😀')).toBe(true);
    expect(isSearchableQuery('x'.repeat(200))).toBe(true);
    expect(isSearchableQuery('x'.repeat(201))).toBe(false);
  });
});

describe('outcomeOf', () => {
  it('only an empty COMPLETE page is no matches', () => {
    expect(outcomeOf([], true, null)).toBe('no-matches');
    expect(outcomeOf([], false, 'c')).toBe('scan-limit');
  });
  it('a full page with a cursor offers more; a complete one does not', () => {
    expect(outcomeOf([1], false, 'c')).toBe('more');
    expect(outcomeOf([1], true, null)).toBe('matches');
  });
});

describe('isSearchResponse', () => {
  it('accepts a page and a known refusal, and nothing else', () => {
    expect(isSearchResponse({ ok: true, items: [{ seq: 1 }], complete: true })).toBe(true);
    expect(isSearchResponse({ ok: false, code: 'TEAM_CHAT_SEARCH_ENCRYPTED' })).toBe(true);
    expect(isSearchResponse({ ok: false, code: 'SOMETHING_NEW' })).toBe(false);
    expect(isSearchResponse({ ok: true, items: [null], complete: true })).toBe(false);
    expect(isSearchResponse({ ok: true, items: [], complete: 'yes' })).toBe(false);
    expect(isSearchResponse(null)).toBe(false);
  });
});
