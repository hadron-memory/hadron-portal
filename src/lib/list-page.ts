/** Navigation for one server-served list page; the table still owns its grid state. */
export interface ListPageNavigation {
  offset: number;
  count: number;
  total: number;
  firstHref?: string | null;
  previousHref: string | null;
  nextHref: string | null;
}
