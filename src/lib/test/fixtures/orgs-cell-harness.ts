// portal#2491 (#1962 slice 5): the real Orgs-route tables with legal synthetic rows, for the Chromium
// containment harness (scripts/test-table-cell-overflow-layout.mjs, kind "orgs"). No API, no production data.
import { mount, unmount } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import OrgsPage from '../../../routes/app/orgs/+page.svelte';
import MemoriesPage from '../../../routes/app/orgs/[id]/memories/+page.svelte';
import { deleteOrgMemorySchema, orgMemorySubscribeSchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema } from '../../../routes/app/orgs/[id]/memories/schema';

/** The rows of #2491, by listKey. `measured` rows are reported, not failed, until a fix lands for them. */
export const ORGS_CELL_ROWS = [
  { listKey: 'orgs:mine', measured: false, scope: '' },
  { listKey: 'orgs:memories:personal', measured: false, scope: '' },
  { listKey: 'orgs:memories', measured: false, scope: '' },
  { listKey: 'orgs:memories:subscriptions', measured: false, scope: '' },
] as const;
export type OrgsCellRow = (typeof ORGS_CELL_ROWS)[number]['listKey'];

const LONG_NAME = 'ALongOrganizationNameWithNoSpacesInItAtAll0123456789';
const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));

const MEMORY_NAME = 'AMemoryNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJ';

async function mountMemories(target: HTMLElement, row: OrgsCellRow) {
  const memory = (i: number) => ({
    id: `m${i}`, name: i ? MEMORY_NAME : 'Notes', urn: `hrn:mem:example.test:memory-${i}`, visibility: 'ORGANIZATION', source: null, readBranch: 'main',
    lastSyncedAt: '2026-11-01T02:04:36Z', vectorIndexEnabled: true, embeddingSource: 'LOCAL', class: 'personal',
  });
  const [subscribeForm, deleteForm, syncAllForm, unsubscribeForm] = await Promise.all(
    [orgMemorySubscribeSchema, deleteOrgMemorySchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema].map((schema) => superValidate(zod4(schema as never), { errors: false })),
  );
  const items = [memory(1), memory(2)];
  const data = {
    org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme', memories: items, subscriptions: items.map((m) => ({ id: `s${m.id}`, role: 'CONTRIBUTOR', memory: m })) },
    systemMemories: [], availableMemories: [], personalMemories: items,
    systemMemoriesDegraded: false, personalMemoriesDegraded: false, availableMemoriesDegraded: false,
    initialTab: row === 'orgs:memories:personal' ? 'personal' : row === 'orgs:memories' ? 'org' : 'subscriptions',
    subscribeForm, deleteForm, syncAllForm, unsubscribeForm,
  };
  const instance = mount(MemoriesPage as never, { target, props: { data, form: null } as never });
  return () => unmount(instance);
}

export function mountOrgsCell(target: HTMLElement, row: OrgsCellRow): () => void {
  if (row !== 'orgs:mine') {
    // The memories page builds its superforms asynchronously; the harness awaits the returned promise's teardown.
    let stop: (() => void) | undefined; let stopped = false;
    void mountMemories(target, row).then((fn) => { if (stopped) fn(); else stop = fn; });
    return () => { stopped = true; stop?.(); };
  }
  const orgs = [LONG_NAME, 'Acme'].map((name, i) => ({
    id: `org${i}`, name, urn: `hrn:org:example.test:${name.toLowerCase()}`, createdAt: '2026-11-01T02:04:36Z',
    members: list(1234), memories: list(12), agents: list(3), apps: list(2),
  }));
  const instance = mount(OrgsPage, { target, props: { data: { orgs } } as never });
  return () => unmount(instance);
}
