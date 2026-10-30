import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './+server';
const read = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => 'caller-client' }));
vi.mock('$lib/server/channel-chat', () => ({ readChannelPage: (...args: unknown[]) => read(...args) }));
beforeEach(() => { read.mockReset(); });
const event = (query: string) => ({ params: { appId: 'app' }, url: new URL(`http://localhost/channel-chat?${query}`), locals: { token: 'caller-token' } }) as never;
it.each(['', 'channelRef=c&sinceSeq=0', 'channelRef=c&beforeSeq=2.5', 'channelRef=c&sinceSeq=2147483648', 'channelRef=c&sinceSeq=2&beforeSeq=3'])('refuses an invalid target/window without a read: %s', async query => {
  expect((await GET(event(query))).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
it('passes a backward cursor with the requested Channel and current caller', async () => {
  read.mockResolvedValue({ items: [], total: 0 });
  const r = await GET(event('channelRef=pair&beforeSeq=17'));
  expect(read).toHaveBeenCalledWith('caller-client', 'app', 'pair', { beforeSeq: 17 });
  expect(await r.json()).toMatchObject({ loadFailed: false });
});
it('reports a failed refresh without relabelling it as an empty successful thread', async () => {
  read.mockRejectedValue(new Error('offline'));
  const r = await GET(event('channelRef=pair&sinceSeq=17'));
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ loadFailed: true });
});
