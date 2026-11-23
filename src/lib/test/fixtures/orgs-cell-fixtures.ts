// portal#2491 (#1962 slice 5): the real Orgs-route tables with legal synthetic rows, for the Chromium
// containment harness (scripts/test-table-cell-overflow-layout.mjs, the `orgs-*` kinds). No API, no production data.
// Every mount names the table it expects (headers) and, on a tabbed page, the tab: a page that gains a tab or
// drifts from its data would otherwise be probed on the wrong table and pass for the wrong reason (portal#2514).
import { mount, unmount, type Component, type ComponentProps } from 'svelte';
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

// The kinds this module mounts. scripts/lib/cell-harness-env.mjs lists the same kinds as ORGS_KINDS; a test in
// cell-harness-env.test.ts pins the two lists to each other, so a kind cannot be added to one alone.
export const ORGS_CELL_KINDS = ['orgs-members', 'orgs-runs', 'orgs-agents', 'orgs-subscribed-agents', 'orgs-apps', 'orgs-mine', 'orgs-memories-personal', 'orgs-memories-org', 'orgs-memories-subscriptions'] as const;
export type OrgsCellKind = (typeof ORGS_CELL_KINDS)[number];

// One long, unbreakable value per entity, shared by every table that shows it.
const LONG_ORG_NAME = 'ALongOrganizationNameWithNoSpacesInItAtAll0123456789';
const LONG_MEMORY_NAME = 'AMemoryNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJ';
const LONG_APP_NAME = 'AnAppNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJKLMN';
const LONG_AGENT_NAME = 'AnAgentNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJ';
const LONG_MEMBER_NAME = 'AMemberNameWithNoBreakPointsAtAll0123456789ABCDEFGHIJ';

/** The props of a route page: the target is typed from the page itself, so mount() checks the shape, while `data` stays a loose literal (the cells read a fraction of PageData). */
const pageProps = <C extends Component<any>>(_page: C, data: object, form: unknown = null) => ({ data, form }) as unknown as ComponentProps<C>;

/** Poll for what a page renders behind an async effect, instead of guessing that one tick is enough. */
async function settled<T>(read: () => T | null, what: string): Promise<T> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const found = read();
    if (found !== null) return found;
    if (Date.now() > deadline) throw new Error(`orgs-cell-fixtures: ${what}`);
    await new Promise((r) => setTimeout(r, 16));
  }
}

const headersOf = (target: HTMLElement) => [...target.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').replace(/[^\p{L}\s]/gu, '').trim());

/** The table the leg probes must be the one the kind names: fail loudly on a wrong tab instead of probing the default twice. */
async function expectHeaders(target: HTMLElement, kind: string, has: string[], hasNot: string[] = []) {
  // One condition, polled together: the wanted headers present and the unwanted ones absent.
  const verdict = (heads: string[]) => ({ missing: has.filter((h) => !heads.some((x) => x.startsWith(h))), extra: hasNot.filter((h) => heads.some((x) => x.startsWith(h))) });
  await settled(() => { const v = verdict(headersOf(target)); return v.missing.length === 0 && v.extra.length === 0 ? true : null; },
    `${kind} did not render its own table (headers ${JSON.stringify(headersOf(target))}, expected ${JSON.stringify(has)}, unexpected ${JSON.stringify(hasNot)})`);
}

/** TabRow marks the shown tab `aria-selected` on `id="tab-<item id>"`: the page must be on the tab the kind names. */
async function expectTab(target: HTMLElement, kind: string, id: string) {
  await settled(() => (target.querySelector('button[role="tab"][aria-selected="true"]')?.id === `tab-${id}` ? true : null), `${kind} is on ${JSON.stringify(target.querySelector('button[role="tab"][aria-selected="true"]')?.id)}, not tab-${id}`);
}

/** A failed expectation must not leave the page mounted for the next leg: unmount, then rethrow. */
async function checked(instance: Record<string, unknown>, check: () => Promise<void>): Promise<() => void> {
  try { await check(); } catch (e) { unmount(instance); throw e; }
  return () => unmount(instance);
}

const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));

const MEMORY_TABS = { 'orgs-memories-personal': 'personal', 'orgs-memories-org': 'org', 'orgs-memories-subscriptions': 'subscriptions' } as const;

