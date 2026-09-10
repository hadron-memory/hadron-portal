import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { lossyAccessors, scanSource, svelteFilesUnder } from './check-grid-filters.mjs';

/**
 * #820 — the gate's own test.
 *
 * A gate that decides NOT to look at something has a hiding place in it, so the
 * cases worth stating are the ones it stays SILENT on: each has to be silent
 * for a reason
 * (`hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`).
 */

const INCLUDES = "  globalFilterFn: 'includesString',";
const SWEPT = '  globalFilterFn: makeGlobalFilterFn<Row>(fmt),';

describe('lossyAccessors', () => {
  it.each([
    ['epoch via a *DateMs helper', '{ accessorFn: (row) => dateMs(row.createdAt), id: "createdAt" },'],
    ['a route-local date helper', '{ accessorFn: (row) => keyDateMs(row.lastUsedAt), id: "lastUsedAt" },'],
    ['elapsed millis', '{ accessorFn: (row) => durationMs(row.startedAt, row.endedAt), id: "duration" },'],
    ['a pre-computed *Ms field', '{ accessorFn: (row) => row.uploadedMs, id: "uploaded" },'],
    ['a getTime() call', '{ accessorFn: (row) => new Date(row.at).getTime(), id: "at" },'],
    ['a summed count', '{ accessorFn: (r) => (r.tokensIn ?? 0) + (r.tokensOut ?? 0), id: "tokens" },'],
    ['a derived length', '{ accessorFn: (row) => row.memoryItems.length + (row.systemMemoryId ? 1 : 0), id: "memories" },'],
    ['a byte size', '{ accessorFn: (row) => row.sizeBytes, id: "size" },'],
  ])('sees %s', (_what, line) => {
    expect(lossyAccessors(line)).toHaveLength(1);
  });

  // A string accessor renders as itself, so `includesString` searches exactly
  // what the reader sees and there is nothing to fix.
  it.each([
    ['a plain string field', '{ accessorFn: (row) => row.name, id: "name" },'],
    ['a joined string', '{ accessorFn: (r) => (r.changes ?? []).join(" "), id: "changes" },'],
    ['a label lookup', '{ accessorFn: (g) => grantStatusLabel[grantStatusKind(g)], id: "status" },'],
  ])('stays silent on %s', (_what, line) => {
    expect(lossyAccessors(line)).toEqual([]);
  });
});

describe('scanSource', () => {
  it('flags a file that pairs includesString with a lossy accessor', () => {
    const hit = scanSource('Grid.svelte', `{ accessorFn: (r) => dateMs(r.createdAt), id: 'createdAt' },\n${INCLUDES}\n`);
    expect(hit).toMatchObject({ file: 'Grid.svelte', filterLine: 2 });
    expect(hit?.lossy).toHaveLength(1);
  });

  // BOTH halves are required, and each silence has its own reason.
  it('stays silent when the filter has already been swept', () => {
    expect(scanSource('Grid.svelte', `{ accessorFn: (r) => dateMs(r.createdAt) },\n${SWEPT}\n`)).toBeNull();
  });

  it('stays silent when every accessor renders as itself', () => {
    expect(scanSource('Grid.svelte', `{ accessorFn: (r) => r.name },\n${INCLUDES}\n`)).toBeNull();
  });

  // The case that made the gate file-scoped: #820's sweep left the SECOND grid
  // in two files on the old filter, and only a file-scoped check saw it. A
  // per-table check would have called each of those files half-fixed and
  // passed.
  it('flags a half-converted file, where one grid was swept and another was not', () => {
    const source = `{ accessorFn: (r) => dateMs(r.createdAt) },\n${SWEPT}\n\n// second grid\n${INCLUDES}\n`;
    expect(scanSource('TwoGrids.svelte', source)).not.toBeNull();
  });
});

/**
 * The gate against the real tree. This is the assertion that would fail if the
 * sweep regressed, and it runs in the ordinary suite rather than only in CI —
 * so a grid that regresses fails locally, before the push.
 */
describe('the repository as it stands', () => {
  it('has no grid searching something the reader cannot see', () => {
    const offenders = svelteFilesUnder('src')
      .map((file) => scanSource(file, readFileSync(file, 'utf8')))
      .filter((hit) => hit !== null)
      .map((hit) => `${hit!.file}:${hit!.filterLine}`);
    expect(offenders).toEqual([]);
  });
});
