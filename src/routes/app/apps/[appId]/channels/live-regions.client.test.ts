/** portal#2376 — the Channels page's withheld-agents note is a persistent LiveRegion (before / during / after). */
import { afterEach, describe, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { expectLiveRegionLifecycle } from '$lib/test/expectLiveRegionLifecycle';
import Page from './+page.svelte';
import {
  addAttendanceSchema, createChannelSchema, deleteChannelSchema, editAttendanceSchema, removeAttendanceSchema, renameChannelSchema,
} from './schema';

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

describe('Channels page notes', () => {
  it('the installed agents are not visible, so they are not offered', async () => {
    const SHARED = { id: 'mem-shared', urn: 'hrn:mem:acme.com:team-shared', name: 'Team — shared chats' };
    const props = reactiveProps<Record<string, unknown>>({
      data: {
        appRows: [], orgRows: [], attendees: [], canManageRegister: true, registerLoadFailed: false, agentsWithheld: false,
        addAttendanceForm: await superValidate(zod4(addAttendanceSchema), { errors: false }),
        editAttendanceForm: await superValidate(zod4(editAttendanceSchema), { errors: false }),
        removeAttendanceForm: await superValidate(zod4(removeAttendanceSchema), { errors: false }),
        app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: 'org-1', defaultChannel: null, sharedMemory: SHARED },
        channels: [], total: 0, defaultChannelId: null, canWrite: {},
        createForm: await superValidate(zod4(createChannelSchema), { errors: false }),
        renameForm: await superValidate(zod4(renameChannelSchema), { errors: false }),
        deleteForm: await superValidate(zod4(deleteChannelSchema), { errors: false }),
      },
      form: null,
    });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const data = props.data as Record<string, unknown>;
    await expectLiveRegionLifecycle({ root: m.target, text: 'The agents installed in this App aren’t visible to you', settle: () => tick(2),
      appear: () => { props.data = { ...data, agentsWithheld: true }; }, disappear: () => { props.data = { ...data, agentsWithheld: false }; } });
  });
});