async function mountMemories(target: HTMLElement, kind: keyof typeof MEMORY_TABS) {
  const memory = (i: number) => ({
    id: `m${i}`, name: i === 0 ? 'Notes' : LONG_MEMORY_NAME, urn: `hrn:mem:example.test:memory-${i}`, visibility: 'ORGANIZATION', source: { id: 'src' }, readBranch: 'main',
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
    initialTab: MEMORY_TABS[kind],
    subscribeForm, deleteForm, syncAllForm, unsubscribeForm,
  };
  const instance = mount(MemoriesPage, { target, props: pageProps(MemoriesPage, data) });
  return checked(instance, async () => {
    await expectTab(target, kind, MEMORY_TABS[kind]);
    if (kind === 'orgs-memories-subscriptions') await expectHeaders(target, kind, ['Role', 'From']);
    else await expectHeaders(target, kind, ['Type', 'Vector index'], ['Role', 'From']);
  });
}

async function mountApps(target: HTMLElement) {
  const deleteForm = await superValidate(zod4(deleteOrgAppSchema as never), { errors: false });
  const apps = [1, 2, 3].map((i) => ({
    id: `a${i}`, name: i === 1 ? LONG_APP_NAME : `App ${i}`, urn: `hrn:app:example.test:app-${i}`,
    organizationId: 'org1', appType: 'WORKSTATION', role: 'OWNER', description: null, agentTools: [], expiresAt: null,
    createUserPermission: 'EXPLICIT', identifyUserMethod: 'SECRET', sessionTimeoutSeconds: 86400, anonymousTtlDays: 30,
    agentId: 'ag1', agent: { id: 'ag1', name: LONG_AGENT_NAME, urn: 'hrn:agent:example.test:agent' },
  }));
  const data = {
    org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme' }, apps, keyCounts: Object.fromEntries(apps.map((a, i) => [a.id, { kind: 'ok', count: 12 + i }])),
    deleteForm,
  };
  const instance = mount(AppsPage, { target, props: pageProps(AppsPage, data) });
  return checked(instance, () => expectHeaders(target, 'orgs-apps', ['Name', 'Agent', 'Identify users', 'Active keys', 'Session timeout']));
}

async function mountAgents(target: HTMLElement, kind: OrgsCellKind) {
  const [subscribeForm, unsubscribeForm] = await Promise.all([orgAgentSubscribeSchema, orgAgentUnsubscribeSchema].map((schema) => superValidate(zod4(schema as never), { errors: false })));
  const agents = [1, 2, 3].map((i) => ({
    id: `ag${i}`, name: i === 1 ? LONG_AGENT_NAME : `Agent ${i}`, urn: `hrn:agent:example.test:agent-${i}`, personaRole: i === 1 ? 'a-very-long-role-token-with-no-spaces-0123456789' : 'portal-engineer',
    description: 'A description that is long enough to need the room it is given in its column.', memoryItems: [{ id: 'm1' }], systemMemoryId: 'sm1',
  }));
  const grants = [1, 2, 3].map((i) => ({
    id: `g${i}`, agentId: `pa${i}`, agent: { id: `pa${i}`, name: i === 1 ? LONG_AGENT_NAME : `Public ${i}`, urn: `hrn:agent:other-org.example.test:agent-${i}` },
    isActive: true, revokedAt: null, expiresAt: null, activatedAt: '2026-11-01T02:04:36Z', createdAt: '2026-10-01T02:04:36Z',
  }));
  const data = {
    org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme', agents }, installedByAgent: { ag1: { appId: 'app1', appName: 'Team' } },
    subscribedGrants: grants, subscribablePublicAgents: [], subscribeForm, unsubscribeForm,
  };
  const instance = mount(AgentsPage, { target, props: pageProps(AgentsPage, data) });
  return checked(instance, async () => {
    if (kind === 'orgs-subscribed-agents') {
      // TabRow gives each tab `id="tab-<item id>"`: the exact tab, never a text match on a button.
      const tab = target.querySelector<HTMLElement>('button[role="tab"]#tab-subscribed');
      if (!tab) throw new Error('orgs-cell-fixtures: the Subscribed tab was not found');
      tab.click();
      await expectTab(target, kind, 'subscribed');
      await expectHeaders(target, kind, ['Owner', 'Status', 'Since'], ['Role', 'Memories']);
    } else {
      await expectTab(target, kind, 'own');
      await expectHeaders(target, kind, ['Role', 'Memories'], ['Owner', 'Since']);
    }
  });
}

async function mountRuns(target: HTMLElement) {
  const run = (i: number) => ({
    id: `r${i}`, appId: `app${i}`, status: i === 1 ? 'FAILED' : 'SUCCEEDED', triggerKind: 'SCHEDULE', eventData: { scheduleName: 'a-schedule-name-with-no-break-points-0123456789' },
    entryNodeUrn: 'hrn:node:example.test:memory:flows:a-very-long-flow-entry-node-name-with-no-break-points-0123456789', createdAt: '2026-11-01T02:04:36Z',
    startedAt: '2026-11-01T02:04:36Z', finishedAt: '2026-11-01T02:09:41Z', failure: { code: 'A_FAILURE_CODE_WITH_NO_BREAK_POINTS_AT_ALL_0123456789', message: 'boom' },
  });
  const runs = [1, 2, 3].map(run);
  const data = { org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme' }, runs, appNames: Object.fromEntries(runs.map((r, i) => [r.appId, i === 0 ? LONG_APP_NAME : `App ${i}`])), failed: false, truncated: false, total: 3 };
  const instance = mount(RunsPage, { target, props: pageProps(RunsPage, data) });
  return checked(instance, () => expectHeaders(target, 'orgs-runs', ['Started', 'Trigger', 'Entry node', 'Duration', 'Failure']));
}

async function mountMembers(target: HTMLElement) {
  const [addForm, impersonateForm, inviteForm, leaveForm, removeForm, updateForm] = await Promise.all(
    [addOrgMemberSchema, impersonateMemberSchema, inviteMemberSchema, leaveOrgSchema, removeOrgMemberSchema, updateOrgMemberSchema].map((schema) => superValidate(zod4(schema as never), { errors: false })),
  );
  // The caller is an OWNER, so every other row shows the role <select> and the row menu: the widest legal row.
  const member = (i: number, role: string) => ({
    id: `mem${i}`, role, canInvite: true, createdAt: '2026-11-01T02:04:36Z',
    user: { id: `u${i}`, handle: i === 0 ? 'owner' : `a-handle-with-no-break-points-${i}-0123456789`, name: i === 0 ? 'Owner' : LONG_MEMBER_NAME, githubUsername: null, email: `a-very-long-local-part-with-no-break-points-${i}@example.test`, avatarUrl: null },
  });
  const members = [member(0, 'OWNER'), member(1, 'ADMIN'), member(2, 'MEMBER'), member(3, 'MEMBER')];
  const data = { org: { id: 'org1', name: 'Acme', urn: 'hrn:org:example.test:acme', members }, currentUserId: 'u0', isImpersonating: false, addForm, impersonateForm, inviteForm, leaveForm, removeForm, updateForm };
  const instance = mount(MembersPage, { target, props: pageProps(MembersPage, data) });
  return checked(instance, () => expectHeaders(target, 'orgs-members', ['Member', 'Email', 'Role']));
}

export async function mountOrgsCellFixture(target: HTMLElement, kind: string): Promise<() => void> {
  if (kind === 'orgs-mine') {
    const orgs = [LONG_ORG_NAME, 'Acme', 'Globex'].map((name, i) => ({
      id: `org${i}`, name, urn: `hrn:org:example.test:${name.toLowerCase()}`, createdAt: '2026-11-01T02:04:36Z',
      members: list(1234), memories: list(12), agents: list(3), apps: list(2),
    }));
    const instance = mount(OrgsPage, { target, props: { data: { orgs } } as unknown as ComponentProps<typeof OrgsPage> });
    return checked(instance, () => expectHeaders(target, 'orgs-mine', ['Name', 'Members', 'Memories', 'Agents', 'Apps']));
  }
  if (kind === 'orgs-apps') return mountApps(target);
  if (kind === 'orgs-members') return mountMembers(target);
  if (kind === 'orgs-runs') return mountRuns(target);
  if (kind === 'orgs-agents' || kind === 'orgs-subscribed-agents') return mountAgents(target, kind);
  if (kind === 'orgs-memories-personal' || kind === 'orgs-memories-org' || kind === 'orgs-memories-subscriptions') return mountMemories(target, kind);
  throw new Error(`orgs-cell-fixtures: no fixture for ${kind}`);
}
