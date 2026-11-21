/**
 * portal#2376 (slice 3 of #2344): the share page's two notes ("only the owner can see", "cannot be
 * shared") share a region that is mounted whatever the viewer can see. Before/during/after: the region
 * EXISTS and is EMPTY for the owner of a shareable memory, holds the note when that changes, and is
 * the SAME element when it changes back.
 */
import { afterEach, describe, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { expectLiveRegionLifecycle } from '$lib/test/expectLiveRegionLifecycle';
import { createShareSchema, revokeShareSchema, updateShareRoleSchema } from './schema';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const memory = (over: Record<string, unknown> = {}) => ({
  id: 'mem-1', name: 'Notes', urn: 'hrn:mem:acme.com:notes', class: 'personal', userId: 'owner-1', shareable: true, shares: [], ...over,
});
const owner = { id: 'owner-1', handle: 'holger', roles: [] };
const stranger = { id: 'someone-else', handle: 'ada', roles: [] };

async function open() {
  setStubPage('https://example.test/app/memories/mem-1/share', { id: 'mem-1' });
  const [createForm, roleForm, revokeForm] = await Promise.all([
    superValidate({ granteeRef: '', role: 'reader' as const }, zod4(createShareSchema), { errors: false }),
    superValidate(zod4(updateShareRoleSchema), { errors: false }),
    superValidate(zod4(revokeShareSchema), { errors: false }),
  ]);
  const base = { createForm, roleForm, revokeForm, shares: [] };
  const props = reactiveProps<Record<string, unknown>>({ data: { ...base, shareMemory: memory(), user: owner }, form: null });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  const set = (patch: Record<string, unknown>) => () => { props.data = { ...base, shareMemory: memory(), user: owner, ...patch }; };
  return { root: mounted.target, set };
}

describe('memory share page: the notes are in a persistent status region', () => {
  it('"Only the owner of this memory can see who it is shared with.": empty, then text, then the same element', async () => {
    const { root, set } = await open();
    await expectLiveRegionLifecycle({ root, text: 'Only the owner of this memory can see who it is shared with.', appear: set({ user: stranger }), disappear: set({}), settle: () => tick() });
  });

  it('"Private memories cannot be shared.": empty, then text, then the same element', async () => {
    const { root, set } = await open();
    await expectLiveRegionLifecycle({ root, text: 'Private memories cannot be shared.', appear: set({ shareMemory: memory({ class: 'private', shareable: false }) }), disappear: set({}), settle: () => tick() });
  });
});
