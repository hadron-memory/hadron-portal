// portal#2532: the REAL App members panel (AppMembersPanel.svelte), mounted in real
// Chromium by scripts/test-members-panel-urn-layout.mjs, with a very long Agent URN so the
// Agent chip has to give way. Synthetic data only: no server, no form is submitted. The runner
// aliases `$app/*` to the recorder stubs, as the client test lane does.
import { mount, tick, unmount, type ComponentProps } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { App } from '$lib/types';
import AppMembersPanel from '../../../routes/app/apps/[appId]/AppMembersPanel.svelte';
import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from '../../../routes/app/apps/[appId]/schema';

/** 100+ characters with no break point the browser could wrap at. */
export const LONG_AGENT_URN = `hrn:agent:example.com:${'a-very-long-agent-slug-that-cannot-wrap-'.repeat(3)}end`;

/**
 * The two places the panel names its Agent by URN, both inside the add form: the "Roles come from"
 * helper under the Role field (`roles`), and the empty-roles line above it (`empty`).
 */
export type MembersPanelVariant = 'roles' | 'empty';

export async function mountMembersPanel(target: HTMLElement, variant: MembersPanelVariant) {
  // Typed, not cast: a prop or App field the panel starts to need shows up in `pnpm check`
  // (svelte-check covers this file) instead of being hidden by a cast.
  const app: App = {
    id: 'a1', name: 'Digest', urn: 'hrn:app:example.com:digest', organizationId: 'o1', agentId: 'ag1',
    appType: 'AGENT', role: 'OWNER', description: null, agentTools: [], expiresAt: null,
    createUserPermission: 'DENY', identifyUserMethod: 'USER_ID', sessionTimeoutSeconds: 3600, anonymousTtlDays: 30,
    agent: { id: 'ag1', urn: LONG_AGENT_URN, name: 'One', description: null, installationPolicy: { memberRoles: [], maxMembers: 'unlimited' } },
    agents: [],
    availableMemberRoles: variant === 'roles' ? ['owner'] : [],
    surfaces: [], memberCount: 0, trainingMode: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
  };
  const props: ComponentProps<typeof AppMembersPanel> = {
    app, members: [], membersError: false, membersWithheld: false,
    addMemberForm: await superValidate(zod4(addAppMemberSchema), { errors: false }),
    ensureMemberForm: await superValidate(zod4(ensureAppMemberSchema), { errors: false, id: 'ensure-member' }),
    removeMemberForm: await superValidate(zod4(removeAppMemberSchema), { errors: false }),
    form: null,
  };
  const component = mount(AppMembersPanel, { target, props });
  // Both lines are in the add form, which opens from the round "+": the one Add member button outside a form.
  await tick();
  [...target.querySelectorAll('button')].find((b) => !b.form && b.textContent?.trim() === 'Add member')?.click();
  await tick();
  return () => unmount(component);
}
