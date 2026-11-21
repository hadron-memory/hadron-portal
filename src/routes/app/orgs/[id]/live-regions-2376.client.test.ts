/**
 * portal#2376 (slice 3 of #2344): the org overview's "Couldn't load boot prompt signing" is a note
 * in a region that is mounted before it speaks. Before/during/after: the region EXISTS and is EMPTY
 * while the signing read works, holds the note when it fails, and is the SAME element when it works again.
 */
import { afterEach, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { expectRegionLifecycle } from '$lib/test/statusRegionLifecycle';
import { orgProfileSchema } from './schema';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

it('"Couldn’t load boot prompt signing." on the overview: empty, then text, then the same element', async () => {
  setStubPage('http://localhost/app/orgs/org-1', { id: 'org-1' });
  const form = await superValidate({ name: 'Acme', urn: 'acme' }, zod4(orgProfileSchema), { errors: false });
  const working = { kind: 'ok', required: false, enforced: false, deploymentSigns: true };
  const props = reactiveProps<Record<string, unknown>>({
    data: { org: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme', members: [], createdAt: '2026-01-01T00:00:00Z' }, currentUserId: 'u1', form, signing: working },
    form: null,
  });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  const signing = (s: unknown) => () => { props.data = { ...(props.data as Record<string, unknown>), signing: s }; };
  await expectRegionLifecycle(mounted.target, 'Couldn’t load boot prompt signing.', signing({ kind: 'failed' }), signing(working), () => tick());
});
