/**
 * Which edge of the Columns summary the dropdown hangs from (#2149).
 *
 * The menu used to be pinned `right-0`, so it extends LEFT of the summary by
 * (menu width - summary width). That is right when the toggle sits at the
 * toolbar's right edge, but at 390px on Account Grants the summary is left in
 * the row and the menu's left checkboxes were clipped at x=-17.
 *
 * Prefer 'right' (the long-standing desktop layout) whenever the menu then
 * stays at x >= 0; otherwise hang it from the summary's left edge, which
 * extends rightward. Purely presentational: it reads geometry only.
 */
export type ColumnMenuAlign = 'left' | 'right';

/** The menu's width in px: the single source for both the inline width style and the alignment maths. */
export const COLUMN_MENU_WIDTH_PX = 176;

export function columnMenuAlign(summary: { right: number }, menuWidth: number): ColumnMenuAlign {
  return summary.right - menuWidth >= 0 ? 'right' : 'left';
}
