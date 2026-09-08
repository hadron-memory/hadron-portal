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
 *   "9/6/2026" vs epoch 1788681600000 → false
 *   "178868"   vs epoch 1788681600000 → true
 *   "#819"     vs 819                 → false
 *
 * The searchable value was the epoch digits, which nobody types.
 */
import { describe, expect, it } from 'vitest';
import { makeHeadlessTable } from '$lib/table/headlessTable';
import type { PortalColumnDef } from '$lib/table/features';
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

describe('a nullable first row does not disable a column (@codex on #819)', () => {
  // The claim was that TanStack's default `getColumnCanGlobalFilter` samples the
  // FIRST row and disables global filtering for a column whose first value is
  // neither string nor number — so an open session (`endedAt: null`, and the
  // default sort puts the newest first) would make Ended, Plan, Summary and PR
  // unsearchable for every later row.
  //
  // It does not reproduce on the version this repo pins: `getCanGlobalFilter()`
  // is true for all three columns below, and every rendered form still matches.
  // Pinned anyway — the concern is legitimate and a TanStack upgrade could make
  // it true, at which point this fails instead of the search box going quiet.
  //
  // Worth recording: my FIRST probe appeared to confirm the claim, because I
  // searched a hardcoded "9/6/2026" against an epoch I had mistyped as 2025.
  // The instrument was wrong, not the code.
  interface Row {
    name: string;
    endedMs: number | null;
    pr: number | null;
  }
  const MS = new Date('2026-09-06T08:00:00.000Z').getTime();
  const DATA: Row[] = [
    { name: 'open-first', endedMs: null, pr: null }, // the null-carrying FIRST row
    { name: 'closed-later', endedMs: MS, pr: 819 },
  ];
  const columns: PortalColumnDef<Row>[] = [
    { accessorKey: 'name', header: 'Name' },
    { accessorFn: (r) => r.endedMs, id: 'endedMs', header: 'Ended' },
    { accessorFn: (r) => r.pr, id: 'pr', header: 'PR' },
  ];
  const rowFmt: ColumnFormatters = {
    endedMs: (v) => (typeof v === 'number' ? new Date(v).toLocaleString() : ''),
    pr: (v) => (typeof v === 'number' ? `#${v}` : '—'),
  };

  function search(needle: string): string[] {
    const table = makeHeadlessTable<Row>({ data: DATA, columns });
    table.setOptions((prev) => ({ ...prev, globalFilterFn: makeGlobalFilterFn(rowFmt) }));
    table.setGlobalFilter(needle);
    return table.getRowModel().rows.map((r) => r.original.name);
  }

  it('leaves every column globally filterable', () => {
    const table = makeHeadlessTable<Row>({ data: DATA, columns });
    for (const column of table.getAllColumns()) {
      expect(column.getCanGlobalFilter()).toBe(true);
    }
  });

  it('finds a later row by its rendered date', () => {
    // The needle is DERIVED from the rendering, never hardcoded — a literal
    // would pin this test to one locale and one clock.
    const rendered = new Date(MS).toLocaleString();
    expect(search(rendered)).toEqual(['closed-later']);
    expect(search(rendered.split(',')[0])).toEqual(['closed-later']);
  });

  it('finds a later row by its formatted and raw id', () => {
    expect(search('#819')).toEqual(['closed-later']);
    expect(search('819')).toEqual(['closed-later']);
  });
});
