// portal#2488: the real Apps route pages, mounted with legal synthetic data, so the table-cell harness
// measures the cells production renders and not a copy of them. No API, no app stack.
import { mount, unmount } from 'svelte';
import Detail from '../../../routes/app/apps/[appId]/+page.svelte';
import { pageData } from '../../../routes/app/apps/[appId]/app-page.fixture';
import Mine from '../../../routes/app/apps/+page.svelte';
import Secrets from '../../../routes/app/apps/[appId]/secrets/+page.svelte';
import Stops from '../../../routes/app/apps/[appId]/stops/+page.svelte';
import Tasks from '../../../routes/app/apps/[appId]/tasks/+page.svelte';
import Tickers from '../../../routes/app/apps/[appId]/tickers/+page.svelte';
import Channels from '../../../routes/app/apps/[appId]/channels/+page.svelte';
import { addAttendanceSchema, createChannelSchema, deleteChannelSchema, editAttendanceSchema, removeAttendanceSchema, renameChannelSchema } from '../../../routes/app/apps/[appId]/channels/schema';
import Grants from '../../../routes/app/apps/[appId]/grants/+page.svelte';
import { grantsFixture, fixtureGrant } from '../../../routes/app/apps/[appId]/grants/grants.fixture';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { setStubPage } from '$lib/test/stubs/app-stores';

const app = { id: 'fixture-app', name: 'Team', urn: 'hrn:app:example.test:team', organizationId: null };
const LONG = 'a'.repeat(63) + '1';
const at = '2026-11-01T02:04:36Z';

const secrets = Array.from({ length: 3 }, (_, i) => ({
  id: `s${i}`, ownerType: 'app', ownerId: app.id, name: `${LONG.slice(0, 60)}${i}${i}${i}`, kind: 'generic', protected: i === 0,
  currentVersion: 12, metadata: null, createdAt: at, createdBy: 'u1', updatedAt: at, updatedBy: 'u1',
}));
const signal = (i: number) => ({
  id: `stop-${i}-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef`, level: 'PAUSE', scope: 'WORKER', targetWorkerId: 'w1', targetHostId: null,
  setAt: at, until: i === 0 ? null : '2026-12-31T23:59:59Z', setByUserId: 'u-long', setByHostKey: false,
  live: i === 0, endedAt: i === 0 ? null : '2026-11-02T03:04:05Z', endKind: i === 0 ? null : 'LIFTED',
  endedByUserId: null, endedByHostKey: true,
});
const ticker = (i: number) => ({
  id: `tk-${i}`, name: `${LONG.slice(0, 50)}-${i}`, slug: `tk-${i}`, tickCode: `tick.tk-${i}`, urn: `hrn:ticker:example.test:team:tk-${i}`,
  enabled: i % 2 === 0, cadenceSeconds: i === 0 ? 15 * 86400 : 600, anchorAt: at, nextTickAt: at, lastTickAt: at, quietHours: null,
  relevance: 'ALL', channels: [], owner: { id: 'w-1', name: 'Dara', urn: 'hrn:worker:example.test:team:dara' },
  createdAt: at, updatedAt: null, reasons: ['READ_TEAM_CHANNEL'], subscribers: { hasNextPage: false, items: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] },
});

