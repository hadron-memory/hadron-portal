/**
 * portal#2376 (slice 3 of #2344) — the App page's availability and failure notes are persistent
 * `LiveRegion`s. Each pin raises the page's own condition after mount and asserts the region that
 * speaks was in the DOM, empty, before, and is still that element, empty, after the condition clears.
 *
 * Verified red on the conditional `<p role="status">` shape by reverting `+page.svelte` (see PR).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { pinRegion } from '$lib/test/pinStatusRegion';
import Page from './+page.svelte';
import { pageData } from './app-page.fixture';

const mounted: Mounted<Record<string, unknown>>[] = [];
beforeEach(() => {
  // Anything the page fetches answers degraded-but-ok; none of it is under test here.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, loadFailed: true }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })));
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

const agentOne = { id: 'ag1', urn: 'hrn:agent:acme.com:scribe', name: 'Scribe', personaRole: 'writer' };
const key = { id: 'k1', label: 'router', keyPreview: 'hk_ab…yz', createdAt: '2026-10-01T12:00:00.000Z', lastUsedAt: null, revokedAt: null };

type Over = Record<string, unknown>;
/** Mount the page on `tab` and return a way to change what the loader said, the way a reload does. */
async function open(tab: string, base: Over = {}) {
  setStubPage(`https://example.test/app/apps/a1?tab=${tab}`, { appId: 'a1' });
  window.history.replaceState({}, '', `/app/apps/a1?tab=${tab}`);
  const fixture = await pageData();
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      ...fixture, initialTab: tab, keyScopes: { kind: 'ok', byKey: { k1: [] } },
      appKeys: { kind: 'ok', keys: [key] }, ...base,
    },
    form: null,
  });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  const set = (over: Over) => { props.data = { ...(props.data as Over), ...over }; };
  const setApp = (over: Over) => { const d = props.data as Over; props.data = { ...d, app: { ...(d.app as Over), ...over } }; };
  const settle = () => tick(2);
  return { root: m.target, set, setApp, settle };
}

describe('chats tab notes', () => {
  it('chat list failed', async () => {
    const { root, set, settle } = await open('chats');
    await pinRegion({ root, text: 'Could not load this App’s chat list', settle, raise: () => set({ chatsError: true }), clear: () => set({ chatsError: false }) });
  });

  it('linked chat unresolved', async () => {
    const { root, set, settle } = await open('chats');
    await pinRegion({ root, text: 'Couldn’t find the linked chat', settle, raise: () => set({ chatDeepLinkUnresolved: true }), clear: () => set({ chatDeepLinkUnresolved: false }) });
  });

  it('the two chat-list notes share one region, which survives the swap between them', async () => {
    const { root, set, settle } = await open('chats');
    const region = await pinRegion({ root, text: 'Could not load this App’s chat list', settle, raise: () => set({ chatsError: true }) });
    set({ chatsError: false, chatDeepLinkUnresolved: true });
    await settle();
    expect(region.textContent).toContain('Couldn’t find the linked chat');
    expect(root.querySelectorAll('[role="status"]')).toContain(region);
  });

  it('chat not found', async () => {
    const { root, set, settle } = await open('chats');
    await pinRegion({ root, text: 'That chat isn’t available', settle, raise: () => set({ chatNotFound: true }), clear: () => set({ chatNotFound: false }) });
  });

  it('selected chat read failed', async () => {
    // An old, unregistered chat root: the only branch that carries this note.
    const { root, set, settle } = await open('chats', { selectedChatKey: 'legacy-root', appChats: [{ key: 'legacy-root', label: 'Old chat' }] });
    await pinRegion({ root, text: 'Couldn’t load this chat — that is a read failure', settle, raise: () => set({ selectedChatError: true }), clear: () => set({ selectedChatError: false }) });
    // The empty-chat copy takes the error's place only once the read has succeeded.
    expect(root.textContent).toContain('No messages in this chat yet.');
  });
});

describe('AI Team tab notes', () => {
  const roster = { kind: 'unavailable' };
  it('installed agents withheld: who can be cast is not known', async () => {
    const { root, setApp, settle } = await open('staff', { teamRoster: roster, staff: [] });
    await pinRegion({ root, text: 'so who can be cast here isn’t known', settle, raise: () => setApp({ agents: null }), clear: () => setApp({ agents: [agentOne] }) });
  });

  it('task and pause state hidden', async () => {
    const { root, set, settle } = await open('staff', { teamRoster: roster });
    await pinRegion({ root, text: 'Task and pause state are not shown to you.', settle, raise: () => set({ teamRoster: { kind: 'hidden' } }), clear: () => set({ teamRoster: roster }) });
  });
});

