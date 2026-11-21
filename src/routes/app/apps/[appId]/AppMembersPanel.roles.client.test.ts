/**
 * portal#1405 (hadron-server#2171, R211, hrn:node:hadronmemory.com:specs:cor:dmo:050:04): the App members panel
 * offers the roles the SERVER computed for the App, `App.availableMemberRoles`
 * (the union over every installed Agent, primary first), not the deprecated
 * single `app.agent`'s installation policy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
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
    // A distinct id: add and ensure share a field shape, so the generated ids collide and a result lands on the wrong form.
    ensureMemberForm: await superValidate(zod4(ensureAppMemberSchema), { errors: false, id: 'ensure-member' }),
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

describe('App members panel: action result is announced in a persistent live region (portal#2375)', () => {
  const resultFor = async (schema: typeof ensureAppMemberSchema | typeof removeAppMemberSchema, text: string, id?: string) => {
    const f = await superValidate(zod4(schema as never), { errors: false, id });
    f.message = { type: 'success', text };
    return f;
  };

  it('ensure: the empty status region that was there before holds the success text', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner', 'reviewer'] }, [member]);
    const idle = idleStatusRegions(target);
    expect(idle.length).toBeGreaterThan(0);
    const ensure = target.querySelector<HTMLFormElement>('form[action="?/ensureMember"]')!;
    ensure.addEventListener('submit', (e) => e.preventDefault());
    const select = ensure.querySelector('select')!;
    select.value = 'reviewer';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    await submitEnhancedWithResult(ensure, {
      type: 'success', status: 200, data: { form: await resultFor(ensureAppMemberSchema, 'Role changed.', 'ensure-member') },
    });
    await tick(3);
    const region = announcedStatusRegion(target);
    expect(region?.textContent).toContain('Role changed.');
    expect(idle).toContain(region);
  });

  it('remove: the empty status region that was there before holds the success text', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner'] }, [member]);
    const idle = idleStatusRegions(target);
    expect(idle.length).toBeGreaterThan(0);
    const remove = target.querySelector<HTMLFormElement>('form[action="?/removeMember"]')!;
    remove.addEventListener('submit', (e) => e.preventDefault());
    remove.querySelector('button')!.click();
    await tick(2);
    await submitEnhancedWithResult(remove, {
      type: 'success', status: 200, data: { form: await resultFor(removeAppMemberSchema, 'Member removed.') },
    });
    await tick(3);
    const region = announcedStatusRegion(target);
    expect(region?.textContent).toContain('Member removed.');
    expect(idle).toContain(region);
  });
});
