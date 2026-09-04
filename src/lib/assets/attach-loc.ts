/**
 * Where an attached file's reference node lands under its parent.
 *
 * Extracted from AttachAssetDialog so it is testable — `.svelte` components
 * aren't, in this repo (hrn:node:hadronmemory.com:hadron-portal:conventions:svelte-component-test-gap), and getting this
 * wrong is silent until a user hits a collision.
 */

/** Longest atom we'll derive from a filename, before any disambiguating suffix. */
const MAX_ATOM = 60;

/**
 * A loc atom derived from a filename.
 *
 * A loc is colon-delimited, so any ':' in a filename would silently add a tree
 * level rather than name a node; everything outside `[a-z0-9]` collapses to '-'.
 *
 * The EXTENSION is folded in rather than stripped. Stripping it made `report.pdf`
 * and `report.docx` — different files — compete for `<parent>:report`, so
 * attaching the second failed with a conflict the user could do nothing about
 * (PR #697 review, codex).
 */
export function attachLocAtom(filename: string): string {
  const slug = filename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ATOM)
    // The slice can land mid-separator, leaving a trailing '-'.
    .replace(/-+$/, '');
  return slug || 'file';
}

/**
 * The disambiguation ladder for a taken loc: `name`, `name-2`, `name-3`, …
 *
 * Numbering starts at 2 because the bare atom IS the first one — a `-1` suffix
 * would imply a sibling `-0`. Two attachments of genuinely the same filename are
 * a legitimate thing to want (a revised upload beside the original), and the
 * dialog offers no loc field, so refusing outright would leave no way through.
 */
export function attachCandidateLoc(base: string, attempt: number): string {
  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}
