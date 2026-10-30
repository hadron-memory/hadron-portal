/**
 * #1013 — the team-chat search panel, mounted. CLIENT lane: what matters is what
 * happens after a response lands (or after the panel is gone).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, wait, captureUnhandledRejections, type Mounted } from '$lib/test/mountComponent';
import TeamChatSearch from './TeamChatSearch.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

const hit = (seq: number, over: Record<string, unknown> = {}) => ({
  nodeId: `n${seq}`, urn: `hrn:node:acme.com:team:m${seq}`, seq, channelId: 'c1', channelIncarnation: 1,
  body: `body ${seq}`, at: '2026-10-30T10:00:00Z', authorName: 'Ada', ...over,
});
const ok = (items: unknown[], over: Record<string, unknown> = {}) => ({
  ok: true, items, complete: true, cursor: null, channelId: 'c1', channelIncarnation: 1, ...over,
});
const reply = (body: unknown) => ({ json: async () => body });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function mountPanel() {
  const m = mountComponent(TeamChatSearch as never, { appId: 'a1' });
  mounted.push(m as never);
  return m;
}
async function search(m: Mounted<Record<string, unknown>>, text: string) {
  const input = m.target.querySelector('input') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  (m.target.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(0);
}
const q = (m: Mounted<Record<string, unknown>>, id: string) => m.target.querySelector(`[data-testid="team-chat-search-${id}"]`);

describe('TeamChatSearch', () => {
  it('does not call the server for a query outside 2..200 characters', async () => {
    const m = mountPanel();
    await search(m, 'a');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.target.textContent).toContain('Enter 2 to 200 characters.');
  });

  it('renders matches with their URN and says nothing is missing when complete', async () => {
    fetchMock.mockResolvedValueOnce(reply(ok([hit(2), hit(1)])));
    const m = mountPanel();
    await search(m, 'body');
    expect(fetchMock.mock.calls[0][0]).toContain('/app/apps/a1/team-chat/search?q=body');
    expect(m.target.textContent).toContain('body 2');
    expect(m.target.textContent).toContain('acme.com:team:m2');
    expect(m.target.querySelector('a[href*="/app/u/"]')?.getAttribute('href')).toBe('/app/u/hrn:node:acme.com:team:m2');
    expect(q(m, 'none')).toBeNull();
    expect(q(m, 'more')).toBeNull();
  });

  it('empty + complete is "no matches"; empty + incomplete is the scan limit, not no-matches', async () => {
    fetchMock.mockResolvedValueOnce(reply(ok([])));
    const a = mountPanel();
    await search(a, 'zz');
    expect(q(a, 'none')).not.toBeNull();
    expect(q(a, 'scan-limit')).toBeNull();

    fetchMock.mockResolvedValueOnce(reply(ok([], { complete: false, cursor: 'c2' })));
    const b = mountPanel();
    await search(b, 'zz');
    expect(q(b, 'none')).toBeNull();
    expect(q(b, 'scan-limit')).not.toBeNull();
    expect(q(b, 'more')?.textContent).toContain('Continue searching');
  });

  it('shows a typed refusal, never an empty result', async () => {
    fetchMock.mockResolvedValueOnce(reply({ ok: false, code: 'TEAM_CHAT_SEARCH_ENCRYPTED' }));
    const m = mountPanel();
    await search(m, 'zz');
    expect(q(m, 'refusal')?.textContent).toContain('encrypted');
    expect(q(m, 'none')).toBeNull();
  });

  it('a later-page failure keeps the earlier matches and offers a retry that continues from the same cursor', async () => {
    fetchMock.mockResolvedValueOnce(reply(ok([hit(5)], { complete: false, cursor: 'c2' })));
    const m = mountPanel();
    await search(m, 'body');
    fetchMock.mockResolvedValueOnce(reply({ ok: false, code: 'FAILED' }));
    (q(m, 'more') as HTMLButtonElement).click();
    await wait(0);
    expect(m.target.textContent).toContain('body 5');
    expect(q(m, 'later-failed')).not.toBeNull();
    expect(q(m, 'more')?.textContent).toContain('Retry');

    fetchMock.mockResolvedValueOnce(reply(ok([hit(3)])));
    (q(m, 'more') as HTMLButtonElement).click();
    await wait(0);
    expect(fetchMock.mock.calls[2][0]).toContain('cursor=c2');
    expect(m.target.textContent).toContain('body 5');
    expect(m.target.textContent).toContain('body 3');
    expect(q(m, 'later-failed')).toBeNull();
  });

  it('renders an absent URN as absent and an unreadable message as unavailable', async () => {
    fetchMock.mockResolvedValueOnce(reply(ok([hit(4, { urn: null, body: null })])));
    const m = mountPanel();
    await search(m, 'body');
    expect(m.target.textContent).toContain('No link available');
    expect(m.target.textContent).toContain('Message text unavailable');
  });

  it('discards a response for a query the reader has since replaced', async () => {
    const first = deferred<unknown>();
    fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(reply(ok([hit(9, { body: 'fresh' })])));
    const m = mountPanel();
    await search(m, 'old');
    await search(m, 'new');
    first.resolve(reply(ok([hit(1, { body: 'stale' })])));
    await wait(0);
    expect(m.target.textContent).toContain('fresh');
    expect(m.target.textContent).not.toContain('stale');
  });

  it('writes nothing and throws nothing when a response lands after teardown', async () => {
    const pending = deferred<unknown>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const m = mountPanel();
    const rejections = await captureUnhandledRejections(async () => {
      await search(m, 'body');
      m.unmount();
      mounted.pop();
      pending.resolve(reply(ok([hit(1)])));
      await wait(0);
    });
    expect(m.target.textContent).not.toContain('body 1');
    expect(rejections).toEqual([]);
  });
});
