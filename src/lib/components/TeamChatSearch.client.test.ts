/**
 * #1013 — the team-chat search panel, mounted. CLIENT lane: what matters is what
 * happens after a response lands (or after the panel is gone).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, wait, captureUnhandledRejections, type Mounted } from '$lib/test/mountComponent';
import TeamChatSearch from './TeamChatSearch.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
const fetchMock = vi.fn();
// jsdom has no scrollIntoView (#1483): record calls for every test in the file.
const scrolled: Element[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

const hit = (seq: number, over: Record<string, unknown> = {}) => ({
  nodeId: `n${seq}`, urn: `hrn:node:acme.com:team:m${seq}`, seq, channelId: 'c1', channelIncarnation: 1,
  body: `body ${seq}`, at: '2026-10-30T10:00:00Z', authorName: 'Ada', ...over,
});
const ok = (items: unknown[], over: Record<string, unknown> = {}) => ({
  ok: true, items, complete: true, cursor: null, channelId: 'c1', channelIncarnation: 1, ...over,
});
const reply = (body: unknown) => ({ ok: true, json: async () => body });

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

  it.each([
    ['a non-success status', { ok: false, status: 502, json: async () => ({ message: 'Unavailable' }) }],
    ['a null body', reply(null)],
    ['an unrecognised shape', reply({ message: 'x' })],
  ])('treats %s as a failure the reader can see', async (_n, response) => {
    fetchMock.mockResolvedValueOnce(response);
    const m = mountPanel();
    await search(m, 'zz');
    expect(q(m, 'refusal')?.textContent).toContain('The search failed');
  });

  it('retries the query that failed, not whatever is in the box now', async () => {
    fetchMock.mockResolvedValueOnce(reply({ ok: false, code: 'FAILED' }));
    const m = mountPanel();
    await search(m, 'first');
    const input = m.target.querySelector('input') as HTMLInputElement;
    input.value = 'edited';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fetchMock.mockResolvedValueOnce(reply(ok([hit(1)])));
    (Array.from(m.target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Retry') as HTMLButtonElement).click();
    await wait(0);
    expect(fetchMock.mock.calls[1][0]).toContain('q=first');
  });

  it('shows the newly loaded rows after Load more, on a single pager', async () => {
    const first = Array.from({ length: 100 }, (_, k) => hit(500 - k, { body: `old ${k}` }));
    fetchMock.mockResolvedValueOnce(reply(ok(first, { complete: false, cursor: 'c2' })));
    const m = mountPanel();
    await search(m, 'old');
    fetchMock.mockResolvedValueOnce(reply(ok([hit(3, { body: 'newest-loaded' })])));
    (q(m, 'more') as HTMLButtonElement).click();
    await wait(0);
    expect(m.target.textContent).toContain('newest-loaded');
  });

  it('offers a fresh search, not a same-cursor retry, when a later page says the cursor is invalid', async () => {
    fetchMock.mockResolvedValueOnce(reply(ok([hit(5)], { complete: false, cursor: 'c2' })));
    const m = mountPanel();
    await search(m, 'body');
    fetchMock.mockResolvedValueOnce(reply({ ok: false, code: 'TEAM_CHAT_SEARCH_CURSOR_INVALID' }));
    (q(m, 'more') as HTMLButtonElement).click();
    await wait(0);
    expect(q(m, 'more')?.textContent).toContain('Search again');
    fetchMock.mockResolvedValueOnce(reply(ok([hit(9, { body: 'fresh' })])));
    (q(m, 'more') as HTMLButtonElement).click();
    await wait(0);
    expect(fetchMock.mock.calls[2][0]).not.toContain('cursor=');
    expect(m.target.textContent).toContain('fresh');
  });

  it('lands Load more on the page holding the new rows even after the reader changes rows per page', async () => {
    const first = Array.from({ length: 30 }, (_, k) => hit(500 - k, { body: `old ${k}` }));
    fetchMock.mockResolvedValueOnce(reply(ok(first, { complete: false, cursor: 'c2' })));
    const m = mountPanel();
    await search(m, 'old');
    const size = m.target.querySelector('select') as HTMLSelectElement;
    size.value = '10';
    size.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(m.target.textContent).toContain('Page 1 of 3');
    fetchMock.mockResolvedValueOnce(reply(ok([hit(3, { body: 'newest-loaded' })])));
    (q(m, 'more') as HTMLButtonElement).click();
    await wait(0);
    expect(m.target.textContent).toContain('newest-loaded');
  });

  // #1483 — Load more must say what changed: scroll the first new row into view and
  // announce the count from a status node that was mounted before its text.
  describe('Load more feedback (#1483)', () => {
    const status = (m: Mounted<Record<string, unknown>>) => q(m, 'status') as HTMLElement | null;

    it('announces the returned count in the same status node and scrolls the first new row into view, focus staying on the button', async () => {
      fetchMock.mockResolvedValueOnce(reply(ok([hit(9), hit(8)], { complete: false, cursor: 'c2' })));
      const m = mountPanel();
      await search(m, 'body');
      const before = status(m);
      expect(before).not.toBeNull();
      expect(before!.textContent?.trim()).toBe('');
      expect(before!.getAttribute('aria-live')).toBe('polite');

      fetchMock.mockResolvedValueOnce(reply(ok([hit(7), hit(6), hit(5)])));
      const button = q(m, 'more') as HTMLButtonElement;
      button.focus();
      button.click();
      await wait(0);
      await tick();
      expect(status(m)).toBe(before); // same DOM node, not a fresh one
      expect(before!.textContent).toContain('3 more matches loaded');
      expect(scrolled).toHaveLength(1);
      expect(scrolled[0].closest('tr')?.getAttribute('data-nodeid')).toBe('n7');
      expect(m.target.contains(document.activeElement) ? document.activeElement : null).not.toBe(scrolled[0]);
    });

    it('says one match, singular, when the page returned one', async () => {
      fetchMock.mockResolvedValueOnce(reply(ok([hit(9)], { complete: false, cursor: 'c2' })));
      const m = mountPanel();
      await search(m, 'body');
      fetchMock.mockResolvedValueOnce(reply(ok([hit(7)])));
      (q(m, 'more') as HTMLButtonElement).click();
      await wait(0);
      await tick();
      expect(status(m)!.textContent).toContain('1 more match loaded');
    });

    it('a refusal announces no count and scrolls nothing; a dead cursor keeps its own text', async () => {
      fetchMock.mockResolvedValueOnce(reply(ok([hit(9)], { complete: false, cursor: 'c2' })));
      const m = mountPanel();
      await search(m, 'body');
      fetchMock.mockResolvedValueOnce(reply({ ok: false, code: 'TEAM_CHAT_SEARCH_CURSOR_INVALID' }));
      (q(m, 'more') as HTMLButtonElement).click();
      await wait(0);
      await tick();
      expect(status(m)!.textContent?.trim()).toBe('');
      expect(scrolled).toHaveLength(0);
      expect(q(m, 'later-failed')?.textContent).toContain('can no longer be continued');
    });

    it('an empty later page announces no "0 more" and a new search clears the previous count', async () => {
      fetchMock.mockResolvedValueOnce(reply(ok([hit(9)], { complete: false, cursor: 'c2' })));
      const m = mountPanel();
      await search(m, 'body');
      fetchMock.mockResolvedValueOnce(reply(ok([hit(7)], { complete: false, cursor: 'c3' })));
      (q(m, 'more') as HTMLButtonElement).click();
      await wait(0);
      await tick();
      expect(status(m)!.textContent).toContain('1 more match loaded');
      fetchMock.mockResolvedValueOnce(reply(ok([], { complete: false, cursor: 'c4' })));
      (q(m, 'more') as HTMLButtonElement).click();
      await wait(0);
      await tick();
      expect(status(m)!.textContent).not.toContain('0 more');
      expect(scrolled).toHaveLength(1);
      fetchMock.mockResolvedValueOnce(reply(ok([hit(1)])));
      await search(m, 'other');
      expect(status(m)!.textContent?.trim()).toBe('');
    });

    it('scrolls nothing and throws nothing when the panel is torn down before the rows render', async () => {
      fetchMock.mockResolvedValueOnce(reply(ok([hit(9)], { complete: false, cursor: 'c2' })));
      const m = mountPanel();
      await search(m, 'body');
      const pending = deferred<ReturnType<typeof reply>>();
      fetchMock.mockReturnValueOnce(pending.promise);
      const rejections = await captureUnhandledRejections(async () => {
        (q(m, 'more') as HTMLButtonElement).click();
        await tick();
        m.unmount();
        mounted.pop();
        pending.resolve(reply(ok([hit(7)])));
        await wait(0);
        await tick();
      });
      expect(scrolled).toHaveLength(0);
      expect(rejections).toEqual([]);
    });
  });
});
