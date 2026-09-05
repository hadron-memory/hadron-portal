/**
 * #707 — one guard across EVERY surface that renders a scan signature.
 *
 * Written because I got this wrong three times in a row on one PR, each time on
 * a different component and each time as a fresh review finding:
 *
 *   AssetTable        `truncate` at 100px  → "Signature:…"
 *   AssetChip         `truncate max-w-[180px]`
 *   AttachAssetDialog `truncate max-w-[160px]`, then `shrink-0` (which pins
 *                     max-content width, so `break-all` never engages)
 *   NodeAssetCard     no wrapping at all — an unbroken value escapes the card
 *
 * Fixing them one at a time is what produced four rounds. `scanSignature` is an
 * unrestricted string from the scan engine, so the rule is the same everywhere:
 * it must WRAP, and it must never be clipped or width-pinned. This asserts that
 * as one property over the source of every render site, so the next surface
 * added is covered before a reviewer has to find it
 * (`hrn:node:hadronmemory.com:hadron-portal:review:content-sized-control-needs-min-w-0`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Every component that renders the signature, and the marker to find it by. */
const RENDER_SITES: Array<{ file: string; marker: RegExp }> = [
  { file: 'src/lib/components/assets/AssetChip.svelte', marker: /\{visibleSignature\}/ },
  { file: 'src/lib/components/assets/NodeAssetCard.svelte', marker: /\{signatureText\}/ },
  { file: 'src/lib/components/assets/AssetTable.svelte', marker: /\{signatureText\}/ },
  {
    file: 'src/lib/components/assets/AttachAssetDialog.svelte',
    marker: /\{scanSignatureText\(asset\.scanStatus, asset\.scanSignature\)\}/,
  },
];

/** The class list of the element whose content is the signature. */
function signatureClasses(source: string, marker: RegExp): string {
  const at = source.search(marker);
  expect(at).toBeGreaterThan(-1);
  // Walk back to the opening tag that encloses this content.
  const openTag = source.lastIndexOf('<', at);
  expect(openTag).toBeGreaterThan(-1);
  const tag = source.slice(openTag, source.indexOf('>', openTag) + 1);
  return tag.match(/class="([^"]*)"/)?.[1] ?? '';
}

describe.each(RENDER_SITES)('scan signature layout — $file', ({ file, marker }) => {
  const classes = signatureClasses(readFileSync(file, 'utf8'), marker);

  it('wraps rather than overflowing', () => {
    expect(classes).toMatch(/\bbreak-(all|words)\b/);
  });

  it('is never clipped', () => {
    // Clipping is the defect that started this: the value is in the DOM and
    // unreadable, and the full copy lives in a title a touch user cannot open.
    expect(classes).not.toMatch(/\btruncate\b/);
    expect(classes).not.toMatch(/\bmax-w-/);
  });

  it('is not width-pinned against its own wrapping', () => {
    // `shrink-0` preserves max-content width inside a flex row, so `break-all`
    // never gets a constrained width to break at and the row spills instead.
    expect(classes).not.toMatch(/\bshrink-0\b/);
  });
});
