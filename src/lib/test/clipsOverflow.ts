/**
 * portal#2413: does a class list clip its content? A clipping ancestor cuts a
 * descendant's focus ring at its edge. Tailwind spells a clip many ways, so the
 * focus-ring pins share one matcher: overflow-{hidden,clip,auto,scroll} (and
 * the -x/-y forms), `truncate` (overflow:hidden), arbitrary
 * [overflow:hidden]-style properties, and paint containment.
 */
const CLIP =
  /(^|\s)(?:[a-z-]+:)*(?:truncate|overflow(?:-[xy])?-(?:hidden|clip|auto|scroll)|contain-(?:paint|strict|content)|\[overflow(?:-[xy])?:(?:hidden|clip|auto|scroll)\]|\[contain:[^\]]*(?:paint|strict|content)[^\]]*\])(?=\s|$)/;

export function clipsOverflow(classList: string | null | undefined): boolean {
  return CLIP.test(classList ?? '');
}
