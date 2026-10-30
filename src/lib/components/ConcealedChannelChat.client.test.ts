/** Mounted Channel UI + real addressed read/post helper boundary, no live transport. */
import { afterEach, expect, it, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import { withRegisteredChannels } from '$lib/app-chats';
import { readChannelPage, postToChannel } from '$lib/server/channel-chat';
import { APP_CHAT_TARGET_QUERY, CHANNEL_CHAT_TARGET_QUERY, CHANNEL_MESSAGES_QUERY, CREATE_CHANNEL_MESSAGE_MUTATION } from '$lib/server/queries';
import ChannelChatThread from './ChannelChatThread.svelte';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { GET } from '../../routes/app/apps/[appId]/channel-chat/+server';
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, 'hidden'); request.mockReset(); });
it('keeps a concealed host selectable but issues no message read/post, never falling back to team', async () => {
  request.mockImplementation(async (doc: string) => {
    if (doc === APP_CHAT_TARGET_QUERY) return { app: { id: 'a' } };
    if (doc === CHANNEL_CHAT_TARGET_QUERY) return { channel: { id: 'concealed', memory: null } };
    // If a guard is removed this response lets the forbidden operation complete;
    // assertions below must detect that rather than a fake throwing for us.
    if (doc === CHANNEL_MESSAGES_QUERY) return { channelMessages: { items: [], total: 0 } };
    return { createChannelMessage: { seq: 1 } };
  });
  const list = withRegisteredChannels([], [{ id: 'concealed', name: 'Room', loc: 'chats:room', chatRootUrn: null, memoryId: 'hidden-host' }]);
  expect(list[0].channelId).toBe('concealed');
  const initial = await readChannelPage({ request } as never, 'a', list[0].channelId!, {}).catch(() => null);
  expect(initial).toBeNull();
  setStubPage('http://localhost/app/apps/a?tab=chats&chat=concealed', { appId: 'a' });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.useFakeTimers();
  const fetcher = vi.fn(async (url: string) => GET({ params: { appId: 'a' }, url: new URL(url, 'http://localhost'), locals: { token: 'synthetic' } } as never));
  vi.stubGlobal('fetch', fetcher);
  const postForm = await superValidate({ channelRef: 'concealed' }, zod4(postTeamChatMessageSchema), { id: 'channel:concealed', errors: false });
  const props = reactiveProps<Record<string, unknown>>({ appId: 'a', channelId: 'concealed', messages: [], total: 0,
    loadError: true, postForm, form: null, action: '?/postChannelMessage', workerUrns: null, onDraftChange: vi.fn(),
  });
  mounted = mountComponent(ChannelChatThread as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(3);
  await vi.advanceTimersByTimeAsync(8000); await tick(3);
  expect(fetcher).toHaveBeenCalledWith('/app/apps/a/channel-chat?channelRef=concealed');
  const field = mounted.target.querySelector<HTMLTextAreaElement>('textarea[name=body]')!;
  field.value = 'keep this refused draft'; field.dispatchEvent(new Event('input', { bubbles: true })); await tick(3);
  const form = field.closest('form')!;
  const values = new FormData(form);
  expect(values.get('channelRef')).toBe('concealed');
  expect(values.get('body')).toBe('keep this refused draft');
  const pending = await submitEnhancedDeferred(form);
  await expect(postToChannel({ request } as never, 'a', String(values.get('channelRef')), String(values.get('body')))).rejects.toThrow('Channel unavailable');
  const refused = await superValidate({ channelRef: 'concealed', body: String(values.get('body')) }, zod4(postTeamChatMessageSchema), { id: 'channel:concealed', errors: false });
  refused.message = { type: 'error', text: 'Could not post to this chat. Your message has been kept; check your access and try again.' };
  await pending.finish({ type: 'failure', status: 500, data: { form: refused } });
  props.form = { form: refused }; await tick(3);
  expect(field.value).toBe('keep this refused draft');
  expect(mounted.target.textContent).toContain('Your message has been kept');
  const docs = request.mock.calls.map(call => call[0]);
  expect(docs).not.toContain(CHANNEL_MESSAGES_QUERY);
  expect(docs).not.toContain(CREATE_CHANNEL_MESSAGE_MUTATION);
  expect(docs.every(doc => doc === APP_CHAT_TARGET_QUERY || doc === CHANNEL_CHAT_TARGET_QUERY)).toBe(true);
});
