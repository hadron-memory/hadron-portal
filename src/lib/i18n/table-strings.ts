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

  /** Folded-header toggle (search, saved views and columns live behind it). */
  showHeader: (): string => t('table.header.show', 'Search, views & columns'),

  /** Same toggle on a table with search off: it must not offer what it does not hold. */
  showHeaderNoSearch: (): string => t('table.header.show-no-search', 'Views & columns'),

  /** Same toggle on a table with neither search nor saved views: only Columns is behind it. */
  showHeaderColumnsOnly: (): string => t('table.header.show-columns-only', 'Columns'),

  /** Same toggle on a table with search but no saved-views strip. */
  showHeaderNoViews: (): string => t('table.header.show-no-views', 'Search & columns'),

  /** Button that folds the header again. */
  hideHeader: (): string => t('table.header.hide', 'Hide'),

  /** Tooltip on the dot shown while a search is narrowing the rows. */
  headerActive: (): string => t('table.header.active', 'A search is narrowing these rows'),

  /** Next-page button. */
  next: (): string => t('table.pagination.next', 'Next'),
};
