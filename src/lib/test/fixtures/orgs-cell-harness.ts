// portal#2491 (#1962 slice 5): the real Orgs-route tables with legal synthetic rows, for the Chromium
// containment harness (scripts/test-table-cell-overflow-layout.mjs, kind "orgs"). No API, no production data.
import { mount, unmount } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import OrgsPage from '../../../routes/app/orgs/+page.svelte';
import AppsPage from '../../../routes/app/orgs/[id]/apps/+page.svelte';
import { deleteOrgAppSchema } from '../../../routes/app/orgs/[id]/apps/schema';
import AgentsPage from '../../../routes/app/orgs/[id]/agents/+page.svelte';
import { orgAgentSubscribeSchema, orgAgentUnsubscribeSchema } from '../../../routes/app/orgs/[id]/agents/schema';
import MemoriesPage from '../../../routes/app/orgs/[id]/memories/+page.svelte';
import { deleteOrgMemorySchema, orgMemorySubscribeSchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema } from '../../../routes/app/orgs/[id]/memories/schema';

export type OrgsCellKind = 'orgs-agents' | 'orgs-subscribed-agents' | 'orgs-apps' | 'orgs-mine' | 'orgs-memories-personal' | 'orgs-memories' | 'orgs-memories-subscriptions';

const LONG_NAME = 'ALongOrganizationNameWithNoSpacesInItAtAll0123456789';
const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));

const MEMORY_NAME = 'AMemoryNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJ';

async function mountMemories(target: HTMLElement, kind: OrgsCellKind) {
  const memory = (i: number) => ({
    id: `m${i}`, name: i ? MEMORY_NAME : 'Notes', urn: `hrn:mem:example.test:memory-${i}`, visibility: 'ORGANIZATION', source: { id: 'src' }, readBranch: 'main',
    lastSyncedAt: '2026-11-01T02:04:36Z', vectorIndexEnabled: true, embeddingSource: 'LOCAL', class: 'personal',
  });
  const [subscribeForm, deleteForm, syncAllForm, unsubscribeForm] = await Promise.all(
    [orgMemorySubscribeSchema, deleteOrgMemorySchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema].map((schema) => superValidate(zod4(schema as never), { errors: false })),
  );
  const items = [memory(1), memory(2), memory(3)];
  const data = {
    org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme', memories: items, subscriptions: items.map((m) => ({ id: `s${m.id}`, role: 'CONTRIBUTOR', memory: m })) },
    systemMemories: [], availableMemories: [], personalMemories: items,
    systemMemoriesDegraded: false, personalMemoriesDegraded: false, availableMemoriesDegraded: false,
    initialTab: kind === 'orgs-memories-personal' ? 'personal' : kind === 'orgs-memories' ? 'org' : 'subscriptions',
    subscribeForm, deleteForm, syncAllForm, unsubscribeForm,
  };
  const instance = mount(MemoriesPage as never, { target, props: { data, form: null } as never });
  return () => unmount(instance);
}

async function mountApps(target: HTMLElement) {
  const deleteForm = await superValidate(zod4(deleteOrgAppSchema as never), { errors: false });
  const apps = [1, 2, 3].map((i) => ({
    id: `a${i}`, name: i === 1 ? 'AnAppNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJKLMN' : `App ${i}`, urn: `hrn:app:example.test:app-${i}`,
    organizationId: 'org1', appType: 'WORKSTATION', role: 'OWNER', description: null, agentTools: [], expiresAt: null,
    createUserPermission: 'EXPLICIT', identifyUserMethod: 'SECRET', sessionTimeoutSeconds: 86400, anonymousTtlDays: 30,
    agentId: 'ag1', agent: { id: 'ag1', name: 'AnAgentNameWithNoBreakPoints0123456789ABCDEF', urn: 'hrn:agent:example.test:agent' },
  }));
  const data = {
    org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme' }, apps, keyCounts: Object.fromEntries(apps.map((a, i) => [a.id, { kind: 'ok', count: 12 + i }])),
    deleteForm,
  };
  const instance = mount(AppsPage as never, { target, props: { data, form: null } as never });
  return () => unmount(instance);
}

const AGENT_NAME = 'AnAgentNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJ';

async function mountAgents(target: HTMLElement, kind: OrgsCellKind) {
  const [subscribeForm, unsubscribeForm] = await Promise.all([orgAgentSubscribeSchema, orgAgentUnsubscribeSchema].map((schema) => superValidate(zod4(schema as never), { errors: false })));
  const agents = [1, 2, 3].map((i) => ({
    id: `ag${i}`, name: i === 1 ? AGENT_NAME : `Agent ${i}`, urn: `hrn:agent:example.test:agent-${i}`, personaRole: i === 1 ? 'a-very-long-role-token-with-no-spaces-0123456789' : 'portal-engineer',
    description: 'A description that is long enough to need the room it is given in its column.', memoryItems: [{ id: 'm1' }], systemMemoryId: 'sm1',
  }));
  const grants = [1, 2, 3].map((i) => ({
    id: `g${i}`, agentId: `pa${i}`, agent: { id: `pa${i}`, name: i === 1 ? AGENT_NAME : `Public ${i}`, urn: `hrn:agent:other-org.example.test:agent-${i}` },
    isActive: true, revokedAt: null, expiresAt: null, activatedAt: '2026-11-01T02:04:36Z', createdAt: '2026-10-01T02:04:36Z',
  }));
  const data = {
    org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme', agents }, installedByAgent: { ag1: { appId: 'app1', appName: 'Team' } },
    subscribedGrants: grants, subscribablePublicAgents: [], subscribeForm, unsubscribeForm,
  };
  const instance = mount(AgentsPage as never, { target, props: { data, form: null } as never });
  if (kind === 'orgs-subscribed-agents') {
    const tab = [...target.querySelectorAll('button,[role="tab"]')].find((el) => /subscri/i.test(el.textContent ?? '')) as HTMLElement | undefined;
    if (!tab) throw new Error('orgs-cell-harness: the Subscribed tab was not found');
    tab.click();
  }
  return () => unmount(instance);
}

export function mountOrgsCellFixture(target: HTMLElement, kind: string): (() => void) | Promise<() => void> {
  if (kind === 'orgs-mine') {
    const orgs = [LONG_NAME, 'Acme', 'Globex'].map((name, i) => ({
      id: `org${i}`, name, urn: `hrn:org:example.test:${name.toLowerCase()}`, createdAt: '2026-11-01T02:04:36Z',
      members: list(1234), memories: list(12), agents: list(3), apps: list(2),
    }));
    const instance = mount(OrgsPage, { target, props: { data: { orgs } } as never });
    return () => unmount(instance);
  }
  if (kind === 'orgs-apps') return mountApps(target);
  if (kind === 'orgs-agents' || kind === 'orgs-subscribed-agents') return mountAgents(target, kind as OrgsCellKind);
  if (kind.startsWith('orgs-memories')) return mountMemories(target, kind as OrgsCellKind);
  throw new Error(`orgs-cell-harness: no fixture for ${kind}`);
}
