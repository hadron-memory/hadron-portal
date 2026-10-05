import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import type { Comment, Discussion, DiscussionThread } from '$lib/comments';
import NodeDiscussion from './NodeDiscussion.svelte';

/**
 * portal#1014: the Discussion tab, mounted. The fetch mock answers on a
 * microtask with a plain object (no stream-backed Response), so a run under CI
 * load can't time out on body reads.
 */

const ENDPOINT = '/app/memories/mem-1/nodes/node-1/comments';

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    urn: `hrn:node:acme.com:specs:comments:${id}`,
    target: { id: 'node-1', urn: 'hrn:node:acme.com:specs:a', name: 'A', nodeType: 'info', revSeq: 3 },
    threadRootId: null,
    isTopLevel: true,
    anchorRevision: 3,
    anchorApprovalHash: 'a'.repeat(64),
    anchorIsCurrent: true,
    quote: null,
    body: 'Is §2 right?',
    state: 'OPEN',
    retracted: false,
    retractedAt: null,
    hidden: false,
    hiddenAt: null,
    resolvedAt: null,
    resolvedBy: null,
    author: { kind: 'USER', worker: null, user: { id: 'user-2', name: null, handle: 'bo', urn: null }, agent: null, app: null },
    provenanceUser: null,
    createdAt: '2026-10-05T18:00:00.000Z',
    updatedAt: null,
    revSeq: 1,
    ...over,
  };
}

function thread(root: Comment, mine = false): DiscussionThread {
  return { root, replies: [], replyCount: 0, mine: { [root.id]: mine } };
}

const discussion = (threads: DiscussionThread[], perms = { canWrite: true, canManage: false }): Discussion => ({
  ok: true,
  threads,
  total: threads.length,
  permissions: perms,
});

function stubFetch(answer: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: answer.ok,
    status: answer.status ?? (answer.ok ? 200 : 409),
    json: async () => answer.body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function buttons(target: HTMLElement): string[] {
  return [...target.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
}

function typeInto(el: HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('NodeDiscussion (portal#1014)', () => {
  it('a read-only reader sees the discussion and no controls at all (cor:dmo:110:03)', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([thread(comment('c1'), true)], { canWrite: false, canManage: false }),
    });
    expect(m.target.textContent).toContain('Is §2 right?');
    expect(m.target.querySelector('textarea')).toBeNull();
    expect(buttons(m.target)).toEqual([]);
    expect(m.target.textContent).toContain('needs write access');
    m.unmount();
  });

  it('labels a thread on an older revision with that revision (cor:dmo:110:01)', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 5,
      initial: discussion([thread(comment('c1', { anchorRevision: 2 }))]),
    });
    expect(m.target.textContent).toContain('On revision 2, not the text shown here');
    m.unmount();
  });

  it('a writer who is not the author gets Reply and Resolve, not Edit or Retract', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([thread(comment('c1'), false)]),
    });
    const labels = buttons(m.target);
    expect(labels).toContain('Resolve');
    expect(labels).toContain('Reply');
    expect(labels).not.toContain('Edit');
    expect(labels).not.toContain('Retract');
    m.unmount();
  });

  it('posts a new thread anchored to the shown revision, then shows what the endpoint read back', async () => {
    const posted = thread(comment('c9', { body: 'Typo in §3' }), true);
    const fetchMock = stubFetch({ ok: true, body: { ok: true, discussion: discussion([posted]), summary: { openThreads: 1, resolvedThreads: 0, comments: 1 } } });
    const onsummary = vi.fn();
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: 3, initial: discussion([]), onsummary });

    typeInto(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!, 'Typo in §3');
    m.target.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await tick(10);
    flushSync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(String(init.body))).toEqual({ op: 'create', body: 'Typo in §3', anchorRevision: 3 });
    expect(m.target.textContent).toContain('Typo in §3');
    expect(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!.value).toBe('');
    expect(onsummary).toHaveBeenCalledWith({ openThreads: 1, resolvedThreads: 0, comments: 1 });
    m.unmount();
  });

  it('a refused post keeps the draft and shows the fixed copy as an alert', async () => {
    stubFetch({ ok: false, status: 409, body: { error: 'You already have an open discussion on this node.', code: 'COMMENT_OPEN_THREAD_EXISTS' } });
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: 3, initial: discussion([]) });

    typeInto(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!, 'Second thought');
    m.target.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await tick(10);
    flushSync();

    expect(m.target.querySelector('[role="alert"]')?.textContent).toContain('already have an open discussion');
    expect(m.target.querySelector<HTMLTextAreaElement>('#new-comment')!.value).toBe('Second thought');
    m.unmount();
  });

  it('a worker is the author, with its URN; the user who bound it shows only as provenance (cor:dmo:110:03)', () => {
    const byWorker = comment('c1', {
      author: { kind: 'WORKER', worker: { id: 'w1', name: 'Dara', handle: null, urn: 'hrn:worker:acme.com:team:dara' }, user: null, agent: null, app: null },
      provenanceUser: { id: 'u9', name: null, handle: 'binder', urn: null },
    });
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: 3, initial: discussion([thread(byWorker)]) });
    const headerEl = m.target.querySelector('article header')!;
    const header = headerEl.textContent ?? '';
    expect(header.trim().startsWith('Dara')).toBe(true);
    // The compact URN chip carries the full URN to copy.
    expect(headerEl.querySelector('[title="hrn:worker:acme.com:team:dara"]')).not.toBeNull();
    expect(header).toContain('(session bound by @binder)');
    m.unmount();
  });

  it('a resolved thread still offers Reply (DAB), beside Reopen', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([thread(comment('c1', { state: 'RESOLVED' }))]),
    });
    expect(buttons(m.target)).toEqual(expect.arrayContaining(['Reply', 'Reopen']));
    expect(buttons(m.target)).not.toContain('Resolve');
    m.unmount();
  });

  it('a retracted comment renders as a stub, not its text', () => {
    const m = mountComponent(NodeDiscussion, {
      endpoint: ENDPOINT,
      shownRevision: 3,
      initial: discussion([thread(comment('c1', { retracted: true, body: null }))]),
    });
    expect(m.target.textContent).toContain('Retracted by its author.');
    m.unmount();
  });

  it('with no known revision, offers no new thread: nothing could be anchored to what the reader saw', () => {
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: null, initial: discussion([]) });
    expect(m.target.querySelector('#new-comment')).toBeNull();
    m.unmount();
  });

  it('a failed read says so instead of showing an empty discussion', () => {
    const m = mountComponent(NodeDiscussion, { endpoint: ENDPOINT, shownRevision: 3, initial: { ok: false } });
    expect(m.target.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load the discussion");
    expect(m.target.textContent).not.toContain('No discussion yet');
    m.unmount();
  });
});