// The App detail page hosts three tables, one per tab. The page is mounted whole, on the tab under test, from the
// same fixture the page's own mounted tests use, so the cells are the ones production renders.
async function mountAppDetail(target: HTMLElement, tab: 'staff' | 'agents' | 'keys') {
  setStubPage(`http://localhost/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1?tab=${tab}`);
  const base = await pageData();
  const agent = (i: number) => ({ id: `ag${i}`, urn: `hrn:agent:example.test:${LONG.slice(0, 40)}${i}`, name: `${LONG}${i}`.slice(0, 64), personaRole: 'writer' });
  const worker = (i: number) => ({
    id: `w${i}`, name: `${LONG}${i}`.slice(0, 64), urn: `hrn:worker:example.test:team:w${i}`, role: 'coordinator', retiredAt: null,
    memoryId: `mem-${i}`, agent: { id: 'ag-coord', name: 'Coordinator', systemMemoryId: 'mem-sys' }, family: 'claude', hasLiveSession: true,
    heldByUserId: 'u1', heldAt: at, reportsTo: { kind: 'known', id: 'w0', name: `${LONG}-reports-to`, retired: i === 2 },
  });
  const key = (i: number) => ({ id: `k${i}`, label: `router-${i}`, keyPreview: 'hk_ab…yz', createdAt: at, lastUsedAt: null, revokedAt: null });
  const scopes = [{ scope: 'attention:deliver', hostId: null, grantedAt: at }, { scope: 'host:operate', hostId: `h-${LONG.slice(0, 40)}`, grantedAt: at }];
  const data = {
    ...base, user: { id: 'u1' }, initialTab: tab,
    app: { ...base.app, agentId: 'ag1', agent: agent(1), agents: [1, 2, 3].map(agent), memberCount: 1, availableMemberRoles: [] },
    staff: [1, 2, 3].map(worker), teamRoster: { kind: 'ok', byWorker: Object.fromEntries([1, 2, 3].map((i) => [`w${i}`, {
      worker: { id: `w${i}` }, checkStatus: { status: 'RUNNING', pendingReason: null }, pausedUntil: null,
      terminal: { status: 'IDLE', reason: null, checkedAt: new Date().toISOString(), lastTurnAt: new Date().toISOString() },
      currentTask: { id: `t${i}`, title: `${LONG.slice(0, 50)} task ${i}`, status: 'RUNNING', handle: `AT0.${i}` }, heldBy: null,
    }])) },
    appKeys: { kind: 'ok', keys: [1, 2, 3].map(key) },
    keyScopes: { kind: 'ok', byKey: { k1: scopes, k2: scopes, k3: scopes } },
  };
  const instance = mount(Detail as never, { target, props: { data, form: null } } as never);
  return () => unmount(instance);
}

export function mountAppsCellFixture(target: HTMLElement, kind: string): (() => void) | Promise<() => void> {
  if (kind === 'apps-staff' || kind === 'apps-agents' || kind === 'apps-keys') return mountAppDetail(target, kind.slice(5) as 'staff' | 'agents' | 'keys');
  if (kind === 'apps-secrets') {
    setStubPage('http://localhost/app/apps/fixture-app/secrets', { appId: app.id });
    const instance = mount(Secrets as never, { target, props: { form: null, data: { app, secrets: { kind: 'ok', secrets, total: secrets.length }, signing: 'on', pending: [], impersonating: null } } } as never);
    return () => unmount(instance);
  }
  if (kind === 'apps-stops') {
    setStubPage('http://localhost/app/apps/fixture-app/stops', { appId: app.id });
    const data = {
      app, page: { kind: 'ok', value: { signals: [0, 1, 2].map(signal), pageInfo: { hasNextPage: false, endCursor: null } } },
      live: { signals: [], complete: true }, manages: 'yes', workers: [{ id: 'w1', name: 'Gaby', urn: 'hrn:worker:example.test:team:gaby' }],
      people: { 'u-long': `${LONG}-a-person-with-an-unbroken-name` }, after: null, loadedAt: at, impersonating: null,
    };
    const instance = mount(Stops as never, { target, props: { data } } as never);
    return () => unmount(instance);
  }
  if (kind === 'apps-tickers') {
    setStubPage('http://localhost/app/apps/fixture-app/tickers', { appId: app.id });
    const settings = { kind: 'ok', value: { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 480, dailyWakeBudgetDerived: true } };
    const delivery = { kind: 'ok', value: { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false } };
    const data = { app, tickers: { kind: 'ok', value: [0, 1, 2].map(ticker) }, settings, delivery, subscriberCountPage: 50, loadedAt: at, impersonating: null };
    const instance = mount(Tickers as never, { target, props: { data } } as never);
    return () => unmount(instance);
  }
  if (kind === 'apps-mine') {
    setStubPage('http://localhost/app/apps', {});
    const apps = [0, 1, 2].map(i => ({
      id: `app-${i}`, name: `${LONG}${i}`.slice(0, 64), urn: `hrn:app:example.test:app-${i}`, appType: 'TEAM', description: 'A description that is long enough to need truncating in its own column',
      agent: { name: `${LONG.slice(0, 40)}-agent` },
    }));
    const instance = mount(Mine as never, { target, props: { data: { apps, loadFailed: false } } } as never);
    return () => unmount(instance);
  }
  if (kind === 'apps-tasks') {
    setStubPage('http://localhost/app/apps/fixture-app/tasks', { appId: app.id });
    const task = (i: number) => ({
      id: `01a2004bdd8a739385e31983080d80${i}${i}`, handle: `AT0.${i}`, parentTaskId: null, title: `${LONG}-title-${i}`, status: 'PENDING', queued: false,
      waitingOnChildren: false, priority: null, blocked: null, source: null, owner: { id: 'u', kind: 'USER', name: 'U', urn: null }, assignee: null,
      startBy: at, finishBy: at, overdue: false, createdAt: at, updatedAt: at, tags: [`${LONG}-tag`, 'second-unbroken-tag-name-that-is-long'],
    });
    const data = {
      app, view: 'board', filter: 'all', text: '', boardLimit: 200, loadedAt: at, impersonating: null,
      board: { kind: 'ok', value: { capped: false, tasks: [1, 2, 3].map(task) } },
    };
    const instance = mount(Tasks as never, { target, props: { data, form: null } } as never);
    return () => unmount(instance);
  }
  if (kind === 'apps-channels') return mountChannels(target);
  if (kind === 'apps-grants') {
    setStubPage('http://localhost/app/apps/app-example/grants', { appId: 'app-example' });
    const base = grantsFixture();
    const grants = [0, 1, 2].map(i => ({ ...fixtureGrant, id: `grant-${i}`, holderId: `worker-${i}`, reason: `${LONG}${LONG} reason ${i}`, action: i === 0 ? 'bootprompt.compile.approve' : 'schedule.create', values: { entryNode: `${LONG}-node-${i}` } }));
    const holders = Object.fromEntries(grants.map(g => [`WORKER:${g.holderId}`, { id: g.holderId, name: `${LONG.slice(0, 55)}-${g.holderId}`, urn: `hrn:worker:example.test:team:${LONG.slice(0, 40)}${g.holderId}` }]));
    const data = { ...base, grants: { items: grants, total: grants.length }, holders };
    const instance = mount(Grants as never, { target, props: { data, form: null } } as never);
    return () => unmount(instance);
  }
  throw new Error(`unknown Apps cell fixture ${kind}`);
}

