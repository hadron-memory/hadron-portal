// portal#2488: the real Apps route pages, mounted with legal synthetic data, so the table-cell harness
// measures the cells production renders and not a copy of them. No API, no app stack.
import { mount, unmount } from 'svelte';
import Secrets from '../../../routes/app/apps/[appId]/secrets/+page.svelte';
import Stops from '../../../routes/app/apps/[appId]/stops/+page.svelte';
import Tasks from '../../../routes/app/apps/[appId]/tasks/+page.svelte';
import Tickers from '../../../routes/app/apps/[appId]/tickers/+page.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';

export const APPS_CELL_KINDS = ['apps-secrets', 'apps-stops', 'apps-tickers', 'apps-tasks'] as const;
const app = { id: 'fixture-app', name: 'Team', urn: 'hrn:app:example.test:team', organizationId: null };
const LONG = 'a'.repeat(63) + '1';
const at = '2026-11-01T02:04:36Z';

const secrets = Array.from({ length: 3 }, (_, i) => ({
  id: `s${i}`, ownerType: 'app', ownerId: app.id, name: `${LONG.slice(0, 60)}${i}${i}${i}`, kind: 'generic', protected: i === 0,
  currentVersion: 12, metadata: null, createdAt: at, createdBy: 'u1', updatedAt: at, updatedBy: 'u1',
}));
const signal = (i: number) => ({
  id: `stop-${i}-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef`, level: 'PAUSE', scope: 'WORKER', targetWorkerId: 'w1', targetHostId: null,
  setAt: at, until: i === 0 ? null : '2026-12-31T23:59:59Z', setByUserId: null, setByHostKey: true,
  live: i === 0, endedAt: i === 0 ? null : '2026-11-02T03:04:05Z', endKind: i === 0 ? null : 'LIFTED',
  endedByUserId: null, endedByHostKey: true,
});
const ticker = (i: number) => ({
  id: `tk-${i}`, name: `${LONG.slice(0, 50)}-${i}`, slug: `tk-${i}`, tickCode: `tick.tk-${i}`, urn: `hrn:ticker:example.test:team:tk-${i}`,
  enabled: i % 2 === 0, cadenceSeconds: i === 0 ? 15 * 86400 : 600, anchorAt: at, nextTickAt: at, lastTickAt: at, quietHours: null,
  relevance: 'ALL', channels: [], owner: { id: 'w-1', name: 'Dara', urn: 'hrn:worker:example.test:team:dara' },
  createdAt: at, updatedAt: null, reasons: ['READ_TEAM_CHANNEL'], subscribers: { hasNextPage: false, items: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] },
});

export function mountAppsCellFixture(target: HTMLElement, kind: string) {
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
      people: {}, after: null, loadedAt: at, impersonating: null,
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
  throw new Error(`unknown Apps cell fixture ${kind}`);
}
