/**
 * #707 — regression guard on the shared asset projection.
 *
 * This exists because the component tests CANNOT catch a field being dropped
 * from the selection set. They build an `AssetSummary` literal and hand it
 * straight to the component, so `scanSignature` is present in the test whether
 * or not the query ever asked the server for it. Deleting the field from
 * `ASSET_FIELDS` leaves every one of them green and ships a BLOCKED tombstone
 * that silently shows no signature — the render reads `undefined` and the
 * `{#if}` simply never fires.
 *
 * Verified to fail: removing `scanSignature` from the fragment turns this red
 * and nothing else in the suite.
 * (`hrn:node:hadronmemory.com:hadron-portal:review:graphql-fetch-rendered-subfields`,
 * `hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail`.)
 */
import { describe, it, expect } from 'vitest';
import { ASSET_FIELDS } from './assetQueries';

/**
 * The fragment's selection set with `#` comments stripped.
 *
 * Stripping matters: the prose beside these fields names them, so a raw
 * substring check could pass on a comment alone — a guard that reports the
 * documentation rather than the query
 * (`hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`).
 */
function selectedFields(): string[] {
  const open = ASSET_FIELDS.indexOf('{');
  expect(open).toBeGreaterThan(-1);
  let depth = 0;
  let block = '';
  for (let i = open; i < ASSET_FIELDS.length; i++) {
    const ch = ASSET_FIELDS[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      block = ASSET_FIELDS.slice(open + 1, i);
      break;
    }
  }
  expect(block).not.toBe('');
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

describe('ASSET_FIELDS', () => {
  it('selects scanSignature, which the BLOCKED tombstone UI renders', () => {
    expect(selectedFields()).toContain('scanSignature');
  });

  it('selects scanStatus, the field every scan gate branches on', () => {
    // Its absence would be louder (download gating, chips and thumbnails all
    // read it), but it is the sibling this projection must keep together:
    // a signature with no status cannot be rendered correctly, since the
    // signature alone never establishes that the asset is blocked.
    expect(selectedFields()).toContain('scanStatus');
  });

  it('selects publicUrl, which gates whether a copy-link control exists at all', () => {
    expect(selectedFields()).toContain('publicUrl');
  });
});
