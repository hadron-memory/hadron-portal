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

// portal#1417: the Agent behind the roles is named twice, and each time the name is an address
// someone copies into a CLI or a message, so each shows its URN under the name
// (hrn:node:hadronmemory.com:hadron-portal:review:render-urn).
describe('App members panel: the linked Agent shows its URN (portal#1417)', () => {
  const AGENT_URN = 'hrn:agent:acme.com:one';
  const chips = (scope: Element | null | undefined) => [...(scope?.querySelectorAll(`[title="${AGENT_URN}"]`) ?? [])];
  const paragraphWith = (target: HTMLElement, text: string) => [...target.querySelectorAll('p')].find((p) => p.textContent?.includes(text)) ?? null;

  it('the "defined by the linked Agent" line shows the Agent’s URN after its name', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner'] });
    const line = paragraphWith(target, 'Roles below are defined by the linked Agent');
    expect(line).not.toBeNull();
    expect(chips(line)).toHaveLength(1);
    // A long URN is clipped by its wrapper, not left to push the line past the panel.
    expect(chips(line)[0].closest('span.block')?.classList.contains('overflow-hidden')).toBe(true);
    const link = line!.querySelector('a[href="/app/agents/ag1"]')!;
    expect(link.textContent).toBe('One');
    // Below the name: the chip follows the link in document order.
    expect(link.compareDocumentPosition(chips(line)[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the empty-roles line shows the Agent’s URN after its name', async () => {
    const target = await mountPanel({ availableMemberRoles: [] });
    const line = paragraphWith(target, 'This App offers no member roles yet.');
    expect(line).not.toBeNull();
    expect(chips(line)).toHaveLength(1);
    // A long URN is clipped by its wrapper, not left to push the line past the panel.
    expect(chips(line)[0].closest('span.block')?.classList.contains('overflow-hidden')).toBe(true);
    const link = line!.querySelector('a[href="/app/agents/ag1"]')!;
    expect(link.textContent).toBe('One');
    expect(link.compareDocumentPosition(chips(line)[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('known-empty control: a non-empty union has no empty-roles line, so only the header chip is there', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner'] });
    expect(paragraphWith(target, 'This App offers no member roles yet.')).toBeNull();
    expect(chips(target)).toHaveLength(1);
  });
});

// portal#1417: a member can hold a role the Agent no longer offers (removing a role keeps it on
// the people who have it). These pin what the panel shows TODAY, not what it should show: if UX
// finds either wrong, that is a separate issue.
describe('App members panel: a member holding a role the Agent no longer offers (portal#1417)', () => {
  const legacyMember = { ...member, userId: 'u2', user: { ...member.user, id: 'u2', handle: 'grace', name: 'Grace' }, role: 'legacy' };

  it('no roles offered at all: the held role is shown as plain text, not hidden', async () => {
    const target = await mountPanel({ availableMemberRoles: [] }, [legacyMember]);
    expect(target.querySelector('select[data-user-id="u2"]')).toBeNull();
    expect([...target.querySelectorAll('span')].some((s) => s.textContent?.trim() === 'legacy')).toBe(true);
  });

  it('other roles offered: the held role is not an option, so the select shows the first offered role', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner', 'reviewer'] }, [legacyMember]);
    const select = target.querySelector<HTMLSelectElement>('select[data-user-id="u2"]')!;
    expect(optionValues(select)).toEqual(['owner', 'reviewer']);
    // Today's behaviour, worth a UX look: no option matches 'legacy', so the browser falls back to the first one.
    expect(select.value).toBe('owner');
    expect(target.textContent).not.toContain('legacy');
  });

  it('known-empty control: a member holding an offered role shows exactly that role selected', async () => {
    const target = await mountPanel({ availableMemberRoles: ['owner', 'reviewer'] }, [{ ...legacyMember, role: 'reviewer' }]);
    expect(target.querySelector<HTMLSelectElement>('select[data-user-id="u2"]')!.value).toBe('reviewer');
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
