/** portal#2454 — the chat-selector status region in the Chats tab's flex row goes out of flow with `idle:absolute`. */
import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { AGENT_CHAT_KEY, buildAppChatList } from '$lib/app-chats';
import { expectIdleAbsoluteRegion } from '$lib/test/idleAbsoluteRegion';
import { pageData } from './app-page.fixture';
import Page from './+page.svelte';

let mounted: ReturnType<typeof mountComponent> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.unstubAllGlobals(); resetNavigationCalls(); resetNavigationGuards(); });

it('the idle region carries idle:absolute, not empty:absolute', async () => {
  setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/api/agent-chat/list') ? { chats: [] } : url.includes('/api/served-prompts') ? { items: [], total: 0, offset: 0 } : {};
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
  const base = await pageData();
  const data = { ...base, app: { ...base.app, surfaces: ['chat'], agentId: 'ag1' }, chatConfigs: null,
    appChats: buildAppChatList([{ loc: 'chats:shared', name: 'Shared fixture', memoryId: 'shared' }], { hasAgentChat: true }),
    selectedChatKey: AGENT_CHAT_KEY, chatNotFound: false, chatsError: false };
  mounted = mountComponent(Page as never, { data, form: null } as never);
  await tick(3);
  await expectIdleAbsoluteRegion(mounted.target);
});
