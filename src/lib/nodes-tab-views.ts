// portal#2705: what a saved view on the Nodes tab holds. A view is stored per browser profile
// (localStorageViewStore), so it only ever carries the allow-listed step 1 parameters, each
// re-validated on the way back in: a hand-edited or stale record can never widen what the
// bounded nodes/page door is asked. Access is the server's, re-run with the viewer's token.
import type { SavedView } from '$lib/table/savedView';
import { NO_CRITERIA, type TableCriteria } from '$lib/nodes-tab-client';

export const SEARCH_MAX = 200;
export const TAG_MAX = 100;
export const FILTER_MAX = 20;

const CHANGED: readonly TableCriteria['changed'][] = ['', '24h', '7d', '30d'];
const SORTS: readonly TableCriteria['sort'][] = ['', 'loc', 'updated', 'relevance'];
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The list key scopes the stored views: the viewer AND the memory, so two people on one browser never share. */
export const nodesListKey = (viewerId: string, memoryId: string): string =>
  `nodes-tab:${encodeURIComponent(viewerId)}:${encodeURIComponent(memoryId)}`;

type Server = Pick<SavedView, 'sorting' | 'columnFilters'>;

/** Criteria as the two server-owned slices a SavedView already has. */
export function criteriaToServerView(c: TableCriteria): Server {
  const columnFilters: Server['columnFilters'] = [];
  if (c.q !== '') columnFilters.push({ id: 'q', value: c.q });
  if (c.types.length) columnFilters.push({ id: 'types', value: [...c.types] });
  if (c.tags.length) columnFilters.push({ id: 'tags', value: [...c.tags] });
  if (c.changed !== '') columnFilters.push({ id: 'changed', value: c.changed });
  if (c.mine) columnFilters.push({ id: 'mine', value: true });
  return { sorting: c.sort ? [{ id: c.sort, desc: false }] : [], columnFilters };
}

const strings = (v: unknown, max: number, count: number, refuse: (s: string) => boolean): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== '' && x.length <= max && !refuse(x)))].slice(0, count)
    : [];

/** Criteria back from a stored view; anything outside the allow-list is dropped, never passed on. */
export function viewToCriteria(view: SavedView, allowedTypes: readonly string[]): TableCriteria {
  const get = (id: string) => view.columnFilters?.find((f) => f.id === id)?.value;
  const q = get('q');
  const changed = get('changed');
  const sortId = view.sorting?.[0]?.id;
  const out: TableCriteria = {
    ...NO_CRITERIA,
    q: typeof q === 'string' ? q.slice(0, SEARCH_MAX).trim() : '',
    types: strings(get('types'), 40, FILTER_MAX, (s) => !allowedTypes.includes(s)),
    tags: strings(get('tags'), TAG_MAX, FILTER_MAX, (s) => CONTROL.test(s)),
    changed: CHANGED.includes(changed as TableCriteria['changed']) ? (changed as TableCriteria['changed']) : '',
    mine: get('mine') === true,
    sort: SORTS.includes(sortId as TableCriteria['sort']) ? (sortId as TableCriteria['sort']) : '',
  };
  if (out.sort === 'relevance' && out.q === '') out.sort = '';
  return out;
}
