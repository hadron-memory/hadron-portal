// portal#2491 (#1962 slice 5): the real Orgs-route tables with legal synthetic rows, for the Chromium
// containment harness (scripts/test-table-cell-overflow-layout.mjs, kind "orgs"). No API, no production data.
import { mount, tick, unmount } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import OrgsPage from '../../../routes/app/orgs/+page.svelte';
import AppsPage from '../../../routes/app/orgs/[id]/apps/+page.svelte';
import { deleteOrgAppSchema } from '../../../routes/app/orgs/[id]/apps/schema';
import AgentsPage from '../../../routes/app/orgs/[id]/agents/+page.svelte';
import { orgAgentSubscribeSchema, orgAgentUnsubscribeSchema } from '../../../routes/app/orgs/[id]/agents/schema';
import RunsPage from '../../../routes/app/orgs/[id]/runs/+page.svelte';
import MembersPage from '../../../routes/app/orgs/[id]/members/+page.svelte';
import { addOrgMemberSchema, impersonateMemberSchema, inviteMemberSchema, leaveOrgSchema, removeOrgMemberSchema, updateOrgMemberSchema } from '../../../routes/app/orgs/[id]/members/schema';
import MemoriesPage from '../../../routes/app/orgs/[id]/memories/+page.svelte';
import { deleteOrgMemorySchema, orgMemorySubscribeSchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema } from '../../../routes/app/orgs/[id]/memories/schema';

export type OrgsCellKind = 'orgs-members' | 'orgs-runs' | 'orgs-agents' | 'orgs-subscribed-agents' | 'orgs-apps' | 'orgs-mine' | 'orgs-memories-personal' | 'orgs-memories' | 'orgs-memories-subscriptions';

const LONG_NAME = 'ALongOrganizationNameWithNoSpacesInItAtAll0123456789';
/** The table the leg probes must be the one the kind names: fail loudly on a wrong tab instead of probing the default twice. */
async function expectHeaders(target: HTMLElement, kind: string, has: string[], hasNot: string[] = []) {
  await tick();
  const heads = [...target.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').replace(/[^\p{L}\s]/gu, '').trim());
  const missing = has.filter((h) => !heads.some((x) => x.startsWith(h))), extra = hasNot.filter((h) => heads.some((x) => x.startsWith(h)));
  if (missing.length || extra.length) throw new Error(`orgs-cell-harness: ${kind} did not render its own table (missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(extra)}, headers ${JSON.stringify(heads)})`);
}

/** TabRow marks the shown tab `aria-selected` on `id="tab-<item id>"`: the page must be on the tab the kind names. */
async function expectTab(target: HTMLElement, kind: string, id: string) {
  await tick();
  const selected = target.querySelector('button[role="tab"][aria-selected="true"]')?.id;
  if (selected !== `tab-${id}`) throw new Error(`orgs-cell-harness: ${kind} is on ${JSON.stringify(selected)}, not tab-${id}`);
}

const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));

const MEMORY_NAME = 'AMemoryNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJ';

async function mountMemories(target: HTMLElement, kind: OrgsCellKind) {
  const memory = (i: number) => ({
    id: `m${i}`, name: i === 0 ? 'Notes' : MEMORY_NAME, urn: `hrn:mem:example.test:memory-${i}`, visibility: 'ORGANIZATION', source: { id: 'src' }, readBranch: 'main',
    lastSyncedAt: '2026-11-01T02:04:36Z', vectorIndexEnabled: true, embeddingSource: 'LOCAL', class: 'personal',
  });
  const [subscribeForm, deleteForm, syncAllForm, unsubscribeForm] = await Promise.all(
    [orgMemorySubscribeSchema, deleteOrgMemorySchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema].map((schema) => superValidate(zod4(schema as never), { errors: false })),
  );
  const items = [memory(0), memory(1), memory(2)];
  const data = {
    org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme', memories: items, subscriptions: items.map((m) => ({ id: `s${m.id}`, role: 'CONTRIBUTOR', memory: m })) },
    systemMemories: [], availableMemories: [], personalMemories: items,
    systemMemoriesDegraded: false, personalMemoriesDegraded: false, availableMemoriesDegraded: false,
    initialTab: kind === 'orgs-memories-personal' ? 'personal' : kind === 'orgs-memories' ? 'org' : 'subscriptions',
    subscribeForm, deleteForm, syncAllForm, unsubscribeForm,
  };
  const instance = mount(MemoriesPage as never, { target, props: { data, form: null } as never });
  await expectTab(target, kind, kind === 'orgs-memories-personal' ? 'personal' : kind === 'orgs-memories' ? 'org' : 'subscriptions');
  if (kind === 'orgs-memories-subscriptions') await expectHeaders(target, kind, ['Role', 'From']);
  else await expectHeaders(target, kind, ['Type', 'Vector index'], ['Role', 'From']);
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
    // TabRow gives each tab `id="tab-<item id>"`: the exact tab, never a text match on a button.
    const tab = target.querySelector<HTMLElement>('button[role="tab"]#tab-subscribed');
    if (!tab) throw new Error('orgs-cell-harness: the Subscribed tab was not found');
    tab.click();
    await expectTab(target, kind, 'subscribed');
    await expectHeaders(target, kind, ['Owner', 'Status', 'Since'], ['Role', 'Memories']);
  } else {
    await expectTab(target, kind, 'own');
    await expectHeaders(target, kind, ['Role', 'Memories'], ['Owner', 'Since']);
  }
  return () => unmount(instance);
}

