import { afterEach, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import ChannelChatThread from './ChannelChatThread.svelte';
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals(); });
const msg = (seq: number) => ({ nodeId: `m${seq}`, seq, body: `body ${seq}`, at: '2026-10-21T00:00:00Z', authorUserId: 'human', authorWorkerId: null, authorName: 'Human', sessionId: null, replyToSeq: null, mentions: [], urn: null });
it('loads older Channel messages through the shared thread scrollback control', async () => {
  setStubPage('http://localhost/app/apps/a?tab=chats', { appId: 'a' });
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: Array.from({ length: 20 }, (_, i) => msg(i + 1)), total: 20, loadFailed: false })));
  vi.stubGlobal('fetch', fetcher);
  const postForm = await superValidate({ channelRef: 'pair' }, zod4(postTeamChatMessageSchema), { id: 'channel:pair', errors: false });
  mounted = mountComponent(ChannelChatThread as never, {
    appId: 'a', channelId: 'pair', messages: Array.from({ length: 20 }, (_, i) => msg(i + 21)), total: 40,
    loadError: false, postForm, form: null, action: '?/postChannelMessage', workerUrns: null, onDraftChange: vi.fn(),
  } as never) as Mounted<Record<string, unknown>>;
  await tick(2);
  const older = [...mounted.target.querySelectorAll('button')].find(b => b.textContent?.includes('Load earlier messages'))!;
  expect(older).toBeDefined();
  older.click();
  await vi.waitFor(() => expect(mounted!.target.textContent).toContain('body 1'));
  expect(fetcher).toHaveBeenCalledWith('/app/apps/a/channel-chat?channelRef=pair&beforeSeq=21');
});
