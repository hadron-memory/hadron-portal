// portal#1099: mounts the real Tickers list, a ticker page and the Wake-ups
// panel for scripts/test-tickers-layout.mjs. Loaded through Vite, so `$lib`
// aliases and each component's own Svelte compile apply. The data is long on
// purpose (names, URNs, quiet hours), since that is what pushes a phone wide.
import { flushSync, mount, unmount } from 'svelte';
import TickersList from '../../../routes/app/apps/[appId]/AppTickers.svelte';
import TickerPage from '../../../routes/app/apps/[appId]/tickers/[tickerId]/+page.svelte';
import WakeUpsPanel from '../../components/tickers/WakeUpsPanel.svelte';
import WriteRefusalAlert from '../../components/agent-tasks/WriteRefusal.svelte';
import TickerRefreshFailedLine from '../../components/tickers/TickerRefreshFailedLine.svelte';
import TickerRemoveOutcomeLine from '../../components/tickers/TickerRemoveOutcomeLine.svelte';
import { removedWorkerText } from '../../tickers/controls';

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

// portal#1496: the Wake-ups CLI commands carry the worker ref, so a
// 200-character unbroken URN is what pushes them wide. portal#1497's controls
// made the same URN the ticker page's own widest label — the subscribers
// table row, the row's open Remove confirmation, the chooser's selected-worker
// chip — so its long variant (detail-long-urn) rides on the same constant.
const LONG_WORKER_URN = `hrn:worker:hadronmemory.com:hadron-dev-team:${'y'.repeat(200 - 'hrn:worker:hadronmemory.com:hadron-dev-team:'.length)}`;

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
  'detail-impersonating': rosterOk,
  // portal#1502 (UX delta, Uma P2): the page-level OUTCOME in its widest
  // composite — sentence + Urn chip + BOTH caveats — mounted populated below
  // (a populated outcome needs a delivered action result, which this harness
  // cannot produce, per
  // hrn:node:hadronmemory.com:hadron-portal:findings:enhance-deserialize-needs-a-booted-app).
  'detail-outcome': rosterOk,
  // The chooser's widest state: the nameless worker whose URN IS the label,
  // at the 200-character extreme.
  'detail-long-urn': { kind: 'ok', workers: [
    { id: 'w-dara', name: 'Dara (coordinator with a fairly long display name)', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:dara' },
    { id: 'w-longnameless', name: null, urn: LONG_WORKER_URN },
  ] },
} as const;

// portal#1497 (review): the subscribers table row is the page's other URN
// carrier — the long variant gives it the same 200-character worker URN.
const subscribersByView: Record<string, unknown> = {
  'detail-long-urn': { kind: 'ok', value: { items: [
    { ...subscriber, worker: { id: 'w-longnameless', name: null, urn: LONG_WORKER_URN, retiredAt: null } },
  ], hasNextPage: true, endCursor: 's1' } },
};

const wakeWorker = {
  'wake': { retiredAt: null, id: 'w-liam', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:liam' },
  'wake-long-urn': { retiredAt: null, id: 'w-liam', urn: LONG_WORKER_URN },
} as Record<string, Record<string, unknown>>;

// portal#1502 (review): an impersonation session renders no Remove trigger —
// the page-level note instead of one per row.
const impersonatingByView: Record<string, string | null> = {
  'detail-impersonating': 'Ada',
};

export type TickersView =
  | 'list'
  | keyof typeof detailTask
  | keyof typeof rosters
  | keyof typeof wakeWorker;

export function mountTickers(target: HTMLElement, view: TickersView): () => void {
  let page;
  if (view === 'list') {
    page = mount(TickersList, {
      target,
      props: { appId: app.id, app, panel: { tickers: { kind: 'ok', value: [ticker] }, settings, delivery, subscriberCountPage: 50, loadedAt: LOADED, impersonating: null } } as never,
    });
  } else if (view in detailTask || view in rosters) {
    page = mount(TickerPage, {
      target,
      props: {
        data: {
          app, ticker: { ...ticker, tickCode: LONG_CODE }, settings, paged: false, after: null, loadedAt: LOADED, impersonating: impersonatingByView[view] ?? null,
          tickerTask: view in detailTask ? detailTask[view as keyof typeof detailTask] : { kind: 'ok', value: { registerTaskLoc: LONG_LOC } },
          roster: rosters[view as keyof typeof rosters],
          subscribers: subscribersByView[view] ?? { kind: 'ok', value: { items: [subscriber], hasNextPage: true, endCursor: 's1' } },
        },
      } as never,
    });
    // portal#1497 (review) / portal#1502 (review): the long-URN view mounts the
    // page in its widest control states, the ones a reader can leave on screen —
    // the Remove panel open (the row trigger clicked; its Urn chip AND its
    // confirmation sentence carry the 200-character worker URN), and the chooser
    // open with the nameless long-URN worker selected, taken through Continue to
    // its confirmation (the sentence carries the same URN as one word).
    if (view === 'detail-long-urn') {
      target.querySelector<HTMLButtonElement>('[data-testid="ticker-remove-s1"]')?.click();
      flushSync();
      target.querySelector<HTMLButtonElement>('[data-testid="ticker-add-subscriber"] button')?.click();
      flushSync();
      const select = target.querySelector<HTMLSelectElement>('[data-testid="ticker-add-worker"]');
      if (select) {
        select.value = 'w-longnameless';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      flushSync();
      ([...target.querySelectorAll<HTMLButtonElement>('[data-testid="ticker-add-form"] button')].find((b) => /Continue/.test(b.textContent ?? '')))?.click();
      flushSync();
    }
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
    // portal#1502 (UX delta, Uma P2): the populated Remove outcome, mounted in
    // the gap the page renders it in (between the Add control and the Remove
    // panel) — its widest composite: sentence + the worker's Urn chip + BOTH
    // caveats (a committed removal whose announcement failed, then a reload
    // that could not be served). 'committed' keeps the caveat's claim true
    // here: this composite's write stands (Gizelle P2-2 discriminator).
    // Beside it, the REFUSED composite (the stale-row refusal whose reload
    // failed): no chip, no announcement — and a caveat that may not say
    // "Saved", pinned in the real browser too, not only in jsdom text.
    if (view === 'detail-outcome') {
      const add = target.querySelector('[data-testid="ticker-add-subscriber"]');
      const host = document.createElement('div');
      host.dataset.testid = 'ticker-remove-outcome-mounted';
      add?.after(host);
      mount(TickerRemoveOutcomeLine, {
        target: host,
        props: {
          text: removedWorkerText(subscriber.worker.name ?? subscriber.worker.id),
          workerUrn: subscriber.worker.urn,
          announcementFailed: true,
          refreshFailed: 'committed',
        } as never,
      });
      const refusedHost = document.createElement('div');
      refusedHost.dataset.testid = 'ticker-remove-outcome-refused-mounted';
      host.after(refusedHost);
      mount(TickerRemoveOutcomeLine, {
        target: refusedHost,
        props: {
          // The failed-reload variant: the base claims only the first truth —
          // never "the list is back at its first page" (Uma P2 / Gizelle
          // delta) — and the caveat (kind 'refused') names only the reload.
          text: 'No longer subscribed.',
          workerUrn: null,
          announcementFailed: false,
          refreshFailed: 'refused',
        } as never,
      });
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
        appSettings: settings, worker: wakeWorker[view], appId: 'app-1', loadedAt: LOADED,
      } as never,
    });
  }
  flushSync();
  return () => unmount(page);
}
