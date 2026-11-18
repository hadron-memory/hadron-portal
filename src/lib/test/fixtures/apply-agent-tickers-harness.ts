// portal#1675: mounts the real ApplyAgentTickers section for scripts/test-apply-agent-tickers-focus.mjs.
// Loaded through Vite so `$lib`, `$app/*` and the component's own Svelte compile apply. Real Chromium is
// the point: jsdom computes no Tailwind cascade, so it cannot see `outline-none` beating
// `focus-visible:outline-2` (the #1619 slice hit the same wall first).
import { mount } from 'svelte';
import ApplyAgentTickers from '../../../lib/components/tickers/ApplyAgentTickers.svelte';

export function mountApplyAgentTickers(target: HTMLElement) {
  return mount(ApplyAgentTickers as never, { target, props: {
    canManage: true,
    // Never posted: the pin drives the focus handoff, not the form round trip.
    action: '/__apply',
    workerKey: 'w-1',
    // A real receipt, so the region has visible content (an empty live region is zero-height and
    // unclickable) and the screenshots show the ring around what a reader actually sees.
    result: {
      key: 'w-1', ok: true,
      created: [{
        tickerId: 't1', tickerName: 'code-review', tickerUrn: 'hrn:node:hadronmemory.com:example:t1',
        templateId: 'tpl1', templateName: 'Reviews', effectiveCadenceSeconds: 900,
      }],
      alreadyPresent: [{ id: 't2', name: 'deploys' }],
    },
    floorSeconds: 300,
    viewerId: null,
    workerIdentity: null,
    errorPageWorker: () => null,
  } as never });
}
