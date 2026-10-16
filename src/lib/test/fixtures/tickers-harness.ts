// portal#1099: mounts the real Tickers list, a ticker page and the Wake-ups
// panel for scripts/test-tickers-layout.mjs. Loaded through Vite, so `$lib`
// aliases and each component's own Svelte compile apply. The data is long on
// purpose (names, URNs, quiet hours), since that is what pushes a phone wide.
import { flushSync, mount, unmount } from 'svelte';
import TickersList from '../../../routes/app/apps/[appId]/tickers/+page.svelte';
import TickerPage from '../../../routes/app/apps/[appId]/tickers/[tickerId]/+page.svelte';
import WakeUpsPanel from '../../components/tickers/WakeUpsPanel.svelte';

const app = { id: 'app-1', name: 'Product Team with a fairly long App name', urn: 'hrn:app:hadronmemory.com:hadron-dev-team', organizationId: null };
const settings = { kind: 'ok', value: { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 4320, dailyWakeBudgetDerived: true } };
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

export type TickersView = 'list' | 'detail' | 'wake';

export function mountTickers(target: HTMLElement, view: TickersView): () => void {
  let page;
  if (view === 'list') {
    page = mount(TickersList, {
      target,
      props: { data: { app, tickers: { kind: 'ok', value: [ticker] }, settings, subscriberCountPage: 50, loadedAt: LOADED, impersonating: null } } as never,
    });
  } else if (view === 'detail') {
    page = mount(TickerPage, {
      target,
      props: {
        data: {
          app, ticker, settings, paged: false, loadedAt: LOADED, impersonating: null,
          subscribers: { kind: 'ok', value: { items: [subscriber], hasNextPage: true, endCursor: 's1' } },
        },
      } as never,
    });
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
