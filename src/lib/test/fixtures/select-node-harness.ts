// portal#1576: mounts the real SelectNode picker for
// scripts/test-select-node-layout.mjs. Loaded through Vite, so `$lib` aliases
// and the component's own Svelte compile apply. fetch is stubbed URL-routed
// (the same discipline as the client tests: one queue per endpoint, never a
// catch-all) with data long on purpose — names, locs, URNs — since that is
// what pushes the modal wide.
import { flushSync, mount, unmount } from 'svelte';
import SelectNode from '../../components/SelectNode.svelte';
import type { NodeChoice } from '../../node-choices';

// portal#1496's widest-stress constant, in the picker's own shape: a
// 200-character unbroken node URN is the widest thing a row renders.
const URN_PREFIX = 'hrn:node:hadronmemory.com:hadron-dev-team:';
const LONG_URN = URN_PREFIX + 'f'.repeat(200 - URN_PREFIX.length);

const memories = [
  { id: 'm1', name: 'Product Team with a fairly long memory name', urn: 'hrn:mem:hadronmemory.com:hadron-dev-team' },
  { id: 'm2', name: 'Portal engineering findings', urn: 'hrn:mem:hadronmemory.com:hadron-portal' },
  { id: 'm3', name: 'Server incidents and operations', urn: 'hrn:mem:hadronmemory.com:hadron-server' },
];

const node = (i: number, over: Partial<NodeChoice> = {}): NodeChoice => ({
  id: `n${i}`,
  name: `Node ${i} — a name long enough to stress the column`,
  loc: `findings:engineering-reviews-and-ready-calls-${i}`,
  urn: `${URN_PREFIX}findings:engineering-reviews-and-ready-calls-${i}`,
  ...over,
});

const url = (query: string, offset: number) => `/app/memories/m1/nodes/choices?query=${query}&offset=${offset}`;
// nextOffset mirrors the endpoint's raw-count paging (#1582 BLIND P2-3): the
// offset the NEXT page starts at, never re-derived from the rows sent.
const okPage = (items: NodeChoice[], hasMore: boolean, nextOffset: number) => async () => ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore, nextOffset } }) });

type FetchFactory = () => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** URL-routed queues, like the client tests: an unexpected request fails loudly. */
function serve(routes: Record<string, Array<FetchFactory | Error>>) {
  const original = window.fetch;
  window.fetch = ((input: RequestInfo | URL) => {
    const queue = routes[String(input)];
    if (!queue || queue.length === 0) return Promise.reject(new Error(`unexpected fetch: ${String(input)}`));
    const next = queue.shift()!;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next());
  }) as typeof fetch;
  return () => { window.fetch = original; };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function button(root: HTMLElement, text: string) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
}

// 'stacked' (#1590): a memory already chosen, then Change… opens SelectMemory
// over the node dialog: the state where the upper dialog covered the host's header.
export type SelectNodeView = 'memory-stage' | 'results' | 'results-long-urn' | 'more' | 'failed' | 'stacked';

export async function mountSelectNode(target: HTMLElement, view: SelectNodeView): Promise<() => void> {
  const restore =
    view === 'memory-stage' ? serve({}) :
    view === 'failed' ? serve({ [url('x', 0)]: [new Error('transport')] }) :
    view === 'more' ? serve({ [url('node', 0)]: [okPage(Array.from({ length: 20 }, (_, i) => node(i)), true, 20)] }) :
    // results: a full page then a short one — 23 rows, Load more gone.
    // results-long-urn is the same pages with the widest row ON PAGE ONE
    // (DataTable shows the first 10), so the shot actually sees it.
    view === 'results-long-urn'
      ? serve({
        [url('node', 0)]: [okPage(Array.from({ length: 20 }, (_, i) => i === 0
          ? node(0, { urn: LONG_URN, loc: 'findings:very-long-unbroken-loc-' + 'f'.repeat(80), name: 'The widest row: a 200-character URN' })
          : node(i)), true, 20)],
        [url('node', 20)]: [okPage([node(20), node(21)], false, 22)],
      })
      : serve({
        [url('node', 0)]: [okPage(Array.from({ length: 20 }, (_, i) => node(i)), true, 20)],
        [url('node', 20)]: [okPage([node(20), node(21)], false, 22)],
      });

  const picked: NodeChoice[] = [];
  const app = mount(SelectNode, { target, props: { memories, open: true, onselect: (n: NodeChoice) => picked.push(n) } });
  flushSync();

  if (view === 'stacked') {
    const row = [...target.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(memories[0].name))!;
    ([...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Select'))!.click();
    await settle();
    flushSync();
    button(target, 'Change…')!.click();
    await settle();
    flushSync();
  } else if (view !== 'memory-stage') {
    // Stage 1: pick the first memory in the nested SelectMemory.
    const row = [...target.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(memories[0].name))!;
    ([...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Select'))!.click();
    await settle();
    // Stage 2: search. The box is named by its visible wrapping label
    // ("Search nodes"), not an aria-label of its own — find it via the label.
    const input = ([...target.querySelectorAll('label')].find((l) => l.textContent?.includes('Search nodes'))!).querySelector('input') as HTMLInputElement;
    input.value = view === 'failed' ? 'x' : 'node';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    button(target, 'Find')!.click();
    await settle();
    flushSync();
    if (view === 'results' || view === 'results-long-urn') {
      const more = button(target, 'Load more nodes');
      if (more) {
        more.click();
        await settle();
        flushSync();
      }
    }
  }

  return () => {
    unmount(app);
    restore();
    flushSync();
  };
}