function mountRuns(target: HTMLElement) {
  const run = (i: number) => ({
    id: `r${i}`, appId: `app${i}`, status: i === 1 ? 'FAILED' : 'SUCCEEDED', triggerKind: 'SCHEDULE', eventData: { scheduleName: 'a-schedule-name-with-no-break-points-0123456789' },
    entryNodeUrn: 'hrn:node:example.test:memory:flows:a-very-long-flow-entry-node-name-with-no-break-points-0123456789', createdAt: '2026-11-01T02:04:36Z',
    startedAt: '2026-11-01T02:04:36Z', finishedAt: '2026-11-01T02:09:41Z', failure: { code: 'A_FAILURE_CODE_WITH_NO_BREAK_POINTS_AT_ALL_0123456789', message: 'boom' },
  });
  const runs = [1, 2, 3].map(run);
  const data = { org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme' }, runs, appNames: Object.fromEntries(runs.map((r, i) => [r.appId, i === 0 ? 'AnAppNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJ' : `App ${i}`])), failed: false, truncated: false, total: 3 };
  const instance = mount(RunsPage as never, { target, props: { data } as never });
  return () => unmount(instance);
}

async function mountMembers(target: HTMLElement) {
  const [addForm, impersonateForm, inviteForm, leaveForm, removeForm, updateForm] = await Promise.all(
    [addOrgMemberSchema, impersonateMemberSchema, inviteMemberSchema, leaveOrgSchema, removeOrgMemberSchema, updateOrgMemberSchema].map((schema) => superValidate(zod4(schema as never), { errors: false })),
  );
  // The caller is an OWNER, so every other row shows the role <select> and the row menu: the widest legal row.
  const member = (i: number, role: string) => ({
    id: `mem${i}`, role, canInvite: true, createdAt: '2026-11-01T02:04:36Z',
    user: { id: `u${i}`, handle: i === 0 ? 'owner' : `a-handle-with-no-break-points-${i}-0123456789`, name: i === 0 ? 'Owner' : 'AMemberNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJ', githubUsername: null, email: `a-very-long-local-part-with-no-break-points-${i}@example.test`, avatarUrl: null },
  });
  const members = [member(0, 'OWNER'), member(1, 'ADMIN'), member(2, 'MEMBER'), member(3, 'MEMBER')];
  const data = { org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme', members }, currentUserId: 'u0', isImpersonating: false, addForm, impersonateForm, inviteForm, leaveForm, removeForm, updateForm };
  const instance = mount(MembersPage as never, { target, props: { data, form: null } as never });
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
  if (kind === 'orgs-members') return mountMembers(target);
  if (kind === 'orgs-runs') return mountRuns(target);
  if (kind === 'orgs-agents' || kind === 'orgs-subscribed-agents') return mountAgents(target, kind);
  if (kind === 'orgs-memories-personal' || kind === 'orgs-memories' || kind === 'orgs-memories-subscriptions') return mountMemories(target, kind);
  throw new Error(`orgs-cell-harness: no fixture for ${kind}`);
}
