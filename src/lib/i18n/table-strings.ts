/**
 * Shared i18n strings for the TanStack table chrome (pagination footer).
 *
 * Pattern matches `saved-views-strings.ts`: generic table copy that is not
 * page-specific lives here so every list page (api-keys, sessions, …) shares
 * one translation key per string instead of duplicating it per page.
 *
 * Numeric placeholders substitute after the `t()` lookup so the key is
 * stable — a translator sees `"Page {page} of {total}"` once, not a
 * different default per value.
 */

import { t } from './t';

export const tableStrings = {
  /** Footer page indicator, e.g. "Page 2 of 7". */
  pageOf: (page: number, total: number): string =>
    t('table.pagination.page-of', 'Page {page} of {total}', { page, total }),

  /** aria-label on the rows-per-page <select>. */
  rowsPerPage: (): string =>
    t('table.pagination.rows-per-page', 'Rows per page'),

  /** Rows-per-page <option> label, e.g. "20 per page". */
  perPage: (size: number): string =>
    t('table.pagination.per-page', '{size} per page', { size }),

  /** aria-label on a column's drag/keyboard resize handle. */
  resizeColumn: (): string => t('table.resize-column', 'Resize column'),

  /** Previous-page button. */
  previous: (): string => t('table.pagination.previous', 'Previous'),

  /** Next-page button. */
  next: (): string => t('table.pagination.next', 'Next'),
};
