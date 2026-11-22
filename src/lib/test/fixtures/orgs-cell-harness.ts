// portal#2491 (#1962 slice 5): the real Orgs-route tables with legal synthetic rows, for the Chromium
// containment harness (scripts/test-table-cell-overflow-layout.mjs, kind "orgs"). No API, no production data.
import { mount, unmount } from 'svelte';
import OrgsPage from '../../../routes/app/orgs/+page.svelte';

/** The rows of #2491, by listKey. `measured` rows are reported, not failed, until a fix lands for them. */
export const ORGS_CELL_ROWS = [{ listKey: 'orgs:mine', measured: false, scope: '' }] as const;
export type OrgsCellRow = (typeof ORGS_CELL_ROWS)[number]['listKey'];

const LONG_NAME = 'ALongOrganizationNameWithNoSpacesInItAtAll0123456789';
const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));

export function mountOrgsCell(target: HTMLElement, row: OrgsCellRow) {
  if (row !== 'orgs:mine') throw new Error(`orgs-cell-harness: no fixture for row ${String(row)}`);
  const orgs = [LONG_NAME, 'Acme'].map((name, i) => ({
    id: `org${i}`, name, urn: `hrn:org:example.test:${name.toLowerCase()}`, createdAt: '2026-11-01T02:04:36Z',
    members: list(1234), memories: list(12), agents: list(3), apps: list(2),
  }));
  const instance = mount(OrgsPage, { target, props: { data: { orgs } } as never });
  return () => unmount(instance);
}
