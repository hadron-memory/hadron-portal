import { describe, expect, it, vi } from 'vitest';
import { readChannelPage, postToChannel } from './channel-chat';
import { CHANNEL_MESSAGES_QUERY, CREATE_CHANNEL_MESSAGE_MUTATION, APP_CHAT_TARGET_QUERY, CHANNEL_CHAT_TARGET_QUERY } from './queries';
const client = () => ({ request: vi.fn(async (q: string) => {
  if (q === APP_CHAT_TARGET_QUERY) return { app: { id: 'app-a' } };
  if (q === CHANNEL_CHAT_TARGET_QUERY) return { channel: { id: 'chan-b', memory: { appId: 'app-a' } } };
  if (q === CHANNEL_MESSAGES_QUERY) return { channelMessages: { items: [{ seq: 8, body: 'hello' }], total: 9 } };
  return { createChannelMessage: { seq: 9 } };
}) });
describe('addressed channel chat (#1033)', () => {
  it('reads an explicit newest window, and preserves server cursors for older/newer pages', async () => {
    const c = client();
    expect(await readChannelPage(c as any, 'app-a', 'chan-b', {})).toMatchObject({ total: 9 });
    expect(c.request).toHaveBeenLastCalledWith(CHANNEL_MESSAGES_QUERY, { channelRef: 'chan-b', beforeSeq: 2147483647, limit: 20 });
    await readChannelPage(c as any, 'app-a', 'chan-b', { beforeSeq: 8 });
    expect(c.request).toHaveBeenLastCalledWith(CHANNEL_MESSAGES_QUERY, { channelRef: 'chan-b', beforeSeq: 8, limit: 20 });
    await readChannelPage(c as any, 'app-a', 'chan-b', { sinceSeq: 9 });
    expect(c.request).toHaveBeenLastCalledWith(CHANNEL_MESSAGES_QUERY, { channelRef: 'chan-b', sinceSeq: 9, limit: 20 });
  });
  it('posts as the human to this channel, without a worker session or default-team fallback', async () => {
    const c = client();
    await postToChannel(c as any, 'app-a', 'chan-b', 'hello', 8);
    expect(c.request).toHaveBeenLastCalledWith(CREATE_CHANNEL_MESSAGE_MUTATION, { channelRef: 'chan-b', body: 'hello', replyToSeq: 8 });
  });
  it('rejects a channel outside the route App before reading or writing its messages', async () => {
    const c = { request: vi.fn(async q => q === APP_CHAT_TARGET_QUERY ? { app: { id: 'app-a' } } : { channel: { id: 'chan-b', memory: { appId: 'other-app' } } }) };
    await expect(readChannelPage(c as any, 'app-a', 'chan-b', {})).rejects.toThrow();
    await expect(postToChannel(c as any, 'app-a', 'chan-b', 'hello')).rejects.toThrow();
    expect(c.request.mock.calls).toHaveLength(4);
  });
});
