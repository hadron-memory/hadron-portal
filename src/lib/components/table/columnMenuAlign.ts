/**
 * Which edge of the Columns summary the dropdown hangs from (#2149).
 *
 * The menu used to be pinned `right-0`, so it extends LEFT of the summary by
 * (menu width - summary width). That is right when the toggle sits at the
 * toolbar's right edge, but at 390px on Account Grants the summary is left in
 * the row and the menu's left checkboxes were clipped at x=-17.
 *
 * Prefer 'right' (the long-standing desktop layout) whenever the menu fits
 * inside the viewport that way; otherwise hang it from the left edge. Purely
 * presentational: it reads geometry only.
 */
export type ColumnMenuAlign = 'left' | 'right';

export function columnMenuAlign(
  summary: { left: number; right: number },
  menuWidth: number,
  viewportWidth: number,
): ColumnMenuAlign {
  if (summary.right - menuWidth >= 0) return 'right';
  if (summary.left + menuWidth <= viewportWidth) return 'left';
  // Fits neither way: stay in the viewport's left edge rather than clip the checkboxes.
  return 'left';
}
