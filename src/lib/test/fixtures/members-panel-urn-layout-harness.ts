// portal#2532: the REAL App members panel (AppMembersPanel.svelte), mounted in real
// Chromium by scripts/test-members-panel-urn-layout.mjs, with a very long Agent URN so the
// Agent chip has to give way. Synthetic data only: no server, no form is submitted. The runner
// aliases `$app/*` to the recorder stubs, as the client test lane does.
import { mount, unmount } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import AppMembersPanel from '../../../routes/app/apps/[appId]/AppMembersPanel.svelte';
import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from '../../../routes/app/apps/[appId]/schema';

/** 100+ characters with no break point the browser could wrap at. */
export const LONG_AGENT_URN = `hrn:agent:example.com:${'a-very-long-agent-slug-that-cannot-wrap-'.repeat(3)}end`;

/**
 * The two places the panel names its Agent by URN: the "Roles below are defined by the linked
 * Agent" line (`roles`), and the empty-roles line above the add form (`empty`).
 */
export type MembersPanelVariant = 'roles' | 'empty';

export async function mountMembersPanel(target: HTMLElement, variant: MembersPanelVariant) {
  const app = {
    id: 'a1', name: 'Digest', urn: 'hrn:app:example.com:digest', organizationId: 'o1', agentId: 'ag1',
    agent: { id: 'ag1', urn: LONG_AGENT_URN, name: 'One', installationPolicy: { memberRoles: [], maxMembers: 'unlimited' } },
    agents: [],
    availableMemberRoles: variant === 'roles' ? ['owner'] : [],
  };
  const props = {
    app, members: [], membersError: false, membersWithheld: false,
    addMemberForm: await superValidate(zod4(addAppMemberSchema), { errors: false }),
    ensureMemberForm: await superValidate(zod4(ensureAppMemberSchema), { errors: false, id: 'ensure-member' }),
    removeMemberForm: await superValidate(zod4(removeAppMemberSchema), { errors: false }),
    form: null,
  };
  const component = mount(AppMembersPanel as never, { target, props: props as never });
  return () => unmount(component);
}