describe('Agents tab notes', () => {
  it('installed agents withheld', async () => {
    const { root, setApp, settle } = await open('agents');
    await pinRegion({ root, text: 'The agents installed in this App aren’t visible to you.', settle, raise: () => setApp({ agents: null }), clear: () => setApp({ agents: [agentOne] }) });
  });

  it('which agents can be added is not known (agents withheld)', async () => {
    const { root, setApp, settle } = await open('agents');
    await pinRegion({ root, text: 'Which agents can be added isn’t known', settle, raise: () => setApp({ agents: null }), clear: () => setApp({ agents: [agentOne] }) });
  });

  it('subscribed agents could not be loaded', async () => {
    const { root, set, settle } = await open('agents');
    await pinRegion({ root, text: 'The agents your organization subscribes to could not be loaded', settle, raise: () => set({ subscribedAgentsError: true }), clear: () => set({ subscribedAgentsError: false }) });
  });
});

const nonManager = { viewerManages: { kind: 'known', manages: false } };
const manager = { viewerManages: { kind: 'known', manages: true } };
const unknown = { viewerManages: { kind: 'unknown' } };

describe('App Keys tab notes', () => {
  it('key controls withheld from a non-manager', async () => {
    const { root, set, settle } = await open('keys', manager);
    await pinRegion({ root, text: 'Only people who manage this App can mint, revoke and scope its keys', settle, raise: () => set(nonManager), clear: () => set(manager) });
  });

  it('key controls unknown', async () => {
    const { root, set, settle } = await open('keys', manager);
    const region = await pinRegion({ root, text: 'Couldn’t check whether you can manage this App’s keys', settle, raise: () => set(unknown), clear: () => set(manager) });
    expect(region.getAttribute('data-testid')).toBe('key-controls-unknown');
  });

  it('scopes failed', async () => {
    const { root, set, settle } = await open('keys', manager);
    await pinRegion({ root, text: 'Couldn’t load what these keys may do', settle, raise: () => set({ keyScopes: { kind: 'failed' } }), clear: () => set({ keyScopes: { kind: 'ok', byKey: { k1: [] } } }) });
  });

  it('key list failed', async () => {
    const { root, set, settle } = await open('keys', manager);
    await pinRegion({ root, text: 'Couldn’t load this App’s keys.', settle, raise: () => set({ appKeys: { kind: 'failed' } }), clear: () => set({ appKeys: { kind: 'ok', keys: [key] } }) });
  });
});

describe('Client Keys tab notes', () => {
  it('key controls unknown', async () => {
    const { root, set, settle } = await open('client', manager);
    const region = await pinRegion({ root, text: 'Couldn’t check whether you can manage this App’s keys', settle, raise: () => set(unknown), clear: () => set(manager) });
    expect(region.getAttribute('data-testid')).toBe('key-controls-unknown');
  });

  it('key list hidden from a non-manager', async () => {
    const { root, set, settle } = await open('client', manager);
    await pinRegion({ root, text: 'Only the App’s managers can see its keys.', settle, raise: () => set({ appKeys: { kind: 'hidden' } }), clear: () => set({ appKeys: { kind: 'ok', keys: [key] } }) });
  });

  it('key list failed', async () => {
    const { root, set, settle } = await open('client', manager);
    await pinRegion({ root, text: 'Couldn’t load this App’s keys.', settle, raise: () => set({ appKeys: { kind: 'failed' } }), clear: () => set({ appKeys: { kind: 'ok', keys: [key] } }) });
  });

  // With no keys the New Client Key card is always mounted, so its region exists before the note. With a key
  // the card itself only mounts once the controls are withheld (`!activeKeys.length || open || withheld`), so
  // there the region arrives with the card: that path is page state fixed at load and is not pinned here.
  it('setup files withheld from a non-manager (no keys, so the card is always mounted)', async () => {
    const { root, set, settle } = await open('client', { ...manager, appKeys: { kind: 'ok', keys: [] } });
    await pinRegion({ root, text: 'Setup files contain a new App key', settle, raise: () => set(nonManager), clear: () => set(manager) });
  });
});
