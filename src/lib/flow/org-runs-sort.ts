// portal#1499: the org runs page's one server-ordered column. Duration is chosen in the URL (`?sort=duration&dir=asc|desc`) so
// the loader can fetch the 200-run window in that order; every other column still sorts client-side inside the window.

export type OrgRunsServerSort = 'duration' | null;
export interface OrgRunsSort { sort: OrgRunsServerSort; dir: 'asc' | 'desc' }

export function parseOrgRunsSort(params: URLSearchParams): OrgRunsSort {
  return { sort: params.get('sort') === 'duration' ? 'duration' : null, dir: params.get('dir') === 'asc' ? 'asc' : 'desc' };
}

/** The query string for the URL after the reader sorts: Duration sets the pair, any other sort (or none) clears it. */
export function orgRunsSortSearch(current: URLSearchParams, sorting: ReadonlyArray<{ id: string; desc: boolean }>): string {
  const next = new URLSearchParams(current);
  next.delete('sort');
  next.delete('dir');
  const first = sorting[0];
  if (first?.id === 'duration') {
    next.set('sort', 'duration');
    next.set('dir', first.desc ? 'desc' : 'asc');
  }
  const search = next.toString();
  return search ? `?${search}` : '';
}
