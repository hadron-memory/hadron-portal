/**
 * The global filter searches what the reader can SEE (@codex on #819).
 *
 * The defect: `includesString` stringifies the ACCESSOR value, and this repo's
 * own conventions make that a number for two whole classes of column — dates
 * (epoch millis, so they sort by instant) and ids/counts (numeric, so they sort
 * numerically). So typing the date on screen matched nothing.
 *
 * Measured before fixing, against TanStack's own `includesString`:
 *
 *   "9/6/2026" vs epoch 1757145600000 → false
 *   "175714"   vs epoch 1757145600000 → true
 *   "#819"     vs 819                 → false
 *
 * The searchable value was the epoch digits, which nobody types.
 */
import { describe, expect, it } from 'vitest';
import { makeGlobalFilterFn, searchableText, type ColumnFormatters } from './global-filter';

const AT_MS = new Date('2026-09-06T08:00:00.000Z').getTime();

const fmt: ColumnFormatters = {
  at: (v) => (typeof v === 'number' ? new Date(v).toLocaleString() : ''),
  prNumber: (v) => (typeof v === 'number' ? `#${v}` : '—'),
};

/** A row whose only job is to answer getValue, like the real one. */
const row = (values: Record<string, unknown>) => ({
  getValue: (columnId: string) => values[columnId],
});

const filter = makeGlobalFilterFn(fmt);

describe('searchableText', () => {
  it('renders through the column formatter when there is one', () => {
    expect(searchableText(fmt, 'prNumber', 819)).toBe('#819');
  });

  it('falls back to the raw value for an unformatted column', () => {
    expect(searchableText(fmt, 'tool', 'github')).toBe('github');
  });

  it('renders absent values as empty, not "null" or "undefined"', () => {
    // The cell turns this into an em dash; what matters here is that the string
    // "null" never becomes a searchable token.
    expect(searchableText(fmt, 'tool', null)).toBe('');
    expect(searchableText(fmt, 'tool', undefined)).toBe('');
  });
});

describe('makeGlobalFilterFn', () => {
  it('matches the DATE a reader can see, not the epoch millis', () => {
    // The exact case @codex named.
    const displayed = new Date(AT_MS).toLocaleString();
    const datePart = displayed.split(',')[0];
    expect(filter(row({ at: AT_MS }), 'at', datePart)).toBe(true);
  });

  it('matches a formatted id as displayed', () => {
    expect(filter(row({ prNumber: 819 }), 'prNumber', '#819')).toBe(true);
  });

  it('still matches the RAW value, for a pasted id or timestamp', () => {
    // Deliberate: a reader types what they see, and pastes what an API gave
    // them. Both must find the row.
    expect(filter(row({ prNumber: 819 }), 'prNumber', '819')).toBe(true);
    expect(filter(row({ at: AT_MS }), 'at', String(AT_MS))).toBe(true);
  });

  it('is case-insensitive on both sides', () => {
    expect(filter(row({ tool: 'GitHub' }), 'tool', 'github')).toBe(true);
    expect(filter(row({ tool: 'github' }), 'tool', 'GITHUB')).toBe(true);
  });

  it('does not match an unrelated needle', () => {
    // The other direction: a filter that matched everything would "fix" the bug
    // by making search useless.
    expect(filter(row({ at: AT_MS }), 'at', 'zzzz')).toBe(false);
    expect(filter(row({ prNumber: 819 }), 'prNumber', '#820')).toBe(false);
  });

  it('matches everything on an empty needle', () => {
    expect(filter(row({ tool: 'github' }), 'tool', '')).toBe(true);
    expect(filter(row({ tool: null }), 'tool', '')).toBe(true);
  });

  it('does not match a null cell against a non-empty needle', () => {
    // An absent value must not become findable by searching "null".
    expect(filter(row({ tool: null }), 'tool', 'null')).toBe(false);
    expect(filter(row({ tool: undefined }), 'tool', 'undefined')).toBe(false);
  });
});
