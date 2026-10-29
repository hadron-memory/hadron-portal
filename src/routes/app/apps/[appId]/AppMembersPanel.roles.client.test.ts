/**
 * portal#1405 (hadron-server#2171, R211, cor:dmo:050:04): the App members panel
 * offers the roles the SERVER computed for the App, `App.availableMemberRoles`
 * (the union over every installed Agent, primary first), not the deprecated
 * single `app.agent`'s installation policy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import AppMembersPanel from './AppMembersPanel.svelte';
import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const member = {
  appId: 'a1', userId: 'u1', role: 'owner',
  user: { id: 'u1', handle: 'ada', githubUsername: 'ada', name: 'Ada', avatarUrl: null, email: null },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: null,
};

async function mountPanel(appOver: Record<string, unknown>, members: unknown[] = []) {
  const app = {
    id: 'a1', name: 'Digest', urn: 'hrn:app:acme.com:digest', organizationId: 'o1',
    agentId: 'ag1',
    // The deprecated single Agent still offers ONLY `legacy`: a panel that reads it fails the pins below.
    agent: { id: 'ag1', urn: 'hrn:agent:acme.com:one', name: 'One', installationPolicy: { memberRoles: ['legacy'], maxMembers: 'unlimited' } },
    agents: [], ...appOver,
  };
  const m = mountComponent(AppMembersPanel as never, reactiveProps({
    app, members, membersError: false, membersWithheld: false,
    addMemberForm: await superValidate(zod4(addAppMemberSchema), { errors: false }),
    ensureMemberForm: await superValidate(zod4(ensureAppMemberSchema), { errors: false }),
    removeMemberForm: await superValidate(zod4(removeAppMemberSchema), { errors: false }),
    form: null,
  }) as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

const optionValues = (select: Element | null) => [...(select?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));

describe('App members panel: roles come from App.availableMemberRoles (portal#1405)', () => {
  it('the add form offers the union in server order, not the single Agent’s policy', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner', 'member', 'reviewer'] });
    // The leading '' is the disabled "Select a role..." placeholder.
    expect(optionValues(target.querySelector('#member-role'))).toEqual(['', 'owner', 'member', 'reviewer']);
  });

  it('a sibling Agent’s role is offered although the primary Agent’s policy lacks it', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner', 'sibling-only'] });
    expect(optionValues(target.querySelector('#member-role'))).toContain('sibling-only');
    expect(optionValues(target.querySelector('#member-role'))).not.toContain('legacy');
  });

  it('an existing member’s role select offers the union too', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner', 'reviewer'] }, [member]);
    expect(optionValues(target.querySelector('select[data-user-id="u1"]'))).toEqual(['owner', 'reviewer']);
  });

  it('an empty union says so in plain words and disables Add', async () => {
    const target = await mountPanel({ availableMemberRoles: [] });
    expect(target.textContent).toContain('This App offers no member roles yet.');
    const add = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add member');
    expect(add).toBeDefined();
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });

  it('known-empty control: a non-empty union shows no empty-roles message', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner'] });
    expect(target.textContent).not.toContain('This App offers no member roles yet.');
  });

  it('maxMembers keeps its existing read from app.agent (R211 changes roles, not capacity)', async () => {
    const target = await mountPanel({
      availableMemberRoles: ['owner'],
      agent: { id: 'ag1', urn: 'hrn:agent:acme.com:one', name: 'One', installationPolicy: { memberRoles: ['legacy'], maxMembers: '3' } },
    });
    expect(target.textContent).toContain('/ 3)');
  });
});
