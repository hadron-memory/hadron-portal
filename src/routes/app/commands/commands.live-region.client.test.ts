/**
 * portal#2375 — the result card of a command page is announced in a status region that was
 * already mounted and empty (portal#2344), not one inserted already populated. Before a result
 * the page holds an empty region; after the result the SAME element holds the card.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import AccessCheck from './access-check/+page.svelte';
import MergeMemory from './merge-memory/+page.svelte';
import MergeNode from './merge-node/+page.svelte';
import { accessCheckSchema } from './access-check/schema';
import { mergeMemorySchema } from './merge-memory/schema';
import { mergeNodeSchema } from './merge-node/schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function pin(Page: unknown, schema: unknown, prefill: Record<string, unknown>, result: unknown, text: string) {
  const form = await superValidate(zod4(schema as never), { errors: false });
  const props = reactiveProps<Record<string, unknown>>({ data: { prefill, form }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  const idle = idleStatusRegions(m.target);
  expect(idle.length).toBeGreaterThan(0);
  props.form = { form, result };
  await tick(3);
  const region = announcedStatusRegion(m.target);
  expect(region?.textContent).toContain(text);
  expect(idle).toContain(region);
}

describe('command result cards (portal#2375)', () => {
  it('access-check: the result lands in the status region that was already mounted and empty', async () => {
    await pin(AccessCheck, accessCheckSchema, { user: '', resource: '' }, {
      user: { id: 'u1', handle: 'ada', name: 'Ada', email: null },
      resourceUrn: 'hrn:mem:acme.com:docs', resourceKind: 'MEMORY', role: 'owner',
      canRead: true, canWrite: true, canManage: false, canDelete: false, grants: [],
    }, '@ada');
  });

  it('merge-memory: the result lands in the status region that was already mounted and empty', async () => {
    await pin(MergeMemory, mergeMemorySchema, { source: '', target: '', include: [], deleteSourceMem: false }, {
      id: 'm1', name: 'Docs', urn: 'hrn:mem:acme.com:docs',
    }, 'Merged into');
  });

  it('merge-node: the result lands in the status region that was already mounted and empty', async () => {
    await pin(MergeNode, mergeNodeSchema, { source: '', target: '', include: [], deleteSource: false }, {
      id: 'n1', memoryId: 'm1', name: 'Intro', loc: 'docs:intro',
    }, 'Merged into');
  });
});
