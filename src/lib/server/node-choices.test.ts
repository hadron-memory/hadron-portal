/**
 * portal#1585 — the ENDPOINT owns the offset ceiling (PM decision, Patrick
 * 2026-11-01: one source of truth, no client constant to keep in step).
 *
 * The choices endpoint 400s any offset above MAX_OFFSET (100 000), but
 * `nodeChoices` used to report `hasMore: raw.length === PAGE` and
 * `nextOffset: offset + raw.length` regardless: one raw-full page short of
 * the ceiling produced a `nextOffset` the endpoint must refuse, the picker
 * rendered Load more for it, and Try again resent the same refused offset
 * forever (#1582 carried P3 1). When the NEXT page would start past the
 * ceiling, the read must say the list is capped instead: `hasMore: false`
 * and `capped: true` — the picker shows a note where Load more was and never
 * sends the request that would 400.
 */
import { describe, expect, it } from 'vitest';
import { MAX_NODE_CHOICES_OFFSET, NODE_CHOICES_PAGE, nodeChoices } from '$lib/server/node-choices';
import type { NodeChoice } from '$lib/node-choices';

// A minimal GraphQLClient stand-in: nodeChoices only calls request().
const page = (raw: number, offset = 0) => ({
  request: async () => ({
    findNodes: { hits: Array.from({ length: raw }, (_, i) => ({ node: { id: `n${offset + i}`, name: `N${offset + i}`, loc: `loc:${offset + i}`, urn: `hrn:node:example.com:m:loc:${offset + i}` } satisfies NodeChoice })) },
  }),
});

// A raw-full page STARTING inside the last window before the ceiling: its
// next offset lands past MAX_OFFSET (99 990 + 20 = 100 010), which the
// endpoint must refuse — so this is the capped case. (A full page starting
// exactly PAGE below the ceiling ends ON it: boundary, not capped.)
// Re-aimed in the fix commit from `MAX - PAGE`: that first aim is the
// boundary case below, not the capped case (LOCAL P3, marked per
// acceptance 4; values verified by the seats).
const CAPPED_OFFSET = MAX_NODE_CHOICES_OFFSET - NODE_CHOICES_PAGE / 2;

describe('nodeChoices: the endpoint owns the offset ceiling (#1585)', () => {
  it('a raw-full page whose next offset passes the ceiling reports hasMore:false and capped:true', async () => {
    const result = await nodeChoices(page(NODE_CHOICES_PAGE, CAPPED_OFFSET) as never, 'm1', CAPPED_OFFSET);
    expect(result).toEqual({
      kind: 'ok',
      value: {
        items: expect.any(Array),
        hasMore: false, // Load more must not render for a page the endpoint would 400
        capped: true,   // ...and the picker shows the capped note instead
        nextOffset: MAX_NODE_CHOICES_OFFSET + NODE_CHOICES_PAGE / 2,
      },
    });
  });

  it('a raw-full page ENDING on the ceiling is not capped — the boundary read is legal', async () => {
    // offset + PAGE === MAX_OFFSET exactly: the next request's offset equals
    // the ceiling, which the endpoint accepts (inclusive bound), so paging
    // continues normally. (Re-aimed in the fix commit from
    // `MAX - PAGE * 2` to sit exactly ON the boundary; marked per
    // acceptance 4.)
    const offset = MAX_NODE_CHOICES_OFFSET - NODE_CHOICES_PAGE;
    const result = await nodeChoices(page(NODE_CHOICES_PAGE, offset) as never, 'm1', offset);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.hasMore).toBe(true);
    expect(result.value.capped).toBeFalsy();
  });

  it('a page well below the ceiling is unchanged', async () => {
    const result = await nodeChoices(page(NODE_CHOICES_PAGE) as never, 'm1', 0);
    expect(result).toEqual({
      kind: 'ok',
      value: { items: expect.any(Array), hasMore: true, nextOffset: NODE_CHOICES_PAGE },
    });
  });

  it('a SHORT page near the ceiling is end-of-data, not capped', async () => {
    // The raw window came back short: the data ended before the ceiling did.
    // hasMore:false, but the list was not truncated by the ceiling, so no
    // capped note.
    const result = await nodeChoices(page(NODE_CHOICES_PAGE - 1, CAPPED_OFFSET) as never, 'm1', CAPPED_OFFSET);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.hasMore).toBe(false);
    expect(result.value.capped).toBeFalsy();
  });

  it('a raw-full page STARTING at the ceiling is capped — the terminal read of paging from zero (#1588 BLIND P3)', async () => {
    // Normal paging from offset 0 advances by PAGE and can land exactly ON
    // 100 000 (a legal read: the ceiling is an inclusive bound). If that
    // terminal page comes back FULL, its own next offset starts past the
    // ceiling, so the read must cap — or Load more would build the very
    // request the endpoint 400s.
    const result = await nodeChoices(page(NODE_CHOICES_PAGE, MAX_NODE_CHOICES_OFFSET) as never, 'm1', MAX_NODE_CHOICES_OFFSET);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.value.hasMore).toBe(false);
    expect(result.value.capped).toBe(true);
  });
});
