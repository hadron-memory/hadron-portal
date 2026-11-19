// portal#1675/#1745: mounts the real ApplyAgentTickers section for scripts/test-apply-agent-tickers-focus.mjs.
// Loaded through Vite so `$lib`, `$app/*` and the component's own Svelte compile apply. Real Chromium is
// the point: jsdom computes no Tailwind cascade, so it cannot see `outline-none` beating
// `focus-visible:outline-2` (the #1619 slice hit the same wall first).
//
// portal#1745 item 2: the probe drives the REAL apply — Enter on the real submit button, the
// real use:enhance round trip (the POST is faked at the network layer against action '/__apply'),
// and the receipt arriving as the `result` prop, which is how kit's loader would deliver it. A
// module-level $state box plus a getter prop makes that delivery reactive from outside; the probe
// flips it the moment the round trip answers, and the component's own rendering takes it from there.
import { mount } from 'svelte';
import type { ComponentProps } from 'svelte';
import ApplyAgentTickers from '../../../lib/components/tickers/ApplyAgentTickers.svelte';
import type { ApplyResult } from '../../../lib/tickers/apply';

/** The receipt the faked POST round trip delivers, as a real loader would. */
export const applyReceipt: ApplyResult = {
  key: 'w-1', ok: true,
  created: [{
    tickerId: 't1', tickerName: 'code-review', tickerUrn: 'hrn:node:hadronmemory.com:example:t1',
    templateId: 'tpl1', templateName: 'Reviews', effectiveCadenceSeconds: 900,
  }],
  alreadyPresent: [{ id: 't2', name: 'deploys' }],
};

/** Delivered as the `result` prop by the probe, after the real round trip answers. */
export const applyFixture = $state<{ result: ApplyResult | null }>({ result: null });

export function mountApplyAgentTickers(target: HTMLElement) {
  const props: ComponentProps<typeof ApplyAgentTickers> = {
    canManage: true,
    // Faked at the network layer by the probe (page.route); the component runs its real enhance path.
    action: '/__apply',
    workerKey: 'w-1',
    get result() { return applyFixture.result; },
    floorSeconds: 300,
    viewerId: null,
    workerIdentity: null,
    errorPageWorker: () => null,
  };
  return mount(ApplyAgentTickers, { target, props });
}
