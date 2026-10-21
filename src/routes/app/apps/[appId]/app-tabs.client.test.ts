/**
 * #1004 / #1005 / #1006 — the App page's team tabs, mounted.
 *
 * Red-first acceptance lines (Cooper, on the issues):
 *  - #1004: the Settings caption read "Agent" and linked to app members; after,
 *    it reads "Agents" and the link is gone.
 *  - #1005: no "Human team" tab existed (members sat behind that link); after,
 *    the tab hosts the members content and "Worker agents" is renamed "AI Team".
 *  - #1006: no "Agents" tab existed (agent content sat in Settings); after, an
 *    Agents tab holds it in a TanStack table with an add-agent path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import Page from './+page.svelte';
import {
  addAgentSchema, addAppMemberSchema, appSettingsSchema, castWorkerSchema, createAppKeySchema,
  deleteAppSchema, ensureAppMemberSchema, releaseWorkerSchema, removeAppAgentSchema,
  removeAppMemberSchema, retireWorkerSchema, revokeAppKeySchema, updateAppAgentToolsSchema,
} from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

const forms = (schemas: Parameters<typeof zod4>[0][]) =>
  Promise.all(schemas.map((schema) => superValidate(zod4(schema), { errors: false })));

const reader = { id: 'u2', handle: 'rae', githubUsername: 'rae', name: 'Rae Reader', avatarUrl: null, email: null };
const agentOne = { id: 'ag1', urn: 'hrn:agent:acme.com:scribe', name: 'Scribe', personaRole: 'writer' };
const agentTwo = { id: 'ag2', urn: 'hrn:agent:acme.com:critic', name: 'Critic', personaRole: 'reviewer' };

async function mountTab(tab: string, over: { app?: Record<string, unknown>; data?: Record<string, unknown> } = {}) {
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1?tab=${tab}`);
  const [appSettingsForm, addAgentForm, createKeyForm, removeAgentForm, updateAgentToolsForm,
    revokeKeyForm, deleteAppForm, castWorkerForm, retireWorkerForm, releaseWorkerForm,
    postTeamChatMessageForm, addMemberForm, ensureMemberForm, removeMemberForm] = await forms([
    appSettingsSchema, addAgentSchema, createAppKeySchema, removeAppAgentSchema,
    updateAppAgentToolsSchema, revokeAppKeySchema, deleteAppSchema, castWorkerSchema,
    retireWorkerSchema, releaseWorkerSchema, postTeamChatMessageSchema,
    addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema,
  ] as never);
  const data = {
    app: {
      id: 'a1', urn: 'hrn:app:acme.com:team', name: 'Team', appType: 'WORKSTATION', role: 'OWNER',
      surfaces: [], agentId: 'ag1', agent: { ...agentOne, installationPolicy: { memberRoles: ['reader'], maxMembers: 'unlimited' } },
      agents: [agentOne, agentTwo], memberCount: 1,
      createUserPermission: 'DENY', identifyUserMethod: 'USER_ID', sessionTimeoutSeconds: 3600, anonymousTtlDays: 14,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...over.app,
    },
    org: null, availableAgents: [agentOne, { id: 'ag3', urn: 'hrn:agent:acme.com:extra', name: 'Extra' }],
    staff: [], staffError: false, members: [{ appId: 'a1', userId: 'u2', role: 'reader', user: reader }],
    teamChatMessages: [], teamChatTotal: 0, teamChatError: false,
    appChats: [{ key: 'chats:team', label: 'Team chat' }], chatsError: false,
    selectedChatKey: 'chats:team', initialTab: tab, initialChatFullView: false,
    chatConfigs: [], appConfigs: [], worklog: [], worklogTotal: 0, worklogError: false,
    currentUserId: 'u1', user: { id: 'u1' },
    appSettingsForm, addAgentForm, createKeyForm, removeAgentForm, updateAgentToolsForm,
    revokeKeyForm, deleteAppForm, castWorkerForm, retireWorkerForm, releaseWorkerForm,
    postTeamChatMessageForm, addMemberForm, ensureMemberForm, removeMemberForm,
    ...over.data,
  };
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

const tabLabels = (target: HTMLElement) =>
  [...target.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim());

describe('App page tab strip (#1005, #1006)', () => {
  it('names the worker tab "AI Team" and adds "Human Team" and "Agents"', async () => {
    const labels = tabLabels(await mountTab('chats'));
    expect(labels).toContain('AI Team');
    expect(labels).toContain('Human Team');
    expect(labels).toContain('Agents');
    expect(labels).not.toContain('Worker agents');
  });

  it('keeps the `staff` id behind the renamed worker tab: a label is not an address', async () => {
    const target = await mountTab('chats');
    expect(target.querySelector('#tab-staff')?.textContent?.trim()).toBe('AI Team');
    expect(target.querySelector('#tab-members')?.textContent?.trim()).toBe('Human Team');
    expect(target.querySelector('#tab-agents')?.textContent?.trim()).toBe('Agents');
  });

  // #1052: Tasks is a sub-route like Runs and Channels: a link styled as a
  // tab, not an in-page panel, so a task read's refusal never reaches this page.
  it('links to the Tasks sub-route', async () => {
    const target = await mountTab('chats');
    const link = [...target.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.trim() === 'Tasks');
    expect(link?.getAttribute('href')).toBe('/app/apps/a1/tasks');
    expect(tabLabels(target)).not.toContain('Tasks');
  });

  // portal#1099: Tickers likewise, since a ticker read answers a non-participant APP_NOT_FOUND.
  it('links to the Tickers sub-route', async () => {
    const target = await mountTab('chats');
    const link = [...target.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.trim() === 'Tickers');
    expect(link?.getAttribute('href')).toBe('/app/apps/a1/tickers');
    expect(tabLabels(target)).not.toContain('Tickers');
  });
});

describe('Settings no longer carries the agent section (#1004, #1006)', () => {
  it('has no "Agent" caption and no link to /members', async () => {
    const target = await mountTab('settings');
    const headings = [...target.querySelectorAll('h2')].map((h) => h.textContent?.trim());
    expect(headings).not.toContain('Agent');
    expect(target.querySelector('a[href$="/members"]')).toBeNull();
    // Absence by behavior, not caption: a renamed section would still post these.
    expect(target.querySelector('form[action="?/addAgent"], form[action="?/removeAgent"]')).toBeNull();
  });
});

describe('Human Team tab (#1005)', () => {
  it('lists the members and posts to this page’s own actions, not the old route', async () => {
    const target = await mountTab('members');
    const panel = target.querySelector('#panel-members')!;
    expect(panel.textContent).toContain('Rae Reader');
    expect(panel.querySelector('a[href$="/members"]')).toBeNull();
    const actions = [...panel.querySelectorAll('form')].map((f) => f.getAttribute('action'));
    expect(actions).toEqual(expect.arrayContaining(['?/ensureMember', '?/removeMember', '?/addMember']));
  });

  it('renders no second h1: the page heading is the only one', async () => {
    const target = await mountTab('members');
    expect(target.querySelectorAll('h1')).toHaveLength(1);
  });
});

describe('Agents tab (#1006)', () => {
  it('lists every installed agent in a table with its URN, not only the first', async () => {
    const target = await mountTab('agents');
    const panel = target.querySelector('#panel-agents')!;
    expect(panel.querySelector('table')).not.toBeNull();
    const text = panel.textContent!.replace(/\s+/g, '');
    expect(text).toContain('hrn:agent:acme.com:scribe');
    expect(text).toContain('hrn:agent:acme.com:critic');
  });

  it('offers to add an agent that is not installed yet, even with agents installed', async () => {
    const target = await mountTab('agents');
    const form = target.querySelector<HTMLFormElement>('#panel-agents form[action="?/addAgent"]')!;
    expect(form).not.toBeNull();
    const options = [...form.querySelectorAll('option')].map((o) => o.textContent);
    expect(options.some((o) => o?.includes('Extra'))).toBe(true);
    expect(options.some((o) => o?.includes('Scribe'))).toBe(false);
  });

  // portal#1188: a failed subscribed-agents read leaves the owned options and
  // says the subscribed ones are missing; it must not look like a complete list.
  it('says the subscribed agents are missing when only their read failed (#1172)', async () => {
    const target = await mountTab('agents', { data: { subscribedAgentsError: true } });
    const panel = target.querySelector('#panel-agents')!;
    expect(panel.textContent).toContain('subscribes to could not be loaded');
    expect(panel.querySelector('form[action="?/addAgent"]')).not.toBeNull();
  });

  // portal#1188 READ (George, P2 residual): the warning must not depend on there
  // being something to pick, or "no other agent to add" reads as a complete list.
  it('still says the subscribed agents are missing when there is no owned agent to offer (#1172)', async () => {
    const target = await mountTab('agents', { data: { subscribedAgentsError: true, availableAgents: [] } });
    expect(target.querySelector('#panel-agents')!.textContent).toContain('subscribes to could not be loaded');
  });

  it('still says it when every owned agent is already installed (#1172)', async () => {
    const target = await mountTab('agents', { data: { subscribedAgentsError: true, availableAgents: [agentOne, agentTwo] } });
    expect(target.querySelector('#panel-agents')!.textContent).toContain('subscribes to could not be loaded');
  });

  it('control: an empty list after a SUCCESSFUL grants read carries no such warning (#1172)', async () => {
    const target = await mountTab('agents', { data: { subscribedAgentsError: false, availableAgents: [] } });
    expect(target.querySelector('#panel-agents')!.textContent).not.toContain('subscribes to could not be loaded');
  });

  it('says nothing about subscribed agents when their read worked (#1172)', async () => {
    const target = await mountTab('agents');
    expect(target.querySelector('#panel-agents')!.textContent).not.toContain('subscribes to could not be loaded');
  });

  it('keeps the canonical install URN, on the primary agent’s row only (P2 from step 5)', async () => {
    const urn = 'hrn:agent:acme.com:team:scribe';
    const target = await mountTab('agents', { app: { installedAgentUrn: urn } });
    const shown = [...target.querySelectorAll('#panel-agents [data-testid="install-urn"]')];
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent!.replace(/\s+/g, '')).toContain(urn);
    expect(shown[0].closest('tr')!.textContent).toContain('Scribe');
  });

  it('shows no install URN when the server did not derive one', async () => {
    const target = await mountTab('agents', { app: { installedAgentUrn: null } });
    expect(target.querySelector('#panel-agents [data-testid="install-urn"]')).toBeNull();
  });

  it('unlinks the agent of THAT row', async () => {
    const target = await mountTab('agents');
    const forms = [...target.querySelectorAll<HTMLFormElement>('#panel-agents form[action="?/removeAgent"]')];
    expect(forms.map((f) => f.querySelector<HTMLInputElement>('input[name="agentId"]')!.value).sort()).toEqual(['ag1', 'ag2']);
  });
});

// #1043 interim: the primary agent link does not establish the App/viewer's
// rights on other agents' memories. Do not label them by omission.
it('App memory filters do not infer read-only access from the primary agent', async () => {
  const memory = (id: string, name: string) => ({ id, name, urn: `hrn:mem:acme.com:${id}` });
  const target = await mountTab('memory', {
    app: { agent: { ...agentOne, memoryItems: [{ id: 'item1', role: 'read-write', memory: memory('roles', 'Roles') }] } },
    data: { appNodes: ['roles', 'notes'].map((id) => ({ id: `node-${id}`, memoryId: id, memory: memory(id, id === 'roles' ? 'Roles' : 'Eng Notes'), nodeType: 'info', loc: id, name: id, tags: [], outgoingEdges: [], incomingEdges: [] })) },
  });
  const memories = [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim().startsWith('Memories'));
  expect(memories).toBeDefined();
  memories!.click();
  await tick(2);
  expect(target.textContent).toContain('Eng Notes');
  expect(target.textContent).not.toContain('(read-only)');
});

// portal#1226: a window that came back full is labeled where the reader sees it.
describe('full-window cues on the App page (#1226)', () => {
  it('the Memory tab says the first N nodes are shown when the window was full', async () => {
    const target = await mountTab('memory', { data: { appNodes: [], appNodesCapped: true } });
    expect(target.textContent).toContain('Showing the first 0 nodes');
    expect((await mountTab('memory', { data: { appNodes: [], appNodesCapped: false } })).textContent).not.toContain('Showing the first');
  });

  it('the Chats selector says more chats exist when the root window was full', async () => {
    const target = await mountTab('chats', { data: { chatsCapped: true, chatRootsShown: 200 } });
    expect(target.textContent).toContain('Showing the first 200 chats');
  });

  it('and says nothing when the chat list was complete', async () => {
    expect((await mountTab('chats', { data: { chatsCapped: false } })).textContent).not.toContain('Showing the first');
  });
});
