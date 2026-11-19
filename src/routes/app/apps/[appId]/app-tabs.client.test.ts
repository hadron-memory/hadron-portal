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
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { captureUnhandledRejections, mountComponent, tick, wait, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationHooks, resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import Page from './+page.svelte';
import { everyTabRead } from './app-page.fixture';
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

/** The last mount's props, reactive, so a test can replay a navigation that reuses the page. */
let lastProps: Record<string, unknown> = {};

async function mountTab(tab: string, over: { app?: Record<string, unknown>; data?: Record<string, unknown>; form?: unknown; url?: string } = {}) {
  setStubPage(over.url ?? `https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
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
    // portal#2240: every tab already read, as before the first-screen load.
    ...everyTabRead(),
    app: {
      id: 'a1', urn: 'hrn:app:acme.com:team', name: 'Team', appType: 'WORKSTATION', role: 'OWNER',
      surfaces: [], agentId: 'ag1', availableMemberRoles: ['reader'], agent: { ...agentOne, installationPolicy: { memberRoles: ['reader'], maxMembers: 'unlimited' } },
      agents: [agentOne, agentTwo], memberCount: 1,
      createUserPermission: 'DENY', identifyUserMethod: 'USER_ID', sessionTimeoutSeconds: 3600, anonymousTtlDays: 14,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...over.app,
    },
    org: null, availableAgents: [agentOne, { id: 'ag3', urn: 'hrn:agent:acme.com:extra', name: 'Extra' }],
    staff: [], staffError: false, members: [{ appId: 'a1', userId: 'u2', role: 'reader', user: reader }],
    teamChatMessages: [], teamChatTotal: 0, teamChatError: false, teamFilter: { kind: 'none' }, teamFilterInvalid: false, teamChatRefusal: null,
    appChats: [{ key: 'chats:team', label: 'Team chat' }], chatsError: false,
    selectedChatKey: 'chats:team', initialTab: tab, initialChatFullView: false,
    chatConfigs: [], appConfigs: [], worklog: [], worklogTotal: 0, worklogError: false,
    currentUserId: 'u1', user: { id: 'u1' }, bootPointerAppKey: 'a1',
    appSettingsForm, addAgentForm, createKeyForm, removeAgentForm, updateAgentToolsForm,
    revokeKeyForm, deleteAppForm, castWorkerForm, retireWorkerForm, releaseWorkerForm,
    postTeamChatMessageForm, addMemberForm, ensureMemberForm, removeMemberForm,
    ...over.data,
  };
  lastProps = reactiveProps<Record<string, unknown>>({ data, form: over.form ?? null });
  const m = mountComponent(Page as never, lastProps as never) as Mounted<Record<string, unknown>>;
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

  it('mounts Runs as a real App tab with its own panel', async () => {
    const target = await mountTab('runs');
    const tab = target.querySelector('#tab-runs');
    expect(tab?.getAttribute('role')).toBe('tab');
    expect(tab?.getAttribute('aria-selected')).toBe('true');
    expect(target.querySelector('#panel-runs')?.getAttribute('role')).toBe('tabpanel');
    expect(target.querySelector('a[href="/app/apps/a1/runs"]')).toBeNull();
  });

  it('keeps the `staff` id behind the renamed worker tab: a label is not an address', async () => {
    const target = await mountTab('chats');
    expect(target.querySelector('#tab-staff')?.textContent?.trim()).toBe('AI Team');
    expect(target.querySelector('#tab-members')?.textContent?.trim()).toBe('Human Team');
    expect(target.querySelector('#tab-agents')?.textContent?.trim()).toBe('Agents');
  });

  // #1052: Tasks is a sub-route like Channels: a link styled as a
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
    // #1020: Unlink sits in each row's ⋯ menu; ONE hidden form below the
    // table is the submit target, filled for whichever row was picked.
    const hidden = [...target.querySelectorAll<HTMLFormElement>('#panel-agents form[action="?/removeAgent"]')];
    expect(hidden).toHaveLength(1);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    // Critic's row (ag2), not Scribe's (ag1).
    target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Critic"]')!.click();
    flushSync();
    [...target.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((i) => i.textContent?.trim() === 'Unlink')!.click();
    await tick(2);
    expect(requestSubmit.mock.contexts[0]).toBe(hidden[0]);
    expect(hidden[0].querySelector<HTMLInputElement>('input[name="agentId"]')!.value).toBe('ag2');
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

// portal#1881: the formerly capped lists expose user-initiated pages instead.
describe('paged node lists on the App page (#1881)', () => {
  it('the Memory tab links to the next node page without a capped notice', async () => {
    const target = await mountTab('memory', { data: { appNodes: [], appNodesPage: { offset: 0, count: 20, total: 45, previousHref: null, nextHref: '/app/apps/a1?tab=memory&appNodesOffset=20' } } });
    expect(target.textContent).not.toContain('Showing the first');
    expect(target.querySelector<HTMLAnchorElement>('nav[aria-label="Memory node pages"] a[rel="next"]')?.getAttribute('href')).toBe('/app/apps/a1?tab=memory&appNodesOffset=20');
  });

  it('the Chats selector links to more roots without a capped notice', async () => {
    const target = await mountTab('chats', { data: { chatRootsPage: { offset: 0, count: 20, total: 25, previousHref: null, nextHref: '/app/apps/a1?tab=chats&chatRootsOffset=20' } } });
    expect(target.textContent).not.toContain('Showing the first');
    expect(target.textContent).toContain('Registered Channels stay available on every page. Pagination covers legacy chat roots only.');
    expect(target.querySelector<HTMLAnchorElement>('nav[aria-label="Legacy chat-root pages"] a[rel="next"]')?.getAttribute('href')).toBe('/app/apps/a1?tab=chats&chatRootsOffset=20');
  });

  it('a registered-Channel failure does not hide a successful legacy-root pager', async () => {
    const target = await mountTab('chats', { data: {
      chatsError: true, channelsError: true, chatRootsError: false,
      chatRootsPage: { offset: 0, count: 20, total: 25, previousHref: null, nextHref: '/app/apps/a1?tab=chats&chatRootsOffset=20' },
    } });
    expect(target.textContent).toContain('Could not load this App’s chat list');
    expect(target.querySelector<HTMLAnchorElement>('nav[aria-label="Legacy chat-root pages"] a[rel="next"]')?.getAttribute('href')).toContain('chatRootsOffset=20');
  });

  it('a legacy-root failure hides its unavailable pager', async () => {
    const target = await mountTab('chats', { data: {
      chatsError: true, chatRootsError: true,
      chatRootsPage: { offset: 0, count: 0, total: 0, previousHref: null, nextHref: null },
    } });
    expect(target.querySelector('nav[aria-label="Legacy chat-root pages"]')).toBeNull();
  });

  it('chat composers retain a later chat-root page across native and enhanced posts', async () => {
    const target = await mountTab('chats', { data: { chatRootsPage: { offset: 20, count: 5, total: 25, previousHref: '/app/apps/a1?tab=chats', nextHref: null } } });
    expect(target.querySelector('form[action*="postTeamChatMessage"]')?.getAttribute('action')).toContain('chatRootsOffset=20');
  });

  // #1929 BLIND P2: after a failed native post the URL already names that
  // action. Switching composer must not send BOTH action names — SvelteKit
  // could dispatch the stale one.
  it('a composer action replaces, never accumulates, a named action left in the URL', async () => {
    const target = await mountTab('chats', {
      url: 'https://example.test/app/apps/a1?tab=chats&chat=chats%3Aother&chatRootsOffset=20&/postChannelMessage',
      data: { chatRootsPage: { offset: 20, count: 5, total: 25, previousHref: '/app/apps/a1?tab=chats', nextHref: null } },
    });
    const action = target.querySelector('form[action*="postTeamChatMessage"]')!.getAttribute('action')!;
    const query = new URLSearchParams(action.slice(1));
    expect([...query.keys()].filter((k) => k.startsWith('/'))).toEqual(['/postTeamChatMessage']);
    expect(query.get('chatRootsOffset')).toBe('20');
  });

  it('a one-page list has no continuation', async () => {
    const target = await mountTab('chats', { data: { chatRootsPage: { offset: 0, count: 3, total: 3, previousHref: null, nextHref: null } } });
    expect(target.querySelector('nav[aria-label="Legacy chat-root pages"] a')).toBeNull();
  });
});

// portal#1142 S8 (hadron-server#2219; Xylon's stamp 6330444824): each install's
// boot-prompt pointer, joined by agent id, with a per-row panel.
describe('Agents tab: boot-prompt pointers (portal#1142 S8)', () => {
  const URN = 'hrn:node:acme.com:team-install:boot';
  const bootPointers = { ok: true, byAgent: { ag1: { ref: URN, deleted: false } } };
  const rows = (target: HTMLElement) => [...target.querySelectorAll<HTMLTableRowElement>('#panel-agents tbody tr')];
  const rowOf = (target: HTMLElement, name: string) => rows(target).find((r) => r.textContent?.includes(name))!;
  // #1020: Set boot prompt sits in the row's ⋯ menu, next to Unlink.
  const menuItems = (target: HTMLElement, name: string) => {
    rowOf(target, name).querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click();
    flushSync();
    return [...target.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };
  const openFor = async (target: HTMLElement, name: string) => {
    menuItems(target, name).find((i) => i.textContent?.trim() === 'Set boot prompt…')!.click();
    await tick(2);
  };

  it('each row shows its own pointer, and a row with no entry is "Not shown", never another row’s', async () => {
    const target = await mountTab('agents', { data: { bootPointers, canManageApp: true } });
    expect(rowOf(target, 'Scribe').querySelector(`[title="${URN}"]`)).not.toBeNull();
    expect(rowOf(target, 'Critic').textContent).toContain('Not shown');
    expect(rowOf(target, 'Critic').querySelector(`[title="${URN}"]`)).toBeNull();
  });

  it('a failed read marks every row as unavailable', async () => {
    const target = await mountTab('agents', { data: { bootPointers: { ok: false }, canManageApp: true } });
    expect(rowOf(target, 'Scribe').textContent).toContain('Couldn’t load the pointer.');
    expect(rowOf(target, 'Critic').textContent).toContain('Couldn’t load the pointer.');
  });

  it('the panel opens for that row, posts that row’s agentRef, and carries the tab', async () => {
    const target = await mountTab('agents', { data: { bootPointers, canManageApp: null } });
    await openFor(target, 'Critic');
    const panel = target.querySelector('#app-agent-pointer-panel')!;
    expect(panel.textContent).toContain('Boot prompt for Critic in this App');
    expect(panel.querySelector<HTMLInputElement>('input[name="agentRef"]')!.value).toBe('ag2');
    expect(panel.querySelector('form')!.getAttribute('action')).toBe('?tab=agents&/setAppAgentBootPrompt');
    expect(panel.textContent).toContain('Agents start with the newest approved revision of the compiled prompt named by the highest set pointer: the worker’s, else the App’s, else the Agent’s.');
  });

  it('a result for one row never shows on another, and a refused draft stays on its own row', async () => {
    const form = { pointer: { key: 'a1\u0000ag1', nodeRef: 'draft-for-scribe', refusal: { code: 'FORBIDDEN', lead: 'Only this App’s manager can change this pointer.', message: 'No.' } } };
    const target = await mountTab('agents', { data: { bootPointers, canManageApp: true }, form });
    // No-JS reload: the panel reopens on the row the result belongs to.
    let panel = target.querySelector('#app-agent-pointer-panel')!;
    expect(panel.textContent).toContain('Scribe');
    expect(panel.querySelector('[data-testid="boot-pointer-refusal"]')).not.toBeNull();
    expect(panel.querySelector<HTMLInputElement>('input[name="nodeRef"]')!.value).toBe('draft-for-scribe');
    await openFor(target, 'Critic');
    panel = target.querySelector('#app-agent-pointer-panel')!;
    expect(panel.textContent).toContain('Critic');
    expect(panel.querySelector('[data-testid="boot-pointer-refusal"]')).toBeNull();
    expect(panel.querySelector<HTMLInputElement>('input[name="nodeRef"]')!.value).toBe('');
  });

  // George's P2 on #1246: the page is reused across /apps/A → B, and an agent
  // installed in both must not carry A's open panel or draft into B.
  it('navigating to another App closes the panel and drops a draft typed on the first, even for the same agent', async () => {
    const target = await mountTab('agents', { data: { bootPointers, canManageApp: true } });
    await openFor(target, 'Scribe');
    const field = () => target.querySelector<HTMLInputElement>('#app-agent-pointer-node-ref');
    field()!.value = 'draft-for-app-a';
    field()!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(field()!.value).toBe('draft-for-app-a');

    const data = lastProps.data as Record<string, unknown>;
    setStubPage('https://example.test/app/apps/a2?tab=agents', { appId: 'a2' });
    lastProps.data = { ...data, app: { ...(data.app as Record<string, unknown>), id: 'a2', urn: 'hrn:app:acme.com:other' }, bootPointerAppKey: 'a2' };
    flushSync();
    await tick(2);
    expect(target.querySelector('#app-agent-pointer-panel')).toBeNull();
    await openFor(target, 'Scribe');
    expect(field()!.value).toBe('');
  });

  // Xylon on #1246: a loader refresh for the SAME App and agent keeps the open
  // panel and what was typed.
  it('a same-App loader refresh keeps the panel and the draft', async () => {
    const target = await mountTab('agents', { data: { bootPointers, canManageApp: true } });
    await openFor(target, 'Critic');
    const field = () => target.querySelector<HTMLInputElement>('#app-agent-pointer-node-ref');
    field()!.value = 'draft-kept';
    field()!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    lastProps.data = { ...(lastProps.data as Record<string, unknown>), bootPointers: { ok: true, byAgent: { ...bootPointers.byAgent, ag2: { ref: URN, deleted: true } } } };
    flushSync();
    await tick(2);
    expect(target.querySelector('#app-agent-pointer-panel')?.textContent).toContain('Critic');
    expect(field()!.value).toBe('draft-kept');
    expect(target.querySelector('#app-agent-pointer-panel [data-pointer-state="deleted"]')).not.toBeNull();
  });

  it('a result written for the same agent in another App is never shown', async () => {
    const form = { pointer: { key: 'a2\u0000ag1', nodeRef: 'draft-elsewhere', refusal: { code: 'FORBIDDEN', lead: 'l', message: 'm' } } };
    const target = await mountTab('agents', { data: { bootPointers, canManageApp: true }, form });
    expect(target.querySelector('#app-agent-pointer-panel')).toBeNull();
  });

  it('an explicit canManageApp false offers no Set action, but the column still shows', async () => {
    const target = await mountTab('agents', { data: { bootPointers, canManageApp: false } });
    // The ⋯ menu still opens (Unlink remains) but offers no Set boot prompt.
    expect(menuItems(target, 'Scribe').some((i) => i.textContent?.trim() === 'Set boot prompt…')).toBe(false);
    expect(rowOf(target, 'Scribe').querySelector(`[title="${URN}"]`)).not.toBeNull();
  });

  it('the grid’s search finds a row by its pointer', async () => {
    const target = await mountTab('agents', { data: { bootPointers, canManageApp: true } });
    const search = target.querySelector<HTMLInputElement>('#panel-agents input[type="text"][aria-label]');
    expect(search).not.toBeNull();
    search!.value = 'team-install:boot';
    search!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(3);
    expect(rows(target).map((r) => r.textContent?.includes('Scribe'))).toEqual([true]);
  });
});

// #1904: grant discovery follows the server's manager fact, never App role labels.
describe('App Grants discovery', () => {
  it.each([
    [{ kind: 'known', manages: true }, true],
    [{ kind: 'known', manages: false }, false],
    [{ kind: 'unknown' }, false],
  ] as const)('only offers the section for an affirmative manager read (%j)', async (viewerManages, offered) => {
    const target = await mountTab('agents', { data: { viewerManages } });
    expect(!!target.querySelector('a[href="/app/apps/a1/grants"]')).toBe(offered);
  });
});

// portal#2288: a tab choice whose OWN navigation rejects says so, next to the strip.
// The negative pins end on a control rejection that must show the alert, so each is red on main
// (where no alert exists at all) and cannot pass by the alert simply being absent.
describe('App tab navigation failure feedback (#2288)', () => {
  const MESSAGE = 'Could not open this tab. Try again.';
  const alerts = (target: HTMLElement) =>
    [...target.querySelectorAll('[role="alert"]')].filter((el) => el.textContent?.includes(MESSAGE));
  const pick = async (target: HTMLElement, id: string) => {
    target.querySelector<HTMLButtonElement>(`#tab-${id}`)!.click();
    await wait(20);
    await tick(4);
  };
  const deferred = () => {
    let reject!: (e: unknown) => void, resolve!: () => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, reject, resolve };
  };

  it('shows the alert when the Runs navigation rejects, keeps the tab and keeps focus on the strip', async () => {
    const target = await mountTab('chats');
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    target.querySelector<HTMLButtonElement>('#tab-chats')!.focus();
    await pick(target, 'runs');
    expect(alerts(target)).toHaveLength(1);
    expect(target.querySelector('#tab-chats')?.getAttribute('aria-selected')).toBe('true');
    expect(target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('false');
    expect(target.querySelector('[role="tablist"]')?.contains(document.activeElement)).toBe(true);
  });

  it('a superseded choice whose goto rejects shows no alert', async () => {
    const target = await mountTab('chats');
    const first = deferred();
    let calls = 0;
    navigationHooks.onGoto = () => (++calls === 1 ? first.promise : undefined);
    await pick(target, 'runs');
    await pick(target, 'node-role-templates'); // supersedes the held Runs choice
    first.reject(new Error('navigation rejected'));
    await wait(20);
    await tick(4);
    expect(alerts(target)).toHaveLength(0);
    // control: the choice that still owns the epoch does show it
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    await pick(target, 'runs');
    expect(alerts(target)).toHaveLength(1);
  });

  it('a goto rejecting after teardown shows no alert and throws nothing', async () => {
    const target = await mountTab('chats');
    const held = deferred();
    navigationHooks.onGoto = () => held.promise;
    await pick(target, 'runs');
    const first = mounted.pop()!;
    const rejections = await captureUnhandledRejections(async () => {
      first.unmount();
      held.reject(new Error('navigation rejected'));
      await wait(20);
      await tick(4);
    });
    expect(rejections).toEqual([]);
    expect(document.body.textContent).not.toContain(MESSAGE);
    // control: a fresh mount's own rejection still shows the alert
    const fresh = await mountTab('chats');
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    await pick(fresh, 'runs');
    expect(alerts(fresh)).toHaveLength(1);
  });

  it('a failure on one App is gone when the page is reused for another, and stays gone on return', async () => {
    const target = await mountTab('chats');
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    await pick(target, 'runs');
    expect(alerts(target)).toHaveLength(1);
    const data = lastProps.data as Record<string, unknown>;
    const app = data.app as Record<string, unknown>;
    setStubPage('https://example.test/app/apps/a2?tab=chats', { appId: 'a2' });
    lastProps.data = { ...data, app: { ...app, id: 'a2', urn: 'hrn:app:acme.com:other' } };
    flushSync();
    await tick(4);
    expect(alerts(target)).toHaveLength(0);
    setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
    lastProps.data = data;
    flushSync();
    await tick(4);
    expect(alerts(target)).toHaveLength(0);
    // control: a failure on the App now shown still reports
    await pick(target, 'runs');
    expect(alerts(target)).toHaveLength(1);
  });

  it('the next tab choice clears the alert and a successful landing keeps it clear', async () => {
    const target = await mountTab('chats');
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    await pick(target, 'runs');
    expect(alerts(target)).toHaveLength(1);
    const held = deferred();
    navigationHooks.onGoto = () => held.promise;
    await pick(target, 'runs');
    expect(alerts(target)).toHaveLength(0); // cleared on the choice, before it settles
    held.resolve();
    await wait(20);
    await tick(4);
    expect(alerts(target)).toHaveLength(0);
    expect(target.querySelector('#tab-runs')?.getAttribute('aria-selected')).toBe('true');
  });
});
