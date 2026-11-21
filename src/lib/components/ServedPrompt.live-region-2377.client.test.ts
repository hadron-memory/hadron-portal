/**
 * portal#2344 / #2377: the served prompt's loading line is a persistent LiveRegion. The first load
 * is already in flight at mount, so the reachable "before" is a loaded host that is pointed at
 * another subject: the region exists and is empty, holds the text while the new subject loads,
 * and is the same element once it has landed.
 */
import { afterEach, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import ServedPrompt from './ServedPrompt.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { mountComponent, wait } from '$lib/test/mountComponent';
import { announcedStatusRegion } from '$lib/test/firstPopulatedStatusText';

const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
const settle = async () => { await wait(15); flushSync(); };
const rec = (id: string) => ({
  id, kind: 'BIND', ordinal: 1, pointerLevel: 'APP_AGENT', servedAt: '2026-11-04T10:00:00.000Z', servedRevSeq: 7, provenanceRevSeq: 7,
  pruned: false, compiledContentHash: 'h', variables: {}, node: { urn: 'hrn:node:x:y:boot', name: 'Boot prompt' },
  provenance: { items: [], total: 0, offset: 0 }, lint: { items: [], total: 0, nextCursor: null },
});

it('the loading region is empty before, holds the text during, and is the same element after', async () => {
  let finishSecond!: (r: Response) => void;
  let calls = 0;
  const fetchImpl = (() => {
    calls++;
    if (calls === 1) return Promise.resolve(new Response(JSON.stringify({ items: [rec('r1')], total: 1, offset: 0 }), { status: 200 }));
    return new Promise<Response>((resolve) => { finishSecond = resolve; });
  }) as unknown as typeof fetch;
  const props = reactiveProps({ source: 'worker', refId: 'w1', fetchImpl } as Record<string, unknown>);
  const m = mountComponent(ServedPrompt as never, props as never);
  mounted.push(m);
  await settle();

  const region = m.target.querySelector<HTMLElement>('[role="status"]');
  expect(region, 'the region exists once the first load has landed').not.toBeNull();
  expect(region!.textContent?.trim()).toBe(''); // BEFORE
  expect(m.target.querySelector('[data-testid="served-prompt"]')).not.toBeNull();

  props.refId = 'w2';
  await settle();
  expect(announcedStatusRegion(m.target)).toBe(region); // DURING: same element, now speaking
  expect(region!.textContent).toContain('Loading the served prompt');

  finishSecond(new Response(JSON.stringify({ items: [rec('r2')], total: 1, offset: 0 }), { status: 200 }));
  await settle();
  expect(m.target.querySelector('[role="status"]')).toBe(region); // AFTER
  expect(region!.isConnected).toBe(true);
  expect(region!.textContent?.trim()).toBe('');
});
