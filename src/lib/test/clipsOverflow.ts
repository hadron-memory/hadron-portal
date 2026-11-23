/**
 * portal#2413: does a class list clip its content? A clipping ancestor cuts a
 * descendant's focus ring at its edge. Tailwind spells a clip many ways, so the
 * focus-ring pins share one matcher: overflow-{hidden,clip,auto,scroll} (and
 * the -x/-y forms), `truncate` (overflow:hidden), arbitrary
 * [overflow:hidden]-style properties, and paint containment. portal#2506 adds
 * `line-clamp-<n>` (Tailwind compiles it to overflow:hidden plus the box
 * display — a real clip); `line-clamp-none` resets to visible and stays out.
 *
 * Variants are stripped per token (portal#2506 review): a utility keeps its
 * clip wherever Tailwind puts it — `sm:` matched even when the prefix was a
 * hand-written `[a-z-]+:`, but `2xl:` (a digit tier) and `[&:hover]:` (a
 * bracketed selector, itself containing a colon) fell through, and the clamp
 * arm added in #2506 inherited the same blind spot.
 */
const CLIP =
  /^(?:truncate|line-clamp-\d+|overflow(?:-[xy])?-(?:hidden|clip|auto|scroll)|contain-(?:paint|strict|content)|\[overflow(?:-[xy])?:(?:hidden|clip|auto|scroll)\]|\[contain:[^\]]*(?:paint|strict|content)[^\]]*\])$/;

/**
 * The utility root of one class token: everything after the last top-level
 * `:` (a colon not inside `[...]`), so chained variants — including bracketed
 * selectors whose own colons sit at bracket depth — strip whole.
 */
function rootUtility(token: string): string {
  let depth = 0;
  let root = token;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === ':' && depth === 0) root = token.slice(i + 1);
  }
  return root;
}

export function clipsOverflow(classList: string | null | undefined): boolean {
  return (classList ?? '')
    .split(/\s+/)
    .some(token => token !== '' && CLIP.test(rootUtility(token)));
}
