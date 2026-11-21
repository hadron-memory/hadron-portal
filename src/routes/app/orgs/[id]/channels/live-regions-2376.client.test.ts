/**
 * portal#2376 (slice 3 of #2344): the org Channels page's roster notes sit in regions that are
 * mounted before they speak. Before/during/after: the region EXISTS and is EMPTY while the roster
 * loaded fully, holds the note, and is the SAME element when the roster is whole again.
 */
import { afterEach, describe, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { expectRegionLifecycle } from '$lib/test/statusRegionLifecycle';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { addAttendanceSchema, editAttendanceSchema, removeAttendanceSchema } from '$lib/register/schema';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

async function open() {
  const data = {
    org: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' },
    channels: [], orgRows: [], attendees: [],
    registerLoadFailed: false, canManageRegister: true,
    rosterUnreadApps: 0, rosterFailed: false, rosterWithheldApps: 0,
    addAttendanceForm: await superValidate(zod4(addAttendanceSchema), { errors: false }),
    editAttendanceForm: await superValidate(zod4(editAttendanceSchema), { errors: false }),
    removeAttendanceForm: await superValidate(zod4(removeAttendanceSchema), { errors: false }),
  };
  const props = reactiveProps<Record<string, unknown>>({ data, form: null });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  const set = (patch: Record<string, unknown>) => () => { props.data = { ...data, ...patch }; };
  return { root: mounted.target, set, whole: set({}) };
}

describe('org Channels page: the roster notes are persistent status regions', () => {
  it('"Couldn’t load this organization’s workers and agents just now": empty, then text, then the same element', async () => {
    const { root, set, whole } = await open();
    await expectRegionLifecycle(root, 'Couldn’t load this organization’s workers and agents just now', set({ rosterFailed: true }), whole, () => tick());
  });

  it('"Couldn’t load the workers and agents of 2 App(s)": empty, then text, then the same element', async () => {
    const { root, set, whole } = await open();
    await expectRegionLifecycle(root, 'Couldn’t load the workers and agents of 2 App(s) just now', set({ rosterUnreadApps: 2 }), whole, () => tick());
  });

  it('"The agents installed in 3 App(s) aren’t visible to you": empty, then text, then the same element', async () => {
    const { root, set, whole } = await open();
    await expectRegionLifecycle(root, 'The agents installed in 3 App(s) aren’t visible to you', set({ rosterWithheldApps: 3 }), whole, () => tick());
  });
});
