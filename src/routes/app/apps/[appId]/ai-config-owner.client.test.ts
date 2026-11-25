/**
 * portal#2567: the owner of a person's App is shown the AI-config controls; the server's gate
 * (hrn:node:hadronmemory.com:specs:cor:dmo:050:10, and :12 beside it) is the authority, and this only stops the portal hiding what it permits and
 * showing what it refuses. A person's App has no organization, so nothing here supplies one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { AGENT_CHAT_KEY } from '$lib/app-chats';
import { resetAiConfigRecoveryForTests } from '$lib/components/ai-config-recovery';
import { pageData } from './app-page.fixture';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetAiConfigRecoveryForTests(); resetNavigationCalls(); resetNavigationGuards(); vi.unstubAllGlobals();
});

const OWNER_ONLY = 'Only the owner of this App can manage its AI service configurations.';
const ADMIN_ONLY = 'Only organization admins can manage AI service configurations.';

async function mountAi(over: Record<string, unknown>, appOver: Record<string, unknown> = {}) {
  setStubPage('https://example.test/app/apps/a1?tab=ai-configs', { appId: 'a1' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ endpoints: [] }), { headers: { 'Content-Type': 'application/json' } })));
  const data = await pageData();
  const m = mountComponent(Page as never, {
    data: { ...data, initialTab: 'ai-configs', org: null, app: { ...data.app, organizationId: null, ...appOver }, ...over }, form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target.querySelector<HTMLElement>('#section-ai-configs-body')!;
}
const hasAdd = (p: HTMLElement) => [...p.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Add configuration');

describe('a person\'s App, AI tab', () => {
  it('its owner (the server says they manage it) sees the add control, not the admins-only line', async () => {
    const p = await mountAi({ canManageApp: true });
    expect(hasAdd(p)).toBe(true);
    expect(p.textContent).not.toContain(ADMIN_ONLY);
  });
  it.each([[false, 'a viewer the server says cannot manage it'], [null, 'an unknown flag']] as const)('%s (%s) is read-only and says only the owner can', async (flag, _why) => {
    const p = await mountAi({ canManageApp: flag });
    expect(hasAdd(p)).toBe(false);
    expect(p.textContent).toContain(OWNER_ONLY);
    expect(p.textContent).not.toContain('organization');
  });
  it.each(['ADMIN', 'OWNER'])('a platform %s is read-only even when the flag says manage: they may only clear a key (cor:dmo:050:12)', async (role) => {
    const p = await mountAi({ canManageApp: true, user: { roles: [role] } });
    expect(hasAdd(p)).toBe(false);
    expect(p.textContent).toContain(OWNER_ONLY);
  });
  it('an impersonated session is read-only even for the owner', async () => {
    const p = await mountAi({ canManageApp: true, impersonation: { sessionId: 's', actorUserId: 'admin', orgId: 'o', expiresAt: Date.now() + 60_000 } });
    expect(hasAdd(p)).toBe(false);
    expect(p.textContent).toContain(OWNER_ONLY);
  });
});

describe('an organization\'s App, AI tab (unchanged)', () => {
  // portal#1718: the org is the breadcrumb's three fields; the viewer's role rides the `orgMembers` read.
  const org = (role: string) => ({ org: { id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com' }, orgMembers: [{ user: { id: 'u1' }, role }] });
  it('an org ADMIN sees the controls whatever the manage flag says', async () => {
    const p = await mountAi({ ...org('ADMIN'), canManageApp: null }, { organizationId: 'o1' });
    expect(hasAdd(p)).toBe(true);
  });
  it('an org ADMIN while impersonating keeps today\'s org rule (the server refuses the writes, cor:acl:100:02)', async () => {
    const p = await mountAi({ ...org('ADMIN'), canManageApp: null, impersonation: { sessionId: 's', actorUserId: 'admin', orgId: 'o1', expiresAt: Date.now() + 60_000 } }, { organizationId: 'o1' });
    expect(hasAdd(p)).toBe(true);
  });
  it('an org member below ADMIN keeps the admin line, even when the flag says manage', async () => {
    const p = await mountAi({ ...org('CONTRIBUTOR'), canManageApp: true }, { organizationId: 'o1' });
    expect(hasAdd(p)).toBe(false);
    expect(p.textContent).toContain(ADMIN_ONLY);
  });
});

describe('Chats tab, no LLM config', () => {
  async function mountChats(appOver: Record<string, unknown>, over: Record<string, unknown> = {}) {
    setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
    const data = await pageData();
    const m = mountComponent(Page as never, {
      data: { ...data, app: { ...data.app, surfaces: ['chat'], agentId: 'ag1', agent: { id: 'ag1', name: 'Bot' }, ...appOver }, chatConfigs: [], selectedChatKey: AGENT_CHAT_KEY, ...over },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);
    return m;
  }
  it('on a person\'s App the text does not name an organization, and the button leads to the AI tab', async () => {
    const m = await mountChats({ organizationId: null });
    expect(m.target.textContent).toContain('Connect an LLM provider to enable agent chat');
    expect(m.target.textContent).toContain('Add one for this App or its agent.');
    // The description paragraph itself, not the whole page: only a person's App drops the organization.
    const description = [...m.target.querySelectorAll('p')].find((el) => el.textContent?.includes('chatbot agent linked'))!;
    expect(description.textContent).not.toContain('organization');
    const cta = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.includes('Configure AI Service Configs'))!;
    cta.click();
    await tick(2);
    expect(m.target.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('tab-settings');
    expect(m.target.querySelector('#section-ai-configs-toggle')!.getAttribute('aria-expanded')).toBe('true');
  });
  it('on an organization\'s App the text still names the organization', async () => {
    const m = await mountChats({ organizationId: 'o1' });
    expect(m.target.textContent).toContain('Add one for this App, its agent, or the organization.');
  });
});