// portal#2488: the Channels page — one team chat and one channel with a 64-char unbroken name, a long description
// and a memory the viewer can and cannot read, so the name, address and host cells carry their worst case.
async function mountChannels(target: HTMLElement) {
  setStubPage('http://localhost/app/apps/app-example/channels', { appId: 'app-example' });
  const shared = { id: 'mem-shared', urn: `hrn:mem:example.test:${LONG.slice(0, 40)}-team-shared`, name: `${LONG} shared chats` };
  const channel = (i: number) => ({
    id: `ch-${i}`, name: `${LONG.slice(0, 62)}-${i}`, description: `${LONG}${LONG} what this channel is for`, kind: 'CHAT', loc: `chats:c${i}`,
    chatRootUrn: i === 2 ? null : `hrn:node:example.test:${LONG.slice(0, 40)}-team-shared:chats:${LONG.slice(0, 40)}${i}`, chatRootNodeId: `root-${i}`,
    lastSeq: 12, lastMessageAt: null, createdAt: at, memoryId: 'mem-shared', memory: i === 1 ? null : shared,
  });
  const data = {
    appRows: [], orgRows: [], attendees: [], canManageRegister: false, registerLoadFailed: false,
    addAttendanceForm: await superValidate(zod4(addAttendanceSchema), { errors: false }),
    editAttendanceForm: await superValidate(zod4(editAttendanceSchema), { errors: false }),
    removeAttendanceForm: await superValidate(zod4(removeAttendanceSchema), { errors: false }),
    app: { id: 'app-example', name: 'Team', urn: 'hrn:app:example.test:team', organizationId: 'org-1', defaultChannel: { id: 'ch-0' }, sharedMemory: shared },
    channels: [0, 1, 2].map(channel), total: 3, defaultChannelId: 'ch-0', canWrite: { 'mem-shared': true },
    createForm: await superValidate(zod4(createChannelSchema), { errors: false }),
    renameForm: await superValidate(zod4(renameChannelSchema), { errors: false }),
    deleteForm: await superValidate(zod4(deleteChannelSchema), { errors: false }),
  };
  const instance = mount(Channels as never, { target, props: { data, form: null } } as never);
  return () => unmount(instance);
}
