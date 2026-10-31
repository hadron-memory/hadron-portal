// portal#1099: mounts the real Tickers list, a ticker page and the Wake-ups
// panel for scripts/test-tickers-layout.mjs. Loaded through Vite, so `$lib`
// aliases and each component's own Svelte compile apply. The data is long on
// purpose (names, URNs, quiet hours), since that is what pushes a phone wide.
import { flushSync, mount, unmount } from 'svelte';
import TickersList from '../../../routes/app/apps/[appId]/tickers/+page.svelte';
import TickerPage from '../../../routes/app/apps/[appId]/tickers/[tickerId]/+page.svelte';
import WakeUpsPanel from '../../components/tickers/WakeUpsPanel.svelte';
import WriteRefusalAlert from '../../components/agent-tasks/WriteRefusal.svelte';
import TickerRefreshFailedLine from '../../components/tickers/TickerRefreshFailedLine.svelte';

const app = { id: 'app-1', name: 'Product Team with a fairly long App name', urn: 'hrn:app:hadronmemory.com:hadron-dev-team', organizationId: null };
const settings = { kind: 'ok', value: { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 4320, dailyWakeBudgetDerived: true } };
// portal#1141 A: the Delivery section, with its form (the wide case on a phone).
const delivery = { kind: 'ok', value: { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: true, standbyEffective: false } };
const LOADED = '2026-10-16T10:00:00Z';
const quietHours = {
  timezone: 'America/Argentina/ComodRivadavia',
  windows: [
    { days: [1, 2, 3, 4, 5], from: '22:00', to: '07:00' },
    { days: [6, 7], from: '00:00', to: '10:00' },
  ],
};
const ticker = {
  id: 'tk-1', name: 'engineering-reviews-and-ready-calls-overnight', slug: 'engineering-reviews-and-ready-calls-overnight',
  urn: 'hrn:ticker:hadronmemory.com:hadron-dev-team:engineering-reviews-and-ready-calls-overnight',
  enabled: true, cadenceSeconds: 600, anchorAt: '2026-10-01T00:00:00Z', nextTickAt: '2026-10-16T10:10:00Z', lastTickAt: '2026-10-16T10:00:00Z',
  quietHours, relevance: 'MENTIONS',
  channels: [{ id: 'c1', name: 'team-chat' }, { id: 'c2', name: 'engineering-incidents-and-escalations' }],
  owner: { id: 'w-dara', name: 'Dara', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:dara' },
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
  subscribers: { hasNextPage: true, items: [] },
};
const subscriber = {
  id: 's1', createdAt: '2026-10-10T00:00:00Z', viaGrant: true,
  createdBy: { id: 'w-ada', name: 'Ada (coordinator with a long display name)', urn: null },
  worker: { id: 'w-liam', name: 'Liam', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:liam', retiredAt: null },
};

// portal#1384: a long code and a long loc, unbroken, are what push the Task entry wide.
const LONG_CODE = 'tick.engineering-reviews-and-ready-calls-overnight-and-weekend-coverage';
const LONG_LOC = 'tasks:team:on-base-tick:engineering-reviews-and-ready-calls-overnight-and-weekend';
const detailTask = {
  'detail': { kind: 'ok', value: { registerTaskLoc: LONG_LOC } },
  'detail-unmapped': { kind: 'ok', value: { registerTaskLoc: null } },
  'detail-task-failed': { kind: 'failed' },
} as const;

// portal#1497: the roster read behind the Add-subscriber chooser. The named
// workers are long on purpose — a nameless one shows its URN, the widest
// label the select offers — and the subscribed row's worker (Liam) is NOT in
// it, the stale-row case: the row keeps its Remove whatever the roster said.
const rosterOk = { kind: 'ok', workers: [
  { id: 'w-dara', name: 'Dara (coordinator with a fairly long display name)', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:dara' },
  { id: 'w-nameless', name: null, urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:very-long-nameless-worker-identifier' },
] };
const rosters = {
  'detail': rosterOk,
  'detail-unmapped': rosterOk,
  'detail-task-failed': rosterOk,
  'detail-stale-row': rosterOk,
  'detail-roster-hidden': { kind: 'hidden' },
  'detail-roster-failed': { kind: 'failed' },
  'detail-roster-empty': { kind: 'ok', workers: [] },
  'detail-uncertain': rosterOk,
  'detail-refresh-failed': rosterOk,
} as const;

export type TickersView =
  | 'list'
  | keyof typeof detailTask
  | keyof typeof rosters
  | 'wake';

export function mountTickers(target: HTMLElement, view: TickersView): () => void {
  let page;
  if (view === 'list') {
    page = mount(TickersList, {
      target,
      props: { data: { app, tickers: { kind: 'ok', value: [ticker] }, settings, delivery, subscriberCountPage: 50, loadedAt: LOADED, impersonating: null } } as never,
    });
  } else if (view in detailTask || view in rosters) {
    page = mount(TickerPage, {
      target,
      props: {
        data: {
          app, ticker: { ...ticker, tickCode: LONG_CODE }, settings, paged: false, after: null, loadedAt: LOADED, impersonating: null,
          tickerTask: view in detailTask ? detailTask[view as keyof typeof detailTask] : { kind: 'ok', value: { registerTaskLoc: LONG_LOC } },
          roster: rosters[view as keyof typeof rosters],
          subscribers: { kind: 'ok', value: { items: [subscriber], hasNextPage: true, endCursor: 's1' } },
        },
      } as never,
    });
    // portal#1497: the two states only a delivered action result reaches. The
    // real alert and the real line are mounted beside the real page, in the
    // exact place the controls render them (under the subscriber controls).
    if (view === 'detail-uncertain' || view === 'detail-refresh-failed') {
      const section = [...target.querySelectorAll('section')].find((s) => s.querySelector('[data-testid="ticker-subscriber-who"]'));
      const host = document.createElement('div');
      host.className = 'space-y-2';
      section?.appendChild(host);
      if (view === 'detail-uncertain') {
        mount(WriteRefusalAlert, { target: host, props: { refusal: { kind: 'uncertain' } } as never });
      } else {
        mount(TickerRefreshFailedLine, { target: host, props: {} as never });
      }
    }
  } else {
    page = mount(WakeUpsPanel, {
      target,
      props: {
        wake: {
          kind: 'ok',
          value: {
            mentions: 'IMMEDIATE', pausedUntil: null, dormant: false, effectiveCadenceSeconds: 600,
            subscriptions: [{ id: 's1', createdAt: '2026-10-10T00:00:00Z', viaGrant: true, createdBy: subscriber.createdBy, ticker }],
          },
        },
        appSettings: settings, worker: { retiredAt: null }, appId: 'app-1', loadedAt: LOADED,
      } as never,
    });
  }
  flushSync();
  return () => unmount(page);
}
