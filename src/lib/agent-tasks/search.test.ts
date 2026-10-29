/**
 * portal#1400 — the board's text search: what the URL's `text` becomes, and
 * the links that carry it.
 */
import { describe, expect, it } from 'vitest';
import { BOARD_TEXT_MAX, boardHref, parseBoardText } from './search';

describe('parseBoardText', () => {
  it('trims, and blank or absent is the empty string (so no text is sent)', () => {
    expect(parseBoardText(null)).toBe('');
    expect(parseBoardText('')).toBe('');
    expect(parseBoardText('   \t ')).toBe('');
    expect(parseBoardText('  deploy  ')).toBe('deploy');
  });

  it('never alters what a person typed: wildcards and backslashes stay as typed, once', () => {
    expect(parseBoardText('100%_done\\x')).toBe('100%_done\\x');
  });

  it('never truncates: an overlong value is returned whole so the server can refuse it', () => {
    const long = 'a'.repeat(BOARD_TEXT_MAX + 1);
    expect(parseBoardText(long)).toBe(long);
    expect(parseBoardText(long)).toHaveLength(201);
  });

  it('measures in UTF-16 code units, the server’s measure: an astral character is two', () => {
    expect(BOARD_TEXT_MAX).toBe(200);
    expect('😀'.repeat(100)).toHaveLength(200);
    expect('😀'.repeat(100) + 'a').toHaveLength(201);
    expect(parseBoardText('😀'.repeat(100))).toHaveLength(200);
  });
});

describe('boardHref', () => {
  const base = '/app/apps/app-1/tasks';

  it('the default board is the bare path', () => {
    expect(boardHref(base, 'active', '')).toBe(base);
  });

  it('keeps the status, and encodes the text', () => {
    expect(boardHref(base, 'ended', '')).toBe(`${base}?status=ended`);
    expect(boardHref(base, 'active', 'a b&c=d')).toBe(`${base}?text=a%20b%26c%3Dd`);
    expect(boardHref(base, 'backlog', 'x')).toBe(`${base}?status=backlog&text=x`);
  });

  it('encodes literal wildcards and backslashes so they survive the round trip', () => {
    const href = boardHref(base, 'all', '50%_\\');
    expect(new URL(href, 'http://h').searchParams.get('text')).toBe('50%_\\');
  });
});
