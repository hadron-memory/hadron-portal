/** portal#2376 — the members panel's availability notes are persistent LiveRegions (before / during / after). */
import { afterEach, describe, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { pinRegion } from '$lib/test/pinStatusRegion';
import AppMembersPanel from './AppMembersPanel.svelte';
import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from './schema';

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function open() {
  const props = reactiveProps<Record<string, unknown>>({
    app: { id: 'a1', name: 'Digest', urn: 'hrn:app:acme.com:digest', organizationId: 'o1', agentId: null, agent: null, agents: [] },
    members: [], membersError: false, membersWithheld: false,
    addMemberForm: await superValidate(zod4(addAppMemberSchema), { errors: false }),
    ensureMemberForm: await superValidate(zod4(ensureAppMemberSchema), { errors: false }),
    removeMemberForm: await superValidate(zod4(removeAppMemberSchema), { errors: false }),
    form: null,
  });
  const m = mountComponent(AppMembersPanel as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { root: m.target, props, settle: () => tick(2) };
}

describe('App members panel notes', () => {
  it('the linked Agent is not visible (install roster withheld)', async () => {
    const { root, props, settle } = await open();
    const app = props.app as Record<string, unknown>;
    await pinRegion({ root, text: 'Which Agent is linked to this App isn’t visible to you.', settle,
      raise: () => { props.app = { ...app, agents: null }; }, clear: () => { props.app = { ...app, agents: [] }; } });
  });

  it('the members are not visible', async () => {
    const { root, props, settle } = await open();
    await pinRegion({ root, text: 'The members of this App aren’t visible to you.', settle,
      raise: () => { props.membersWithheld = true; }, clear: () => { props.membersWithheld = false; } });
  });
});
