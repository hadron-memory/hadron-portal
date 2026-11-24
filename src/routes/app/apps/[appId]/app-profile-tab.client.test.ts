/**
 * portal#2241 — the App page's Profile tab, mounted.
 *
 * Red-first acceptance (the issue's list): the tab list has Profile FIRST (absent on main); it renders
 * the App's own identity from the fields the page already holds; a missing description/expiry reads "—";
 * a withheld count is never a 0; it is read-only, with one "Edit in Settings" link only for a viewer
 * who may manage the App. The page's default tab stays Chats here: making Profile the default is the
 * gate's Proposed-pending-Holger item and is deliberately NOT built.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

const agent = { id: 'ag1', urn: 'hrn:agent:acme.com:scribe', name: 'Scribe', personaRole: 'writer' };

async function mountProfile(over: { app?: Record<string, unknown>; data?: Record<string, unknown>; tab?: string | null } = {}) {
  const tab = over.tab === undefined ? 'profile' : over.tab;
  const url = tab === null ? '/app/apps/a1' : `/app/apps/a1?tab=${tab}`;
  setStubPage(`https://example.test${url}`, { appId: 'a1' });
  window.history.replaceState({}, '', url);
  const base = await pageData();
  const data = {
    ...base,
    app: {
      ...base.app,
      organizationId: 'o1', description: 'Where the team works.', createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z', expiresAt: '2027-03-04T05:06:07.000Z', memberCount: 4,
      agentId: 'ag1', agent: { ...agent, installationPolicy: { memberRoles: [], maxMembers: 'unlimited' } },
      installedAgentUrn: 'hrn:agent:acme.com:team::scribe', agents: [agent, { ...agent, id: 'ag2', urn: 'hrn:agent:acme.com:critic', name: 'Critic' }],
      ...over.app,
    },
    org: { id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com' },
    initialTab: tab, canManageApp: true,
    ...over.data,
  };
  const props = reactiveProps<Record<string, unknown>>({ data, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

const panel = (target: HTMLElement) => target.querySelector<HTMLElement>('#panel-profile');
const tabLabels = (target: HTMLElement) => [...target.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim());

describe('App Profile tab (#2241)', () => {
  it('is the left-most tab', async () => {
    const labels = tabLabels(await mountProfile());
    expect(labels[0]).toBe('Profile');
    expect(labels).toContain('Chats');
  });

  it('shows the App\'s own identity from the fields the page already holds', async () => {
    const p = panel(await mountProfile())!;
    expect(p).not.toBeNull();
    const text = p.textContent ?? '';
    expect(text).toContain('Team');
    // The Urn chip splits the URN into segments; its title carries the whole value.
    const urns = [...p.querySelectorAll('[title]')].map((el) => el.getAttribute('title'));
    expect(urns).toContain('hrn:app:acme.com:team');
    expect(text).toContain('Where the team works.');
    // portal#2249: the Type row shows the label (the Settings option text), not the raw enum.
    expect(text).toContain('💻 Workstation');
    expect(text).toContain('Acme');
    expect(text).toContain('Scribe');
    // The Agent's own URN (the link target), not the install-chain URN, which is a different entity.
    expect(urns).toContain('hrn:agent:acme.com:scribe');
    // The owner organization shows its URN too, not just a linked name.
    expect(urns).toContain('hrn:org:acme.com');
    expect(p.querySelector('a[href="/app/orgs/o1"]')).not.toBeNull();
    expect(p.querySelector('a[href="/app/agents/ag1"]')).not.toBeNull();
    // member count 4, linked agents 2, each next to its label
    expect(p.querySelector('[data-testid="profile-member-count"]')?.textContent?.trim()).toBe('4');
    expect(p.querySelector('[data-testid="profile-agent-count"]')?.textContent?.trim()).toBe('2');
  });

  it('renders the absent owner organization as a dash with no URN chip', async () => {
    const p = panel(await mountProfile({ data: { org: null } }))!;
    expect(p.querySelector('a[href^="/app/orgs/"]')).toBeNull();
    const urns = [...p.querySelectorAll('[title]')].map((el) => el.getAttribute('title'));
    expect(urns).not.toContain('hrn:org:acme.com');
  });

  it('shows "—" for a missing description and expiry', async () => {
    const p = panel(await mountProfile({ app: { description: null, expiresAt: null } }))!;
    expect(p.querySelector('[data-testid="profile-description"]')?.textContent?.trim()).toBe('—');
    expect(p.querySelector('[data-testid="profile-expires"]')?.textContent?.trim()).toBe('—');
  });

  it('never renders a withheld count as 0', async () => {
    const p = panel(await mountProfile({ app: { memberCount: null, agents: null } }))!;
    expect(p.querySelector('[data-testid="profile-member-count"]')?.textContent?.trim()).toBe('—');
    expect(p.querySelector('[data-testid="profile-agent-count"]')?.textContent?.trim()).toBe('—');
  });

  it('is read-only: no form, input or action on the panel', async () => {
    const p = panel(await mountProfile())!;
    expect(p.querySelector('form, input, select, textarea, button[type="submit"]')).toBeNull();
  });

  it('offers "Edit in Settings" only when the viewer may manage the App', async () => {
    const manages = panel(await mountProfile({ data: { canManageApp: true } }))!;
    expect(manages.querySelector('[data-testid="profile-edit-in-settings"]')).not.toBeNull();
    while (mounted.length) mounted.pop()!.unmount();
    for (const canManageApp of [false, null]) {
      const p = panel(await mountProfile({ data: { canManageApp } }))!;
      expect(p.querySelector('[data-testid="profile-edit-in-settings"]')).toBeNull();
      while (mounted.length) mounted.pop()!.unmount();
    }
  });

  it('is the default tab: no ?tab= opens Profile, not Chats (Holger, 2026-11-23)', async () => {
    const target = await mountProfile({ tab: null, data: { initialTab: null } });
    expect(target.querySelector('#tab-profile')?.getAttribute('aria-selected')).toBe('true');
    expect(target.querySelector('#tab-chats')?.getAttribute('aria-selected')).toBe('false');
    expect(panel(target)).not.toBeNull();
  });
});
